/**
 * discover-groups.js
 *
 * One-time script to automatically discover all your WhatsApp groups
 * and save them to groups.json.
 *
 * Run once: node discover-groups.js
 * Then start the helper: node helper.js
 *
 * Uses role-based selectors compatible with current WhatsApp Web (Lexical UI).
 */

'use strict';
require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join(__dirname, 'wa-session');
const GROUPS_FILE = path.join(__dirname, 'groups.json');

(async () => {
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  console.log('[Discovery] Opening WhatsApp Web to discover your groups…');
  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    args: ['--no-sandbox'],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = browser.pages()[0] || (await browser.newPage());
  await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('[Discovery] Waiting for WhatsApp Web (scan QR if prompted)…');
  await page.waitForSelector('#side, #pane-side, [data-testid="chat-list"]', { timeout: 90000 });
  console.log('[Discovery] ✅ Logged in. Scrolling through chats to find all groups…\n');

  await new Promise((r) => setTimeout(r, 3000));

  const groups = new Set();
  let prevCount = 0;
  let noChangeRounds = 0;

  while (noChangeRounds < 5) {
    const names = await page.evaluate(() => {
      const out = new Set();
      const pane = document.querySelector('#pane-side') || document.querySelector('#side');
      if (!pane) return [];

      const items = pane.querySelectorAll('[role="listitem"], [data-testid="cell-frame-container"]');
      items.forEach((item) => {
        let best = '';
        const titleSpan = item.querySelector('span[title]');
        if (titleSpan) {
          const t = titleSpan.getAttribute('title')?.trim();
          if (t) best = t;
        }
        if (!best) {
          const titles = item.querySelectorAll('span[title]');
          titles.forEach((sp) => {
            const t = sp.getAttribute('title')?.trim() || '';
            if (t.length > best.length) best = t;
          });
        }
        if (!best) {
          const cell = item.querySelector('[data-testid="cell-frame-title"]');
          if (cell?.textContent) best = cell.textContent.trim();
        }
        if (!best && item.textContent) {
          const line = item.textContent.split('\n').map((s) => s.trim()).filter(Boolean)[0];
          if (line) best = line;
        }
        if (best) out.add(best);
      });

      return Array.from(out);
    });

    names.forEach((n) => groups.add(n));

    const chatList = page.locator('[data-testid="chat-list"], #pane-side').first();
    if ((await chatList.count()) > 0) {
      await chatList.evaluate((el) => el.scrollBy(0, 600));
    } else {
      await page.mouse.wheel(0, 600);
    }
    await new Promise((r) => setTimeout(r, 1200));

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
