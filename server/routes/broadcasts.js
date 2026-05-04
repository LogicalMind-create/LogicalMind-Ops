'use strict';
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// GET /api/broadcasts
router.get('/', async (req, res) => {
  const { status, limit = 50 } = req.query;
  let query = supabase
    .from('broadcasts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Number(limit));
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/broadcasts — create draft (text-only or with media)
router.post('/', async (req, res) => {
  const { message, group_filter = 'all', media_url, media_type } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

  if (media_url && !media_type) {
    return res.status(400).json({ error: 'media_type is required when media_url is provided ("image" or "pdf")' });
  }
  if (media_type && !['image', 'pdf'].includes(media_type)) {
    return res.status(400).json({ error: 'media_type must be "image" or "pdf"' });
  }

  const insertData = { message: message.trim(), group_filter, status: 'draft' };
  if (media_url) insertData.media_url = media_url;
  if (media_type) insertData.media_type = media_type;

  const { data, error } = await supabase
    .from('broadcasts')
    .insert([insertData])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// POST /api/broadcasts/:id/approve
router.post('/:id/approve', async (req, res) => {
  const { data, error } = await supabase
    .from('broadcasts')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('status', 'draft')
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found or already approved' });
  res.json(data);
});

// POST /api/broadcasts/:id/progress — helper reports progress
router.post('/:id/progress', async (req, res) => {
  const { groups_sent, groups_total, status } = req.body;
  const update = {};
  if (groups_sent  !== undefined) update.groups_sent  = groups_sent;
  if (groups_total !== undefined) update.groups_total = groups_total;
  if (status) {
    update.status = status;
    if (status === 'sent') update.sent_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from('broadcasts').update(update)
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/broadcasts/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('broadcasts').delete()
    .eq('id', req.params.id).in('status', ['draft', 'failed']);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
