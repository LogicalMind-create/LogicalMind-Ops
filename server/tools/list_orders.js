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

function normaliseStatus(raw = '') {
  const s = raw.toLowerCase();
  if (s.includes('ready to ship') || s.includes('ready_to_ship')) return 'ready_to_ship';
  if (s.includes('pending') || s.includes('new') || s.includes('unprocessed')) return 'pending';
  if (s.includes('shipped') || s.includes('in transit'))                        return 'shipped';
  if (s.includes('delivered'))                                                  return 'delivered';
  if (s.includes('cancelled') || s.includes('canceled'))                        return 'cancelled';
  return s;
}

async function execute({ status, limit = 20 }) {
  const now = new Date();
  const orders = [];
  const warnings = [];

  // ── 1. Pull live orders from Shiprocket ─────────────────────────────────────
  try {
    const srData = await shiprocketListOrders({ per_page: limit });
    const srOrders = srData?.data?.orders || srData?.orders || [];

    if (srOrders.length === 0 && srData?.data?.meta?.pagination) {
      const total = srData.data.meta.pagination.total;
      if (total > 0) {
        warnings.push(`Shiprocket reports ${total} order(s) exist but returned an empty list — check API filters or pagination.`);
      }
    }

    for (const o of srOrders) {
      const normStatus = normaliseStatus(o.status);

      if (status) {
        const filterNorm = normaliseStatus(status);
        if (normStatus !== filterNorm) continue;
      }

      const createdAt = new Date(o.created_at || o.order_date);
      const diffDays  = isNaN(createdAt) ? null : Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

      let agentNote = 'Normal';
      if (normStatus === 'ready_to_ship') {
        agentNote = diffDays !== null && diffDays >= 2
          ? `⚠ Ready to ship but waiting ${diffDays} day(s) — DELAYED`
          : `Ready to ship${diffDays !== null ? ` (${diffDays} day(s) old)` : ''}`;
      } else if (normStatus === 'pending') {
        agentNote = diffDays !== null && diffDays >= 2
          ? `⚠ Pending for ${diffDays} day(s) — DELAYED`
          : `Pending${diffDays !== null ? ` for ${diffDays} day(s)` : ''}`;
      } else if (normStatus === 'shipped') {
        agentNote = 'In transit';
      }

      orders.push({
        source:            'Shiprocket',
        id:                o.id || o.order_id,
        external_id:       o.channel_order_id || o.order_id,
        customer:          o.customer_name  || 'N/A',
        product:           o.products?.[0]?.name || o.channel_order_id || 'N/A',
        status:            normStatus,
        raw_status:        o.status,
        awb:               o.awb_code || 'N/A',
        courier:           o.courier_name || 'N/A',
        created_at:        o.created_at || o.order_date || 'N/A',
        days_old:          diffDays,
        agent_note:        agentNote,
      });
    }
  } catch (err) {
    warnings.push(`Shiprocket API unavailable: ${err.message}. Check SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD on Render.`);
  }

  // ── 2. Also pull from local Supabase (orders added via scraper) ─────────────
  try {
    let query = supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) {
      const norm = normaliseStatus(status);
      query = norm === 'pending'
        ? query.in('status', ['pending', 'ready_to_ship'])
        : query.eq('status', norm);
    }

    const { data, error } = await query;
    if (!error && data && data.length > 0) {
      const srIds = new Set(orders.map(r => String(r.external_id)));

      for (const order of data) {
        if (srIds.has(String(order.external_id))) continue;

        const createdAt = new Date(order.order_date || order.created_at || order.scraped_at);
        const diffDays  = isNaN(createdAt) ? null : Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

        let agentNote = 'Normal';
        if (order.status === 'pending' || order.status === 'ready_to_ship') {
          const label = order.status === 'ready_to_ship' ? 'Ready to ship' : 'Pending';
          agentNote = diffDays !== null && diffDays >= 2
            ? `⚠ Pending for ${diffDays} day(s) — DELAYED`
            : `${label}${diffDays !== null ? ` for ${diffDays} day(s)` : ''}`;
        } else if (order.status === 'shipped') {
          agentNote = 'In transit';
        }

        orders.push({
          source:    'Database',
          id:        order.id,
          external_id: order.external_id,
          customer:  order.customer_name,
          product:   order.product_name,
          status:    order.status,
          awb:       order.awb || 'N/A',
          created_at: order.order_date || order.created_at,
          days_old:  diffDays,
          agent_note: agentNote,
        });
      }
    }
  } catch (_) {}

  // ── 3. Build response ────────────────────────────────────────────────────────
  if (orders.length === 0 && warnings.length > 0) {
    return {
      orders: [],
      total: 0,
      warnings,
      message: `No orders found. Issues encountered: ${warnings.join(' | ')}`,
      agent_instruction: 'Tell the user there are no orders visible right now and mention the specific warning about why Shiprocket could not be reached.',
    };
  }

  if (orders.length === 0) {
    return {
      orders: [],
      total: 0,
      message: status ? `No ${status} orders found.` : 'No orders found.',
    };
  }

  return {
    total: orders.length,
    orders,
    warnings: warnings.length ? warnings : undefined,
    agent_instruction:
      'Summarise clearly. Highlight any orders with status "ready_to_ship" as needing immediate pickup/shipping. Flag orders with ⚠ in agent_note as delayed. If warnings exist, mention Shiprocket could not be reached and data may be incomplete.',
  };
}

module.exports = { declaration, execute };
