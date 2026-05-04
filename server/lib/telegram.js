'use strict';
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

let bot = null;
const chatId = process.env.TELEGRAM_CHAT_ID;

function getBot() {
  if (!bot && process.env.TELEGRAM_BOT_TOKEN) {
    bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
  }
  return bot;
}

/**
 * Send a plain-text or HTML message to the team Telegram group.
 * @param {string} text  — supports HTML formatting
 */
async function notify(text) {
  const b = getBot();
  if (!b || !chatId) {
    console.warn('[Telegram] Bot not configured — skipping notification');
    return;
  }
  try {
    await b.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('[Telegram] Failed to send message:', err.message);
  }
}

/**
 * Alias for notify() — used by create_shipment and shiprocket webhook.
 * @param {string} text
 */
const sendMessage = notify;

/**
 * Format an alert with emoji prefix.
 */
function alert(emoji, title, body) {
  return notify(`${emoji} <b>${title}</b>\n${body}`);
}

module.exports = { notify, sendMessage, alert };
