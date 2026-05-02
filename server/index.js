'use strict';
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

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
  // Skip auth entirely in local development
  if (process.env.NODE_ENV === 'development') return next();

  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return next();

  const provided = req.headers['x-dashboard-secret'];
  if (provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/health', require('./routes/health'));
app.use('/api/chat', authMiddleware, chatLimiter, require('./routes/chat'));
app.use('/api/tasks', authMiddleware, require('./routes/tasks'));
app.use('/api/orders', authMiddleware, require('./routes/orders'));

// Webhooks (no auth middleware because external services call this)
app.use('/webhooks/shiprocket', require('./webhooks/shiprocket'));

// Catch-all: serve dashboard SPA
app.get('/{*path}', (req, res) => {
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
  console.log(`   Phase 1 — AI agent + task board active`);
  console.log(`   Phase 2 — Orders (SmartBiz → Shiprocket) active`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});

module.exports = app;
