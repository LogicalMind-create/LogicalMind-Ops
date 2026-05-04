'use strict';
const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

const ACTIVE_SHIPMENT_STATUSES = ['pending', 'ready_to_ship'];

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
  const { status, limit = 50 } = req.query;

  let query = supabase
    .from('orders')
    .select('*')
    .order('order_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(Number(limit));

  if (status && status !== 'all') {
    if (status === 'pending') {
      query = query.in('status', ACTIVE_SHIPMENT_STATUSES);
    } else {
      query = query.eq('status', status);
    }
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const now = Date.now();
  const orders = (data || []).map((order) => {
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
