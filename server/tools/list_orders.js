const supabase = require('../lib/supabase');
const { listOrders: shiprocketListOrders } = require('../lib/shiprocket');

const declaration = {
  name: 'list_orders',
  description: 'Lists orders from the dashboard database and optionally enriches them from Shiprocket. Shows status, age in days, and highlights delayed or ready-to-ship orders. Use this to find pending, ready to ship, shipped, or delivered orders.',
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
      },
    },
  },
};

function normaliseStatus(raw = '') {
  const s = raw.toLowerCase().replace(/[_-]/g, ' ');
  if (s.includes('ready to ship')) return 'ready_to_ship';
  if (s.includes('ready for pickup') || s.includes('ready for dispatch')) return 'ready_to_ship';
  if (s.includes('accepted') || s.includes('unshipped') || s.includes('processing')) return 'pending';
  if (s.includes('pending') || s.includes('new') || s.includes('unprocessed')) return 'pending';
  if (s.includes('shipped') || s.includes('in transit') || s.includes('pickup')) return 'shipped';
  if (s.includes('delivered')) return 'delivered';
  if (s.includes('cancelled') || s.includes('canceled')) return 'cancelled';
  return s.trim().replace(/\s+/g, '_');
}

function getDaysOld(orderDate, now) {
  const createdAt = new Date(orderDate);
  return isNaN(createdAt) ? null : Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
}

function getAgentNote(status, daysOld) {
  if (status === 'ready_to_ship') {
    return daysOld !== null && daysOld >= 2
      ? `Ready to ship but waiting ${daysOld} day(s) - DELAYED`
      : `Ready to ship${daysOld !== null ? ` (${daysOld} day(s) old)` : ''}`;
  }
  if (status === 'pending') {
    return daysOld !== null && daysOld >= 2
      ? `Pending for ${daysOld} day(s) - DELAYED`
      : `Pending${daysOld !== null ? ` for ${daysOld} day(s)` : ''}`;
  }
  if (status === 'shipped') return 'In transit';
  if (status === 'delivered') return 'Delivered';
  return 'Normal';
}

function compactText(v) {
  return String(v || '').trim();
}

function buildAddress(parts = []) {
  const clean = parts.map(compactText).filter(Boolean);
  return clean.length ? clean.join(', ') : 'N/A';
}

async function loadDatabaseOrders({ filterNorm, limit, now }) {
  let query = supabase
    .from('orders')
    .select('*')
    .order('order_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filterNorm) {
    query = filterNorm === 'pending'
      ? query.in('status', ['pending', 'ready_to_ship'])
      : query.eq('status', filterNorm);
  }

  let { data, error } = await query;
  if (error && /column .* does not exist/i.test(error.message || '')) {
    // Backward compatibility for old schemas missing order_date.
    query = supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (filterNorm) {
      query = filterNorm === 'pending'
        ? query.in('status', ['pending', 'ready_to_ship'])
        : query.eq('status', filterNorm);
    }

    ({ data, error } = await query);
  }
  if (error) throw new Error(error.message);

  return (data || []).map((order) => {
    const orderDate = order.order_date || order.created_at || order.scraped_at;
    const statusNorm = normaliseStatus(order.status);
    const daysOld = getDaysOld(orderDate, now);

    return {
      source: 'Database',
      id: order.id,
      external_id: order.external_id,
      customer: order.customer_name || 'N/A',
      product: order.product_name || 'N/A',
      status: statusNorm,
      awb: order.awb || 'N/A',
      courier: order.courier || 'N/A',
      address: buildAddress([
        order.address_line1,
        order.address_line2,
        order.city,
        order.state,
        order.pincode,
      ]),
      city: order.city || 'N/A',
      state: order.state || 'N/A',
      pincode: order.pincode || 'N/A',
      created_at: orderDate || 'N/A',
      days_old: daysOld,
      agent_note: getAgentNote(statusNorm, daysOld),
    };
  });
}

async function loadShiprocketOrders({ filterNorm, limit, now, existingIds }) {
  const srData = await shiprocketListOrders({ per_page: limit });
  const srOrders = srData?.data?.orders || srData?.orders || [];

  return srOrders
    .map((o) => {
      const status = normaliseStatus(o.status);
      const externalId = o.channel_order_id || o.order_id || o.id;
      const orderDate = o.created_at || o.order_date;
      const daysOld = getDaysOld(orderDate, now);
      const addressLine = o.customer_address || o.shipping_address || o.billing_address || o.address || '';
      const city = o.customer_city || o.shipping_city || o.billing_city || '';
      const state = o.customer_state || o.shipping_state || o.billing_state || '';
      const pincode = o.customer_pincode || o.shipping_pincode || o.billing_pincode || '';

      return {
        source: 'Shiprocket',
        id: o.id || o.order_id,
        external_id: externalId,
        customer: o.customer_name || 'N/A',
        product: o.products?.[0]?.name || o.channel_order_id || 'N/A',
        status,
        raw_status: o.status,
        awb: o.awb_code || 'N/A',
        courier: o.courier_name || 'N/A',
        address: buildAddress([addressLine, city, state, pincode]),
        city: city || 'N/A',
        state: state || 'N/A',
        pincode: pincode || 'N/A',
        created_at: orderDate || 'N/A',
        days_old: daysOld,
        agent_note: getAgentNote(status, daysOld),
      };
    })
    .filter((order) => !filterNorm || order.status === filterNorm)
    .filter((order) => !existingIds.has(String(order.external_id || order.id)));
}

async function execute({ status, limit = 20 }) {
  const now = new Date();
  const filterNorm = status && status !== 'all' ? normaliseStatus(status) : '';
  const warnings = [];
  let orders = [];

  try {
    orders = await loadDatabaseOrders({ filterNorm, limit, now });
  } catch (err) {
    warnings.push(`Dashboard database unavailable: ${err.message}`);
  }

  try {
    const existingIds = new Set(orders.map((order) => String(order.external_id || order.id)));
    const shiprocketOrders = await loadShiprocketOrders({ filterNorm, limit, now, existingIds });
    orders.push(...shiprocketOrders);
  } catch (err) {
    warnings.push(`Shiprocket live sync unavailable: ${err.message}. Showing dashboard database results only.`);
  }

  if (orders.length === 0 && warnings.length > 0) {
    return {
      orders: [],
      total: 0,
      warnings,
      message: `No ${status || ''} orders found in the dashboard database. Issues encountered: ${warnings.join(' | ')}`,
      agent_instruction: 'Tell the user there are no matching orders visible in the dashboard database. Mention the warnings without guessing that credentials are wrong.',
    };
  }

  if (orders.length === 0) {
    return {
      orders: [],
      total: 0,
      message: status ? `No ${status} orders found in the dashboard database.` : 'No orders found in the dashboard database.',
    };
  }

  return {
    total: orders.length,
    orders,
    warnings: warnings.length ? warnings : undefined,
    agent_instruction:
      'Summarise clearly. Highlight ready_to_ship orders as needing immediate pickup/shipping. Flag DELAYED orders. If warnings exist, say live Shiprocket sync was unavailable but dashboard database results are shown.',
  };
}

module.exports = { declaration, execute };
