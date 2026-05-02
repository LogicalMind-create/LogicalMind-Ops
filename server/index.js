'use strict';
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Rate limit chat endpoint — Gemini free tier: 15 req/min
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12, // slightly under limit to be safe
  message: { error: 'Too many requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Simple auth middleware ──────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const secret = process.env.DASHBOARD_SECRET;
  // No secret configured — open access (dev/test)
  if (!secret) return next();
  // Development — skip auth
  if (process.env.NODE_ENV !== 'production') return next();
  // Same-origin requests from the dashboard (Referer matches host)
  const referer = req.headers['referer'] || req.headers['origin'] || '';
  const host = req.headers['host'] || '';
  if (referer.includes(host)) return next();
  // Explicit secret header
  const provided = req.headers['x-dashboard-secret'];
  if (provided === secret) return next();

  return res.status(401).json({ error: 'Unauthorized' });
}

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/health', require('./routes/health'));
app.use('/api/chat',       authMiddleware, chatLimiter, require('./routes/chat'));
app.use('/api/tasks',      authMiddleware, require('./routes/tasks'));
app.use('/api/orders',     authMiddleware, require('./routes/orders'));
app.use('/api/broadcasts', authMiddleware, require('./routes/broadcasts'));

// Webhooks (no auth middleware because external services call this)
app.use('/webhooks/shiprocket', require('./webhooks/shiprocket'));
app.use('/webhooks/telegram', require('./webhooks/telegram'));

// Catch-all: serve dashboard SPA with secret embedded
app.get('*', (req, res) => {
  const secret = process.env.DASHBOARD_SECRET || '';
  let html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  html = html.replace('__DASHBOARD_SECRET_PLACEHOLDER__', secret);
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ─── Error handler ───────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    error: 'Internal server error',
    detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 LogicalMind Ops running on http://localhost:${PORT}`);
  console.log(`   Phase 2 — AI agent + tasks + orders + Shiprocket active`);
  console.log(`   Phase 3 — WhatsApp broadcasts + order alerts active`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);

  // Start order poller for Channel Rings alerts
  if (process.env.WHATSAPP_GROUP_CHANNEL_RINGS) {
    require('./jobs/orderPoller').start();
  } else {
    console.warn('[⚠️  Warning] WHATSAPP_GROUP_CHANNEL_RINGS not set — order alerts disabled');
  }
});

module.exports = app;
