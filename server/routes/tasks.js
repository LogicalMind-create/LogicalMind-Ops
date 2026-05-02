'use strict';
const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

/**
 * GET /api/tasks?person=&status=pending
 */
router.get('/', async (req, res) => {
  const { person, status = 'pending' } = req.query;

  let query = supabase
    .from('tasks')
    .select('*')
    .order('due_date', { ascending: true });

  if (person) query = query.ilike('person', `%${person}%`);
  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query.limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

/**
 * POST /api/tasks
 * Body: { person, title, due_date, notes? }
 */
router.post('/', async (req, res) => {
  const { person, title, due_date, notes = '' } = req.body;
  if (!person || !title || !due_date) {
    return res.status(400).json({ error: 'person, title, due_date required' });
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert([{ person, title, due_date, notes, status: 'pending' }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

/**
 * PATCH /api/tasks/:id
 * Body: { status: 'done' | 'pending' }
 */
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const updates = {};

  if (req.body.status) updates.status = req.body.status;
  if (req.body.status === 'done') updates.completed_at = new Date().toISOString();
  if (req.body.title) updates.title = req.body.title;
  if (req.body.notes !== undefined) updates.notes = req.body.notes;

  const { data, error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

/**
 * DELETE /api/tasks/:id
 */
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('tasks').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

module.exports = router;
