require('dotenv').config();
const { getAccessToken } = require('./src/services/mpesa');

getAccessToken()
  .then(token => console.log('✅ Token:', token))
  .catch(err => console.error('❌ Error:', err.message));