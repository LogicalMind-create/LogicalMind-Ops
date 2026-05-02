'use strict';
const express = require('express');
const router = express.Router();

/**
 * GET /health
 * Used by UptimeRobot to keep Render service alive
 */
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'LogicalMind Ops',
    timestamp: new Date().toISOString(),
    phase: 1,
  });
});

module.exports = router;
