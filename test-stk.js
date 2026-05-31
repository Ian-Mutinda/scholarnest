require('dotenv').config();
const { initiateSTKPush } = require('./src/services/mpesa');

initiateSTKPush({
  phone: '0114989703',
  amount: 1,
  buyerId: 1,
  documentId: 1,
  passId: null,
  purchaseType: 'individual',
})
.then(result => console.log('✅ STK Push result:', JSON.stringify(result, null, 2)))
.catch(err => console.error('❌ Error:', err.message));