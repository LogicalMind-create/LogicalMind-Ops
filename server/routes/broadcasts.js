'use strict';
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const UPLOAD_DIR = path.join(__dirname, '../public/uploads');
const PUBLIC_UPLOAD_PATH = '/uploads';

async function ensureUploadDirectory() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (err) {
    console.error('[broadcasts] Could not ensure upload directory:', err.message);
  }
}

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

// POST /api/broadcasts/upload-media — upload a local image or PDF and receive a public URL
router.post('/upload-media', async (req, res) => {
  const { filename, content_type, data } = req.body;
  if (!filename || !content_type || !data) {
    return res.status(400).json({ error: 'filename, content_type, and data are required' });
  }

  const normalizedType = String(content_type).toLowerCase();
  const extension = normalizedType === 'application/pdf'
    ? 'pdf'
    : normalizedType.startsWith('image/')
      ? normalizedType.split('/')[1]
      : null;

  if (!extension || !['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
    return res.status(400).json({ error: 'Only image or PDF uploads are supported' });
  }

  const mediaType = normalizedType === 'application/pdf' ? 'pdf' : 'image';
  const match = String(data).match(/^data:.+;base64,(.*)$/);
  const base64Payload = match ? match[1] : data;

  try {
    await ensureUploadDirectory();
    const safeName = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const filePath = path.join(UPLOAD_DIR, safeName);
    const fileBuffer = Buffer.from(base64Payload, 'base64');
    await fs.writeFile(filePath, fileBuffer);

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const mediaUrl = `${baseUrl}${PUBLIC_UPLOAD_PATH}/${safeName}`;
    res.status(201).json({ media_url: mediaUrl, media_type: mediaType });
  } catch (err) {
    console.error('[broadcasts] upload-media error:', err.message);
    res.status(500).json({ error: 'Failed to upload media' });
  }
});

// POST /api/broadcasts/:id/approve
router.post('/:id/approve', async (req, res) => {
  const { data, error } = await supabase
    .from('broadcasts')
    .update({ status: 'approved', approved_at: new Date().toISOString(), error_reason: null })
    .eq('id', req.params.id).eq('status', 'draft')
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found or already approved' });
  res.json(data);
});

// POST /api/broadcasts/:id/retry — re-queue a failed broadcast for the helper
router.post('/:id/retry', async (req, res) => {
  const { data: existing, error: selErr } = await supabase
    .from('broadcasts')
    .select('id, status')
    .eq('id', req.params.id)
    .maybeSingle();
  if (selErr) return res.status(500).json({ error: selErr.message });
  if (!existing) return res.status(404).json({ error: 'Broadcast not found' });
  if (existing.status !== 'failed') {
    return res.status(400).json({ error: 'Only failed broadcasts can be retried' });
  }

  const { data, error } = await supabase
    .from('broadcasts')
    .update({
      status: 'approved',
      error_reason: null,
      groups_sent: 0,
      groups_total: 0,
      approved_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('status', 'failed')
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Broadcast not found or not failed' });
  res.json(data);
});

// POST /api/broadcasts/:id/progress — helper reports progress
router.post('/:id/progress', async (req, res) => {
  const { groups_sent, groups_total, status, error_reason } = req.body;
  const update = {};
  if (groups_sent  !== undefined) update.groups_sent  = groups_sent;
  if (groups_total !== undefined) update.groups_total = groups_total;
  if (status) {
    update.status = status;
    if (status === 'sent') update.sent_at = new Date().toISOString();
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'error_reason')) {
    update.error_reason = error_reason;
  } else if (status === 'sent') {
    update.error_reason = null;
  }
  const { data, error } = await supabase
    .from('broadcasts').update(update)
    .eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Broadcast not found' });
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
