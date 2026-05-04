'use strict';
const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { listOrders: shiprocketListOrders } = require('../lib/shiprocket');

const ACTIVE_SHIPMENT_STATUSES = ['pending', 'ready_to_ship'];
const UNDELIVERED_STATUSES = ['pending', 'ready_to_ship', 'shipped'];

function normalizeShiprocketStatus(raw = '') {
  const status = String(raw || '').toLowerCase();
  if (status.includes('ready') && status.includes('ship')) return 'ready_to_ship';
  if (status.includes('ready for pickup') || status.includes('ready for dispatch')) return 'ready_to_ship';
  if (status.includes('accepted') || status.includes('unshipped') || status.includes('processing')) return 'pending';
  if (status.includes('pending') || status.includes('new') || status.includes('unprocessed')) return 'pending';
  if (status.includes('shipped') || status.includes('in transit') || status.includes('pickup')) return 'shipped';
  if (status.includes('delivered')) return 'delivered';
  if (status.includes('cancelled') || status.includes('canceled')) return 'cancelled';
  return status.replace(/\s+/g, '_') || 'pending';
}

function normalizeShiprocketOrder(order) {
  const orderDate = order.created_at || order.order_date || null;
  const addressLine1 = order.customer_address || order.shipping_address || order.billing_address || order.address || '';
  const addressLine2 = order.customer_address2 || order.shipping_address_2 || order.billing_address_2 || '';
  const city = order.customer_city || order.shipping_city || order.billing_city || '';
  const state = order.customer_state || order.shipping_state || order.billing_state || '';
  const pincode = order.customer_pincode || order.shipping_pincode || order.billing_pincode || '';
  const externalId = order.channel_order_id || order.order_id || order.id || null;

  return {
    id: order.id || order.order_id || null,
    external_id: externalId,
    customer_name: order.customer_name || '',
    product_name: order.products?.[0]?.name || order.channel_order_id || order.order_id || 'N/A',
    status: normalizeShiprocketStatus(order.status || order.current_status || order.shipment_status),
    awb: order.awb_code || order.awb || '',
    courier: order.courier_name || '',
    address_line1: addressLine1,
    address_line2: addressLine2,
    city,
    state,
    pincode,
    order_date: orderDate,
    created_at: orderDate,
    source: 'shiprocket',
  };
}

function getOrderAgeDate(order) {
  return order.order_date || order.created_at || order.scraped_at;
}

function getAgeDays(order, now = Date.now()) {
  const ageDate = getOrderAgeDate(order);
  const parsed = new Date(ageDate).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now - parsed) / 86_400_000));
}

// GET /api/orders - list orders with delay flags
router.get('/', async (req, res) => {
  const { status, limit = 50, start_date, end_date, undelivered_only } = req.query;

  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 500)) : 50;

  const applyFilters = (queryBuilder) => {
    let q = queryBuilder.limit(safeLimit);

    if (status && status !== 'all') {
      if (status === 'pending') {
        q = q.in('status', ACTIVE_SHIPMENT_STATUSES);
      } else {
        q = q.eq('status', status);
      }
    }

    if (String(undelivered_only).toLowerCase() === 'true') {
      q = q.in('status', UNDELIVERED_STATUSES);
    }

    if (start_date) {
      const fromIso = new Date(`${start_date}T00:00:00.000Z`).toISOString();
      q = q.gte('order_date', fromIso);
    }

    if (end_date) {
      const toIso = new Date(`${end_date}T23:59:59.999Z`).toISOString();
      q = q.lte('order_date', toIso);
    }

    return q;
  };

  let query = applyFilters(
    supabase
      .from('orders')
      .select('*')
      .order('order_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
  );

  let { data, error } = await query;

  if (error && /column .* does not exist/i.test(error.message || '')) {
    // Backward compatibility for old schema where order_date is missing.
    const applyFallbackFilters = (queryBuilder) => {
      let q = queryBuilder.limit(safeLimit);

      if (status && status !== 'all') {
        if (status === 'pending') {
          q = q.in('status', ACTIVE_SHIPMENT_STATUSES);
        } else {
          q = q.eq('status', status);
        }
      }

      if (String(undelivered_only).toLowerCase() === 'true') {
        q = q.in('status', UNDELIVERED_STATUSES);
      }

      // No date filtering possible in fallback mode because order_date is absent.
      return q;
    };

    query = applyFallbackFilters(
      supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
    );

    ({ data, error } = await query);
  }

  if (error) return res.status(500).json({ error: error.message });

  const now = Date.now();
  const dbOrders = (data || []).map((order) => {
    const ageDays = getAgeDays(order, now);
    const isActionable = ACTIVE_SHIPMENT_STATUSES.includes(order.status);

    let delay_flag = null;
    if (isActionable && ageDays >= 2) {
      delay_flag = `Waiting ${ageDays} day${ageDays !== 1 ? 's' : ''} - needs action`;
    } else if (isActionable && ageDays === 1) {
      delay_flag = 'Waiting 1 day';
    }

    return {
      ...order,
      age_days: ageDays,
      age_source: order.order_date ? 'order_date' : 'created_at',
      delay_flag,
    };
  });

  let orders = dbOrders;
  const includeShiprocket = String(req.query.include_shiprocket).toLowerCase() === 'true';

  if (includeShiprocket) {
    try {
      const shiprocketResponse = await shiprocketListOrders({ per_page: safeLimit });
      const existingIds = new Set(orders.map((o) => String(o.external_id || o.id)));
      const shiprocketOrders = (shiprocketResponse?.data?.orders || shiprocketResponse?.orders || [])
        .map(normalizeShiprocketOrder)
        .filter((order) => !existingIds.has(String(order.external_id || order.id)))
        .map((order) => {
          const ageDays = getAgeDays(order, now);
          const isActionable = ACTIVE_SHIPMENT_STATUSES.includes(order.status);

          let delay_flag = null;
          if (isActionable && ageDays >= 2) {
            delay_flag = `Waiting ${ageDays} day${ageDays !== 1 ? 's' : ''} - needs action`;
          } else if (isActionable && ageDays === 1) {
            delay_flag = 'Waiting 1 day';
          }

          return {
            ...order,
            age_days: ageDays,
            age_source: order.order_date ? 'order_date' : 'created_at',
            delay_flag,
          };
        });

      orders = orders.concat(shiprocketOrders);
    } catch (err) {
      console.error('[Orders] Shiprocket live sync failed:', err.message || err);
    }
  }

  res.json(orders);
});

// GET /api/orders/stats - for the home dashboard cards
router.get('/stats', async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: todayOrders, error: todayErr } = await supabase
    .from('orders')
    .select('id, status')
    .gte('scraped_at', today.toISOString());
  if (todayErr) return res.status(500).json({ error: todayErr.message });

  const { count: pendingCount, error: pendingErr } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .in('status', ACTIVE_SHIPMENT_STATUSES);
  if (pendingErr) return res.status(500).json({ error: pendingErr.message });

  const { data: activeOrders, error: activeErr } = await supabase
    .from('orders')
    .select('id, order_date, created_at, scraped_at, status')
    .in('status', ACTIVE_SHIPMENT_STATUSES);
  if (activeErr) return res.status(500).json({ error: activeErr.message });

  const delayedCount = (activeOrders || []).filter((order) => {
    const ageDays = getAgeDays(order);
    return ageDays !== null && ageDays >= 2;
  }).length;

  res.json({
    today_count: todayOrders?.length ?? 0,
    pending_count: pendingCount ?? 0,
    delayed_count: delayedCount,
  });
});

module.exports = router;
