/**
 * discover-groups.js
 *
 * One-time script to automatically discover all your WhatsApp groups
 * and save them to groups.json.
 *
 * Run once: node discover-groups.js
 * Then start the helper: node helper.js
 */

'use strict';
require('dotenv').config();
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const SESSION_DIR  = path.join(__dirname, 'wa-session');
const GROUPS_FILE  = path.join(__dirname, 'groups.json');

(async () => {
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  console.log('[Discovery] Opening WhatsApp Web to discover your groups…');
  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    args: ['--no-sandbox'],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = browser.pages()[0] || await browser.newPage();
  await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('[Discovery] Waiting for WhatsApp Web (scan QR if prompted)…');
  await page.waitForSelector('[data-testid="chat-list"], #pane-side', { timeout: 90000 });
  console.log('[Discovery] ✅ Logged in. Scrolling through chats to find all groups…\n');

  // Wait for initial load
  await new Promise(r => setTimeout(r, 3000));

  const groups = new Set();
  let prevCount = 0;
  let noChangeRounds = 0;

  while (noChangeRounds < 5) {
    // Extract visible group names (groups have multiple people)
    const names = await page.evaluate(() => {
      const items = document.querySelectorAll('[data-testid="cell-frame-title"]');
      return Array.from(items).map(el => el.textContent?.trim()).filter(Boolean);
    });

    // Heuristic: WhatsApp groups often have participant counts visible
    // We collect ALL chat names and let the user edit groups.json to remove 1-on-1 chats
    names.forEach(n => groups.add(n));

    // Scroll down to load more chats
    const chatList = page.locator('[data-testid="chat-list"]').first();
    await chatList.evaluate(el => el.scrollBy(0, 600));
    await new Promise(r => setTimeout(r, 1200));

    const newCount = groups.size;
    if (newCount === prevCount) {
      noChangeRounds++;
    } else {
      noChangeRounds = 0;
      prevCount = newCount;
      process.stdout.write(`\r[Discovery] Found ${newCount} chats…`);
    }
  }

  await browser.close();

  const groupList = Array.from(groups).sort();
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(groupList, null, 2));

  console.log(`\n\n[Discovery] ✅ Saved ${groupList.length} chats to groups.json`);
  console.log('[Discovery] ⚠️  Please open groups.json and REMOVE any personal/1-on-1 chats.');
  console.log('[Discovery] Only keep group names. Then run: node helper.js\n');
})();
