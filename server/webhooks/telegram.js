'use strict';
const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireWebhookSecret } = require('../lib/webhookAuth');

// Only forward messages from this chat (your Telegram group)
const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID ? Number(process.env.TELEGRAM_CHAT_ID) : null;

router.post('/', requireWebhookSecret(['TELEGRAM_WEBHOOK_SECRET', 'WEBHOOK_SECRET']), async (req, res) => {
  // Always respond 200 immediately so Telegram doesn't retry
  res.status(200).json({ ok: true });

  try {
    const message = req.body.message;
    if (!message || !message.text) return;

    // Only process messages from your configured Telegram group
    if (ALLOWED_CHAT_ID && message.chat?.id !== ALLOWED_CHAT_ID) {
      console.log(`[Telegram Webhook] Ignoring message from chat ${message.chat?.id} (not your group)`);
      return;
    }

    const text = message.text.trim();
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
