'use strict';
const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('notification_campaigns').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', async (req, res) => {
  const { name, category, cron_rule, template_title, template_body, target_type = 'all_users' } = req.body;
  if (!name || !cron_rule || !template_title || !template_body) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { data, error } = await supabase.from('notification_campaigns').insert([{
    name, category, cron_rule, template_title, template_body, target_type
  }]).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id', async (req, res) => {
  const { is_active, template_title, template_body, cron_rule } = req.body;
  const updates = {};
  if (is_active !== undefined) updates.is_active = is_active;
  if (template_title !== undefined) updates.template_title = template_title;
  if (template_body !== undefined) updates.template_body = template_body;
  if (cron_rule !== undefined) updates.cron_rule = cron_rule;

  const { data, error } = await supabase.from('notification_campaigns')
    .update(updates).eq('id', req.params.id).select().maybeSingle();
    
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || {});
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('notification_campaigns').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
