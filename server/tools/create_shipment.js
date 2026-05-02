const supabase = require('../lib/supabase');
const shiprocket = require('../lib/shiprocket');
const telegram = require('../lib/telegram');

const declaration = {
  name: 'create_shipment',
  description: 'Creates a shipment via Shiprocket for a pending order and updates the AWB in the database. Requires the order ID from list_orders.',
  parameters: {
    type: 'OBJECT',
    properties: {
      order_id: {
        type: 'STRING',
        description: 'The UUID of the order to ship from the database.',
      }
    },
    required: ['order_id']
  }
};

async function execute({ order_id }) {
  // 1. Fetch order details
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('*')
    .eq('id', order_id)
    .single();

  if (orderErr || !order) {
    throw new Error(`Order not found: ${orderErr?.message || 'Unknown ID'}`);
  }

  if (order.status !== 'pending') {
    return { error: `Order is already in '${order.status}' status. Cannot ship.` };
  }

  // 2. Fetch product details to get dimensions
  const { data: product, error: prodErr } = await supabase
    .from('products')
    .select('*')
    .eq('sku', order.sku)
    .single();

  if (prodErr || !product) {
    throw new Error(`Product SKU '${order.sku}' not found in products table. Cannot calculate shipping dimensions.`);
  }

  // 3. Prepare Shiprocket Payload
  // Note: For a complete integration, you'd need full customer address details which the scraper should collect.
  // Assuming the scraper puts address in a JSON column or we mock it for now.
  // In a real scenario, these fields MUST come from the order data.
  const payload = {
    order_id: order.external_id,
    order_date: new Date(order.created_at).toISOString().split('T')[0],
    pickup_location: "Primary", // Must match your Shiprocket pickup location name
    channel_id: "",
    comment: "Created by LogicalMind Ops",
    billing_customer_name: order.customer_name,
    billing_last_name: "",
    billing_address: "Address Pending Scraper", // Placeholder: Ensure scraper gets address
    billing_address_2: "",
    billing_city: "Hyderabad",
    billing_pincode: "500001",
    billing_state: "Telangana",
    billing_country: "India",
    billing_email: "test@example.com",
    billing_phone: "9999999999",
    shipping_is_billing: true,
    order_items: [
      {
        name: product.name,
        sku: product.sku,
        units: order.quantity,
        selling_price: order.amount,
        discount: "",
        tax: "",
        hsn: ""
      }
    ],
    payment_method: "Prepaid",
    shipping_charges: 0,
    giftwrap_charges: 0,
    transaction_charges: 0,
    total_discount: 0,
    sub_total: order.amount,
    length: product.length_cm,
    breadth: product.breadth_cm,
    height: product.height_cm,
    weight: (product.weight_g / 1000).toFixed(2) // Shiprocket expects kg
  };

  try {
    // 4. Create Order in Shiprocket
    const srOrder = await shiprocket.createOrder(payload);
    
    // 5. Generate AWB
    const srAwb = await shiprocket.generateAWB(srOrder.shipment_id);
    
    // 6. Update Database
    await supabase
      .from('orders')
      .update({
        status: 'shipped',
        awb: srAwb.response.data.awb_code,
        shipped_at: new Date().toISOString()
      })
      .eq('id', order_id);

    const successMessage = `Successfully shipped order ${order.external_id}. AWB: ${srAwb.response.data.awb_code}`;
    
    // Notify team
    await telegram.sendMessage(`📦 ${successMessage}`);

    return { 
      success: true, 
      message: successMessage,
      awb: srAwb.response.data.awb_code,
      courier: srAwb.response.data.courier_name
    };
  } catch (err) {
    throw new Error(`Shiprocket integration error: ${err.message}`);
  }
}

module.exports = { declaration, execute };
