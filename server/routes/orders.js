'use strict';
const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// GET /api/orders — list orders with delay flags
router.get('/', async (req, res) => {
  const { status, limit = 50 } = req.query;

  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Number(limit));

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const now = Date.now();
  const orders = (data || []).map((o) => {
    const ageMs  = now - new Date(o.created_at).getTime();
    const ageDays = Math.floor(ageMs / 86_400_000);

    let delay_flag = null;
    if (o.status === 'pending' && ageDays >= 2) {
      delay_flag = `Waiting ${ageDays} day${ageDays !== 1 ? 's' : ''} — needs action`;
    } else if (o.status === 'pending' && ageDays === 1) {
      delay_flag = `Waiting 1 day`;
    }

    return { ...o, age_days: ageDays, delay_flag };
  });

  res.json(orders);
});

// GET /api/orders/stats — for the home dashboard cards
router.get('/stats', async (req, res) => {
  // Orders scraped today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: todayOrders } = await supabase
    .from('orders')
    .select('id, status')
    .gte('scraped_at', today.toISOString());

  // Total pending that need shipping
  const { count: pendingCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  // Orders delayed ≥ 2 days
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { count: delayedCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .lt('created_at', twoDaysAgo);

  res.json({
    today_count: todayOrders?.length ?? 0,
    pending_count: pendingCount ?? 0,
    delayed_count: delayedCount ?? 0,
  });
});

module.exports = router;
