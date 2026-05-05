'use strict';
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const rateLimit = require('express-rate-limit');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Groq llama-3.3-70b: 30 requests/minute limit (https://console.groq.com/docs/rate-limits)
// We use 60/min to leave headroom and allow multi-turn agent loops
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/health',         require('./routes/health'));
app.use('/api/chat',       chatLimiter, require('./routes/chat'));
app.use('/api/tasks',      require('./routes/tasks'));
app.use('/api/orders',     require('./routes/orders'));
app.use('/api/broadcasts', require('./routes/broadcasts'));

// Webhooks (no auth — external services call these)
app.use('/webhooks/shiprocket', require('./webhooks/shiprocket'));
app.use('/webhooks/telegram', require('./webhooks/telegram'));

// Session saving endpoint for SmartBiz scraper
app.post('/save-session', async (req, res) => {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const sessionData = req.body;
    console.log('[Session Save] Received session data from browser');

    // Save to Supabase
    const { error } = await supabase
      .from('scraper_sessions')
      .upsert({
        key: 'smartbiz',
        cookies: JSON.stringify(sessionData),
        saved_at: new Date().toISOString()
      }, { onConflict: 'key' });

    if (error) throw error;

    console.log('[Session Save] ✓ Session saved to Supabase successfully');
    res.json({ success: true, message: 'Session saved successfully' });
  } catch (err) {
    console.error('[Session Save] ❌ Error saving session:', err.message);
    res.status(500).json({ error: 'Failed to save session', detail: err.message });
  }
});

// Catch-all: serve dashboard SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ─── Error handler ───────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    error: 'Internal server error',
    detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ─── Register Telegram webhook (runs in production on startup) ───────────────
async function registerTelegramWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const appUrl = process.env.APP_URL;
  if (!token || !appUrl) return;

  const baseWebhookUrl = `${appUrl.replace(/\/$/, '')}/webhooks/telegram`;
  const querySecret = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';
  const webhookUrl = querySecret
    ? `${baseWebhookUrl}?secret=${encodeURIComponent(querySecret)}`
    : baseWebhookUrl;
  const body = { url: webhookUrl, allowed_updates: ['message'] };
  if (process.env.TELEGRAM_WEBHOOK_SECRET) {
    body.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) {
      console.log(`[Telegram] ✅ Webhook registered: ${webhookUrl}`);
    } else {
      console.warn('[Telegram] ⚠️  Webhook registration failed:', data.description);
    }
  } catch (err) {
    console.warn('[Telegram] ⚠️  Could not register webhook:', err.message);
  }
}

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀 LogicalMind Ops running on http://localhost:${PORT}`);
  console.log(`   Phase 2 — Orders + Shiprocket active`);
  console.log(`   Phase 3 — WhatsApp broadcasts active`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);

  // Register Telegram webhook so the bot receives group messages
  if (process.env.NODE_ENV === 'production') {
    await registerTelegramWebhook();
  }

  // Start order poller for Channel Rings alerts
  if (process.env.WHATSAPP_GROUP_CHANNEL_RINGS_NAME) {
    require('./jobs/orderPoller').start();
  } else {
    console.warn('[⚠️  Warning] WHATSAPP_GROUP_CHANNEL_RINGS_NAME not set — order alerts disabled');
  }
});

module.exports = app;
