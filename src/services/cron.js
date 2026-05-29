const cron = require('node-cron');
const db = require('../../config/db');

// Process scheduled payouts every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  try {
    const { rows } = await db.query(`
      SELECT p.id, p.seller_amount, d.seller_id, u.phone as seller_phone, d.title
      FROM purchases p
      JOIN documents d ON d.id = p.document_id
      JOIN users u ON u.id = d.seller_id
      WHERE p.payout_status = 'scheduled'
        AND p.payout_at <= NOW()
        AND p.payment_status = 'completed'
        AND p.purchase_type = 'individual'
      LIMIT 50
    `);

    for (const purchase of rows) {
      try {
        // TODO: In production, trigger M-Pesa B2C here
        // For now just mark as paid (manual payout via admin dashboard)
        console.log(`[PAYOUT] KSh ${purchase.seller_amount} due to seller ${purchase.seller_id} for "${purchase.title}"`);
      } catch (err) {
        console.error(`Payout failed for purchase ${purchase.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Payout scheduler error:', err.message);
  }
});

// Clean up expired payment requests every hour
cron.schedule('0 * * * *', async () => {
  try {
    const { rowCount } = await db.query(`
      UPDATE payment_requests SET status = 'timeout'
      WHERE status = 'pending' AND expires_at < NOW()
    `);
    if (rowCount > 0) console.log(`[CLEANUP] Timed out ${rowCount} stale payment requests`);
  } catch (err) {
    console.error('Cleanup error:', err.message);
  }
});

// Deactivate expired access codes every hour
cron.schedule('30 * * * *', async () => {
  try {
    const { rowCount } = await db.query(`
      UPDATE access_codes SET is_active = false
      WHERE is_active = true AND expires_at < NOW()
    `);
    if (rowCount > 0) console.log(`[CLEANUP] Deactivated ${rowCount} expired access codes`);
  } catch (err) {
    console.error('Code cleanup error:', err.message);
  }
});

// Distribute dept pass engagement earnings daily at midnight
cron.schedule('0 0 * * *', async () => {
  try {
    // Find dept pass purchases from the previous 24 hours
    const { rows: passes } = await db.query(`
      SELECT p.id, p.buyer_id, p.seller_amount, p.pass_id, ac.id as code_id
      FROM purchases p
      JOIN access_codes ac ON ac.id = p.access_code_id
      WHERE p.purchase_type = 'dept_pass'
        AND p.payment_status = 'completed'
        AND p.payout_status = 'pending'
        AND p.created_at >= NOW() - INTERVAL '24 hours'
    `);

    for (const pass of passes) {
      // Get total engagement points for this code
      const { rows: totalRows } = await db.query(`
        SELECT SUM(points) as total FROM engagement_events WHERE access_code_id = $1
      `, [pass.code_id]);
      const totalPoints = parseInt(totalRows[0]?.total) || 0;
      if (totalPoints === 0) continue;

      // Get per-seller engagement breakdown
      const { rows: sellerPoints } = await db.query(`
        SELECT seller_id, SUM(points) as points
        FROM engagement_events WHERE access_code_id = $1
        GROUP BY seller_id
      `, [pass.code_id]);

      const poolAmount = parseFloat(pass.seller_amount) || 0;

      for (const sp of sellerPoints) {
        const share = (parseInt(sp.points) / totalPoints) * poolAmount;
        const earned = Math.round(share * 100) / 100;
        if (earned < 1) continue;

        await db.query(
          'UPDATE users SET pending_earnings = pending_earnings + $1 WHERE id = $2',
          [earned, sp.seller_id]
        );
      }

      await db.query(
        `UPDATE purchases SET payout_status = 'scheduled', payout_at = NOW() + INTERVAL '2 hours' WHERE id = $1`,
        [pass.id]
      );
    }
    console.log(`[EARNINGS] Processed ${passes.length} dept pass distributions`);
  } catch (err) {
    console.error('Engagement distribution error:', err.message);
  }
});

console.log('⏰ Cron jobs started');
