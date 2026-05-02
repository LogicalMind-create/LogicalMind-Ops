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
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Rate limit chat endpoint — Gemini free tier: 15 req/min
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  message: { error: 'Too many requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Auth middleware ─────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return next();
  if (process.env.NODE_ENV !== 'production') return next();
  const referer = req.headers['referer'] || req.headers['origin'] || '';
  const host    = req.headers['host'] || '';
  if (referer.includes(host)) return next();
  const provided = req.headers['x-dashboard-secret'];
  if (provided === secret) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/health',         require('./routes/health'));
app.use('/api/chat',       authMiddleware, chatLimiter, require('./routes/chat'));
app.use('/api/tasks',      authMiddleware, require('./routes/tasks'));
app.use('/api/orders',     authMiddleware, require('./routes/orders'));
app.use('/api/broadcasts', authMiddleware, require('./routes/broadcasts'));

// Webhooks (no auth — external services call these)
app.use('/webhooks/shiprocket', require('./webhooks/shiprocket'));

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

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 LogicalMind Ops running on http://localhost:${PORT}`);
  console.log(`   Phase 2 — Orders + Shiprocket active`);
  console.log(`   Phase 3 — WhatsApp broadcasts active`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});

module.exports = app;
