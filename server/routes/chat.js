'use strict';
const express = require('express');
const router = express.Router();
const { runAgent } = require('../agent/gemini');
const { v4: uuidv4 } = require('uuid');

// In-memory session store (resets on server restart — fine for 2-person team)
// Key: sessionId, Value: { history: [], runId: string }
const sessions = new Map();

/**
 * POST /api/chat
 * Body: { message: string, session_id?: string }
 * Returns: { reply: string, session_id: string, tools_used: string[] }
 */
router.post('/', async (req, res) => {
  const { message, session_id } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message is required' });
  }

  const sessionId = session_id || uuidv4();
  const session = sessions.get(sessionId) || { history: [], runId: uuidv4() };

  try {
    const { reply, history, toolsUsed } = await runAgent(
      message.trim(),
      session.history,
      session.runId
    );

    session.history = history;
    sessions.set(sessionId, session);

    return res.json({
      reply,
      session_id: sessionId,
      tools_used: toolsUsed,
    });
  } catch (err) {
    console.error('[Chat route] Error:', err.message, err.stack?.split('\n')[1]);

    if (err.message?.includes('API_KEY')) {
      return res.status(503).json({ error: 'AI service not configured. Check GROQ_API_KEY.' });
    }

    return res.status(500).json({
      error: 'Agent encountered an error. Please try again.',
      detail: err.message, // always expose so Render logs + UI show the real cause
    });
  }
});

/**
 * DELETE /api/chat/:session_id
 * Clear conversation history for a session
 */
router.delete('/:session_id', (req, res) => {
  sessions.delete(req.params.session_id);
  res.json({ success: true });
});

module.exports = router;
