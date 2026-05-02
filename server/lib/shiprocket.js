const axios = require('axios');

let _token = null;
let _tokenExpiry = null;

async function getToken() {
  if (_token && _tokenExpiry && Date.now() < _tokenExpiry) {
    return _token;
  }

  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;

  if (!email || !password) {
    throw new Error('SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD are not set in .env');
  }

  try {
    const response = await axios.post('https://apiv2.shiprocket.in/v1/external/auth/login', {
      email,
      password
    });
    
    _token = response.data.token;
    // Shiprocket tokens usually expire in 240 hours (10 days). We'll cache it for 24 hours to be safe.
    _tokenExpiry = Date.now() + 24 * 60 * 60 * 1000;
    
    return _token;
  } catch (err) {
    console.error('[Shiprocket] Auth failed:', err.response?.data || err.message);
    throw new Error('Failed to authenticate with Shiprocket');
  }
}

async function getClient() {
  const token = await getToken();
  return axios.create({
    baseURL: 'https://apiv2.shiprocket.in/v1/external',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });
}

/**
 * Creates an order in Shiprocket
 * @param {Object} payload The order payload matching Shiprocket API
 */
async function createOrder(payload) {
  try {
    const client = await getClient();
    const response = await client.post('/orders/create/adhoc', payload);
    return response.data; // Includes order_id, shipment_id, status
  } catch (err) {
    console.error('[Shiprocket] Create order failed:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to create order in Shiprocket');
  }
}

/**
 * Generates an AWB for a shipment
 * @param {string|number} shipmentId 
 */
async function generateAWB(shipmentId) {
  try {
    const client = await getClient();
    const response = await client.post('/courier/assign/awb', {
      shipment_id: shipmentId
    });
    return response.data; // Includes awb_code, courier_name
  } catch (err) {
    console.error('[Shiprocket] Generate AWB failed:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to generate AWB in Shiprocket');
  }
}

/**
 * Gets tracking details by AWB
 * @param {string} awb 
 */
async function getTrackingByAwb(awb) {
  try {
    const client = await getClient();
    const response = await client.get(`/courier/track/awb/${awb}`);
    return response.data;
  } catch (err) {
    console.error('[Shiprocket] Tracking failed:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Failed to get tracking info');
  }
}

module.exports = {
  createOrder,
  generateAWB,
  getTrackingByAwb
};
