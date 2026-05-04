'use strict';
const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// Only forward messages from this chat (your Telegram group)
const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID ? Number(process.env.TELEGRAM_CHAT_ID) : null;

function telegramWebhookAuth(req, res, next) {
  const headerSecret = req.headers['x-telegram-bot-api-secret-token'];
  const querySecret = req.query.secret;

  const allowedSecrets = [
    process.env.TELEGRAM_WEBHOOK_SECRET,
    process.env.WEBHOOK_SECRET,
    process.env.DASHBOARD_SECRET,
  ].filter(Boolean);

  // Preferred validation path: Telegram secret_token header
  if (headerSecret && allowedSecrets.includes(headerSecret)) return next();
  // Backward-compatible path for legacy ?secret= URLs
  if (querySecret && allowedSecrets.includes(querySecret)) return next();

  console.warn('[Telegram Webhook] Rejected request: missing/invalid secret');
  return res.status(401).send('Unauthorized');
}

router.post('/', telegramWebhookAuth, async (req, res) => {
  // Always respond 200 immediately so Telegram doesn't retry
  res.status(200).json({ ok: true });

  try {
    const message = req.body.message;
    if (!message) return;

    // Only process messages from your configured Telegram group
    if (ALLOWED_CHAT_ID && message.chat?.id !== ALLOWED_CHAT_ID) {
      console.log(`[Telegram Webhook] Ignoring message from chat ${message.chat?.id} (not your group)`);
      return;
    }

    // Forward text, and also captions from media posts.
    const rawText = (message.text || message.caption || '').trim();
    if (!rawText) return;
    const text = rawText.slice(0, 3500);
    if (text.startsWith('/')) return; // Ignore bot commands

    const sender = message.from?.first_name || message.from?.username || 'Team Member';
    const alertMessage = `📲 [From Telegram]\n${sender}: ${text}`;

    const { data, error } = await supabase
      .from('broadcasts')
      .insert([{
        message: alertMessage,
        group_filter: 'channel_rings',
        status: 'approved',
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (error) {
      console.error('[Telegram Webhook] Supabase error:', error.message);
    } else {
      console.log(`[Telegram Webhook] ✅ Forwarded to WhatsApp (broadcast #${data.id})`);
    }
  } catch (err) {
    console.error('[Telegram Webhook] Error:', err.message);
  }
});

module.exports = router;
