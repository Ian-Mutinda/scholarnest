const axios = require('axios');
const db = require('../../config/db');

const DARAJA_BASE = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

// Get OAuth token from Daraja
async function getAccessToken() {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  const credentials = Buffer.from(`${key}:${secret}`).toString('base64');

  const { data } = await axios.get(`${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  return data.access_token;
}

// Generate STK Push password
function getPassword() {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const timestamp = getTimestamp();
  const raw = `${shortcode}${passkey}${timestamp}`;
  return Buffer.from(raw).toString('base64');
}

function getTimestamp() {
  return new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
}

// Initiate STK Push payment
async function initiateSTKPush({ phone, amount, buyerId, documentId, passId, purchaseType }) {
  const token = await getAccessToken();
  const timestamp = getTimestamp();
  const password = getPassword();

  // Format phone: 0712345678 -> 254712345678
  const formattedPhone = phone.startsWith('0')
    ? '254' + phone.slice(1)
    : phone.startsWith('+')
    ? phone.slice(1)
    : phone;

  const payload = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.ceil(amount),
    PartyA: formattedPhone,
    PartyB: process.env.MPESA_SHORTCODE,
    PhoneNumber: formattedPhone,
    CallBackURL: process.env.MPESA_CALLBACK_URL,
    AccountReference: 'ScholarNest',
    TransactionDesc: purchaseType === 'dept_pass' ? 'Department Pass' : 'Document Access',
  };

  const { data } = await axios.post(
    `${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  // Save pending payment request
  const { rows } = await db.query(`
    INSERT INTO payment_requests
      (buyer_id, document_id, pass_id, purchase_type, amount, phone,
       checkout_request_id, merchant_request_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
  `, [
    buyerId,
    documentId || null,
    passId || null,
    purchaseType,
    amount,
    formattedPhone,
    data.CheckoutRequestID,
    data.MerchantRequestID,
  ]);

  return {
    requestId: rows[0].id,
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID,
    responseCode: data.ResponseCode,
    customerMessage: data.CustomerMessage,
  };
}

// Process M-Pesa callback
async function processCallback(payload) {
  const body = payload.Body?.stkCallback;
  if (!body) return;

  const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = body;

  // Extract metadata
  let amount, mpesaReceipt, phone;
  if (ResultCode === 0 && CallbackMetadata?.Item) {
    for (const item of CallbackMetadata.Item) {
      if (item.Name === 'Amount') amount = item.Value;
      if (item.Name === 'MpesaReceiptNumber') mpesaReceipt = item.Value;
      if (item.Name === 'PhoneNumber') phone = String(item.Value);
    }
  }

  // Log raw callback
  await db.query(`
    INSERT INTO mpesa_callbacks
      (checkout_request_id, merchant_request_id, result_code, result_desc,
       amount, mpesa_receipt, phone, raw_payload)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [CheckoutRequestID, MerchantRequestID, ResultCode, ResultDesc, amount, mpesaReceipt, phone, payload]);

  // Find payment request
  const { rows } = await db.query(
    'SELECT * FROM payment_requests WHERE checkout_request_id = $1',
    [CheckoutRequestID]
  );
  if (!rows[0]) return;
  const request = rows[0];

  if (ResultCode !== 0) {
    await db.query(
      'UPDATE payment_requests SET status = $1 WHERE id = $2',
      ['failed', request.id]
    );
    return;
  }

  // Payment success — complete the purchase
  await completePurchase(request, mpesaReceipt, phone, amount);
}

// Complete purchase after successful M-Pesa payment
async function completePurchase(request, mpesaReceipt, phone, amount) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const platformCut = Math.round(amount * (parseFloat(process.env.PLATFORM_CUT_PERCENT) / 100) * 100) / 100;
    const sellerAmount = Math.round((amount - platformCut) * 100) / 100;

    // Determine code type
    let codeType = 'single';
    if (request.purchase_type === 'dept_pass') codeType = 'dept_pass';

    // Create access code
   const { createCodesForPurchase } = require('../utils/accessCodes');
    const codes = await createCodesForPurchase({
      buyerId: request.buyer_id,
      documentId: request.document_id,
      passId: request.pass_id,
      codeType,
    });
    const code = codes[0];

    // Fetch seller id
    let sellerId = null;
    if (request.document_id) {
      const doc = await client.query('SELECT seller_id FROM documents WHERE id = $1', [request.document_id]);
      sellerId = doc.rows[0]?.seller_id;
    }

    // Create purchase record
    const { rows: purchaseRows } = await client.query(`
      INSERT INTO purchases
        (buyer_id, document_id, pass_id, purchase_type, amount_paid,
         platform_cut, seller_amount, mpesa_transaction_id, mpesa_phone,
         payment_status, payout_status, access_code_id, payout_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', 'scheduled', $10, $11)
      RETURNING id
    `, [
      request.buyer_id,
      request.document_id || null,
      request.pass_id || null,
      request.purchase_type,
      amount,
      platformCut,
      sellerId ? sellerAmount : null,
      mpesaReceipt,
      phone,
      code.id,
      new Date(Date.now() + (parseInt(process.env.PAYOUT_DELAY_HOURS) || 2) * 3600000),
    ]);

    // Queue seller earnings
    if (sellerId && request.purchase_type === 'individual') {
      await client.query(`
        UPDATE users SET pending_earnings = pending_earnings + $1 WHERE id = $2
      `, [sellerAmount, sellerId]);
    }

    // Update payment request
    await client.query(
      'UPDATE payment_requests SET status = $1 WHERE id = $2',
      ['completed', request.id]
    );

    // Notify buyer
    await client.query(`
      INSERT INTO notifications (user_id, type, title, message)
      VALUES ($1, 'purchase_complete', 'Payment received!', $2)
    `, [request.buyer_id, `Your access code is: ${code.code}. It expires in 7 days.`]);

    await client.query('COMMIT');
    console.log(`✅ Purchase completed. Code: ${code.code}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ completePurchase failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { initiateSTKPush, processCallback, getAccessToken };
