'use strict';
const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

/**
 * Telegram webhook — receives messages and forwards to Channel Rings WhatsApp
 *
 * Configured on Telegram Bot API:
 * POST https://logicalmind-ops.onrender.com/webhooks/telegram
 */

router.post('/', async (req, res) => {
  try {
    const message = req.body.message;
    if (!message || !message.text) {
      return res.status(200).json({ ok: true }); // Ignore non-text messages
    }

    const sender = message.from?.first_name || message.from?.username || 'Team Member';
    const text = message.text.trim();

    // Ignore command messages
    if (text.startsWith('/')) {
      return res.status(200).json({ ok: true });
    }

    // Create a broadcast alert directly for Channel Rings
    // This gets picked up by helper.js polling /api/broadcasts
    const alertMessage = `📲 <b>[From Telegram]</b>\n${sender}:\n${text}`;

    const { data, error } = await supabase
      .from('broadcasts')
      .insert([{
        message: alertMessage,
        group_filter: 'channel_rings', // Send only to Channel Rings team group
        status: 'approved', // Auto-approved so helper sends immediately
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (error) {
      console.error('[Telegram Webhook] Error creating broadcast:', error.message);
      return res.status(500).json({ ok: false, error: error.message });
    }

    console.log(`[Telegram Webhook] ✅ Message forwarded to WhatsApp (broadcast #${data.id})`);
    res.status(200).json({ ok: true, broadcast_id: data.id });
  } catch (err) {
    console.error('[Telegram Webhook] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
