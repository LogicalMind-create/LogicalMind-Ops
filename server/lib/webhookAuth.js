'use strict';
require('dotenv').config();

/**
 * Middleware to secure webhook endpoints.
 * It checks if the `secret` query parameter matches any of the allowed environment variable keys.
 * If the allowed keys are not found, it falls back to checking against `DASHBOARD_SECRET`.
 * 
 * @param {string[]} allowedEnvKeys Array of environment variable names to check against.
 */
function requireWebhookSecret(allowedEnvKeys = []) {
  return (req, res, next) => {
    const providedSecret = req.query.secret;

    if (!providedSecret) {
      console.warn('[Webhook Auth] Rejected request missing secret query parameter.');
      return res.status(401).send('Unauthorized: Missing secret');
    }

    // Try to match against specific allowed keys
    for (const key of allowedEnvKeys) {
      if (process.env[key] && providedSecret === process.env[key]) {
        return next();
      }
    }

    // Fallback to DASHBOARD_SECRET
    if (process.env.DASHBOARD_SECRET && providedSecret === process.env.DASHBOARD_SECRET) {
      return next();
    }

    console.warn('[Webhook Auth] Rejected request with invalid secret.');
    return res.status(401).send('Unauthorized: Invalid secret');
  };
}

module.exports = { requireWebhookSecret };
