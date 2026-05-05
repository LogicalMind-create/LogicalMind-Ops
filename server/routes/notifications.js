'use strict';
const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

router.get('/', async (req, res) => {
  const { status, limit = 50 } = req.query;
  let query = supabase.from('app_notifications').select('*').order('created_at', { ascending: false }).limit(Number(limit));
  if (status && status !== 'all') query = query.eq('status', status);
  
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', async (req, res) => {
  const { title, body, target_type = 'all_users', category = 'marketing', scheduled_for } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });

  const { data, error } = await supabase.from('app_notifications').insert([{
    title, body, target_type, category, scheduled_for: scheduled_for || null, status: 'pending_approval'
  }]).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.post('/:id/approve', async (req, res) => {
  const { data, error } = await supabase.from('app_notifications')
    .update({ status: 'approved', error_reason: null })
    .eq('id', req.params.id)
    .eq('status', 'pending_approval')
    .select().maybeSingle();
    
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found or already approved' });
  res.json(data);
});

router.post('/:id/reject', async (req, res) => {
  const { data, error } = await supabase.from('app_notifications')
    .update({ status: 'draft' })
    .eq('id', req.params.id)
    .eq('status', 'pending_approval')
    .select().maybeSingle();
    
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found or not pending approval' });
  res.json(data);
});

router.get('/stats', async (req, res) => {
  // pending count
  const { count: pendingCount, error: err1 } = await supabase.from('app_notifications')
    .select('*', { count: 'exact', head: true }).eq('status', 'pending_approval');
    
  // sent today
  const today = new Date();
  today.setHours(0,0,0,0);
  const { count: sentCount, error: err2 } = await supabase.from('app_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gte('sent_at', today.toISOString());
    
  if (err1 || err2) return res.status(500).json({ error: err1?.message || err2?.message });
  res.json({ pending: pendingCount || 0, sentToday: sentCount || 0 });
});

module.exports = router;
