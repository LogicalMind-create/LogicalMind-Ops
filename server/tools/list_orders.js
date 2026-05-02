const supabase = require('../lib/supabase');
const { listOrders: shiprocketListOrders } = require('../lib/shiprocket');

const declaration = {
  name: 'list_orders',
  description: 'Lists orders from Shiprocket and the local database. Shows status, age in days, and highlights delayed or ready-to-ship orders. Use this to find pending, ready to ship, shipped, or delivered orders.',
  parameters: {
    type: 'OBJECT',
    properties: {
      status: {
        type: 'STRING',
        description: 'Optional filter by order status (e.g., pending, ready to ship, shipped, delivered, cancelled). Leave empty to list all.',
      },
      limit: {
        type: 'INTEGER',
        description: 'Maximum number of orders to return. Default is 20.',
      }
    }
  }
};

// Map Shiprocket status strings to normalised values
function normaliseStatus(raw = '') {
  const s = raw.toLowerCase();
  if (s.includes('ready to ship') || s.includes('ready_to_ship')) return 'ready_to_ship';
  if (s.includes('pending') || s.includes('new'))                  return 'pending';
  if (s.includes('shipped') || s.includes('in transit'))           return 'shipped';
  if (s.includes('delivered'))                                      return 'delivered';
  if (s.includes('cancelled') || s.includes('canceled'))           return 'cancelled';
  return s;
}

async function execute({ status, limit = 20 }) {
  const now = new Date();
  const results = [];

  // ── 1. Pull live orders from Shiprocket ─────────────────────────
  try {
    const srData = await shiprocketListOrders({ per_page: limit });
    const srOrders = srData?.data?.orders || srData?.orders || [];

    for (const o of srOrders) {
      const normStatus = normaliseStatus(o.status);

      // Apply status filter if requested
      if (status) {
        const filterNorm = normaliseStatus(status);
        if (normStatus !== filterNorm) continue;
      }

      const createdAt = new Date(o.created_at || o.order_date);
      const diffDays  = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

      let agentNote = 'Normal';
      if (normStatus === 'ready_to_ship') {
        agentNote = diffDays >= 2
          ? `⚠ Ready to ship but waiting for pickup for ${diffDays} day(s) — DELAYED`
          : `Ready to ship (${diffDays} day(s) old)`;
      } else if (normStatus === 'pending') {
        agentNote = diffDays >= 2
          ? `⚠ Pending for ${diffDays} day(s) — DELAYED`
          : `Pending for ${diffDays} day(s)`;
      } else if (normStatus === 'shipped') {
        agentNote = `In transit`;
      }

      results.push({
        source:            'Shiprocket',
        id:                o.id || o.order_id,
        external_id:       o.channel_order_id || o.order_id,
        customer:          o.customer_name  || 'N/A',
        product:           o.products?.[0]?.name || o.channel_order_id || 'N/A',
        status:            normStatus,
        shiprocket_status: o.status,
        awb:               o.awb_code || 'N/A',
        courier:           o.courier_name || 'N/A',
        created_at:        o.created_at || o.order_date,
        days_since_creation: diffDays,
        agent_note:        agentNote,
      });
    }
  } catch (err) {
    // Don't hard-fail — fall through to Supabase results
    results.push({ source: 'Shiprocket', error: `Could not fetch from Shiprocket: ${err.message}` });
  }

  // ── 2. Also pull from local Supabase (orders added via scraper) ──
  try {
    let query = supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', normaliseStatus(status));
    }

    const { data, error } = await query;
    if (!error && data && data.length > 0) {
      const srIds = new Set(results.map(r => String(r.external_id)));

      for (const order of data) {
        // Skip duplicates already returned from Shiprocket
        if (srIds.has(String(order.external_id))) continue;

        const createdAt = new Date(order.created_at);
        const diffDays  = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

        let agentNote = 'Normal';
        if (order.status === 'pending' && diffDays >= 2) {
          agentNote = `⚠ Pending for ${diffDays} day(s) — DELAYED`;
        } else if (order.status === 'pending') {
          agentNote = `Pending for ${diffDays} day(s)`;
        } else if (order.status === 'shipped') {
          agentNote = `In transit`;
        }

        results.push({
          source:              'Database',
          id:                  order.id,
          external_id:         order.external_id,
          customer:            order.customer_name,
          product:             order.product_name,
          status:              order.status,
          awb:                 order.awb || 'N/A',
          created_at:          order.created_at,
          days_since_creation: diffDays,
          agent_note:          agentNote,
        });
      }
    }
  } catch (_) {}

  if (results.length === 0) {
    return {
      message: status
        ? `No ${status} orders found in Shiprocket or the database.`
        : 'No orders found in Shiprocket or the database.',
    };
  }

  return {
    total: results.length,
    orders: results,
    agent_instruction:
      'Summarise clearly. Highlight any orders with status "ready_to_ship" as needing immediate pickup/shipping. Flag orders with ⚠ in agent_note as delayed.',
  };
}

module.exports = { declaration, execute };
