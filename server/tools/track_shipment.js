const shiprocket = require('../lib/shiprocket');
const supabase = require('../lib/supabase');

const declaration = {
  name: 'track_shipment',
  description: 'Tracks a shipment using its AWB code via Shiprocket API. If you have an order ID instead, you should use list_orders first to find its AWB.',
  parameters: {
    type: 'OBJECT',
    properties: {
      awb: {
        type: 'STRING',
        description: 'The AWB (Air Waybill) code to track.',
      }
    },
    required: ['awb']
  }
};

async function execute({ awb }) {
  try {
    const trackingData = await shiprocket.getTrackingByAwb(awb);
    
    if (!trackingData || !trackingData.tracking_data || trackingData.tracking_data.error) {
       return { error: `Tracking not found or error for AWB ${awb}` };
    }

    const info = trackingData.tracking_data;
    
    // Sync status back to DB if delivered
    if (info.shipment_status === 7 || info.shipment_track?.[0]?.current_status === 'Delivered') {
      await supabase
        .from('orders')
        .update({
          status: 'delivered',
          delivered_at: new Date().toISOString()
        })
        .eq('awb', awb);
    }

    return {
      awb: awb,
      status: info.shipment_track?.[0]?.current_status || 'Unknown',
      location: info.shipment_track?.[0]?.location || 'Unknown',
      expected_delivery: info.etd || 'Not available',
      raw_status_id: info.shipment_status
    };
  } catch (err) {
    throw new Error(`Failed to track shipment: ${err.message}`);
  }
}

module.exports = { declaration, execute };
