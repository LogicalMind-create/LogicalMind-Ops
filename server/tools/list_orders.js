const supabase = require('../lib/supabase');

const declaration = {
  name: 'list_orders',
  description: 'Lists orders from the database, including their status, age in days, and customer details. Use this to find pending, shipped, or delayed orders.',
  parameters: {
    type: 'OBJECT',
    properties: {
      status: {
        type: 'STRING',
        description: 'Optional filter by order status (e.g., pending, shipped, delivered, cancelled). Leave empty to list all.',
      },
      limit: {
        type: 'INTEGER',
        description: 'Maximum number of orders to return. Default is 20.',
      }
    }
  }
};

async function execute({ status, limit = 20 }) {
  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq('status', status.toLowerCase());
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list orders: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return { message: status ? `No ${status} orders found.` : 'No orders found.' };
  }

  const now = new Date();

  // Add calculated fields to help the agent understand delays
  const ordersWithContext = data.map(order => {
    const createdAt = new Date(order.created_at);
    const diffTime = Math.abs(now - createdAt);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    let phase = order.status;
    let warning = null;

    if (order.status === 'pending') {
      if (diffDays >= 2) {
        warning = `Delayed: Waiting for shipment for ${diffDays} days.`;
      } else {
        warning = `Waiting for shipment for ${diffDays} days.`;
      }
    } else if (order.status === 'shipped') {
       if (order.shipped_at) {
          const shippedAt = new Date(order.shipped_at);
          const shippedDays = Math.floor(Math.abs(now - shippedAt) / (1000 * 60 * 60 * 24));
          warning = `In transit for ${shippedDays} days.`;
       } else {
          warning = `Shipped ${diffDays} days ago.`;
       }
    }

    return {
      id: order.id,
      external_id: order.external_id,
      customer: order.customer_name,
      product: order.product_name,
      sku: order.sku,
      status: order.status,
      awb: order.awb || 'N/A',
      created_at: order.created_at,
      days_since_creation: diffDays,
      agent_note: warning || 'Normal'
    };
  });

  return { 
    total: data.length, 
    orders: ordersWithContext,
    agent_instruction: "When summarizing, explicitly mention orders that are stuck in waiting/pending for multiple days as 'delayed'."
  };
}

module.exports = { declaration, execute };
