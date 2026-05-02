const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const telegram = require('../lib/telegram');

router.post('/', async (req, res) => {
  try {
    const payload = req.body;
    
    // Shiprocket sends tracking updates in the webhook payload.
    // Important fields: awb, current_status, shipment_status
    if (!payload || !payload.awb) {
      return res.status(400).send('Invalid payload');
    }

    const awb = payload.awb;
    const status = payload.current_status || '';
    const statusId = payload.shipment_status;
    
    let dbStatus = null;
    let deliveredAt = null;

    // Map Shiprocket status to our DB status
    if (status.toLowerCase().includes('delivered') || statusId === 7) {
      dbStatus = 'delivered';
      deliveredAt = new Date().toISOString();
    } else if (status.toLowerCase().includes('cancelled') || statusId === 5) {
      dbStatus = 'cancelled';
    } else if (status.toLowerCase().includes('shipped') || statusId === 8 || statusId === 17) {
      dbStatus = 'shipped'; // In transit
    }

    if (dbStatus) {
      const updateData = { status: dbStatus };
      if (deliveredAt) {
        updateData.delivered_at = deliveredAt;
      }
      
      const { data, error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('awb', awb)
        .select()
        .single();
        
      if (!error && data) {
        // Send a telegram notification if delivered
        if (dbStatus === 'delivered') {
          await telegram.sendMessage(`✅ Order ${data.external_id} has been delivered! (AWB: ${awb})`);
        } else if (dbStatus === 'cancelled') {
           await telegram.sendMessage(`❌ Order ${data.external_id} has been cancelled! (AWB: ${awb})`);
        }
      }
    }

    res.status(200).send('Webhook received');
  } catch (err) {
    console.error('[Webhook] Shiprocket error:', err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
