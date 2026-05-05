/**
 * WhatsApp Helper - LogicalMind Ops Phase 3
 *
 * Runs on your PC (not on Render).
 * Polls the server for approved broadcasts and sends them
 * to all your WhatsApp groups via WhatsApp Web.
 *
 * Supports: Text, Images (jpg/png), PDFs
 *
 * CLI: node helper.js [--once] [--dry-run]
 *   --once     Run a single poll tick then exit (unless a broadcast was processed)
 *   --dry-run  Resolve selectors and "would send" per group; no message send / Enter
 */

'use strict';
require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET || '';
const POLL_MS = Number(process.env.POLL_INTERVAL_MS) || 30_000;
const SESSION_DIR = path.join(__dirname, 'wa-session');
const GROUPS_FILE = path.join(__dirname, 'groups.json');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const DEBUG_DIR = path.join(__dirname, 'debug');
const WHATSAPP_GROUP_CHANNEL_RINGS_NAME = process.env.WHATSAPP_GROUP_CHANNEL_RINGS_NAME || '';

const ARGS = new Set(process.argv.slice(2));
const FLAG_ONCE = ARGS.has('--once');
const FLAG_DRY_RUN = ARGS.has('--dry-run');

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Persistent browser across broadcasts */
let browserContext = null;

function headers() {
  return {
    'Content-Type': 'application/json',
    ...(DASHBOARD_SECRET ? { 'X-Dashboard-Secret': DASHBOARD_SECRET } : {}),
  };
}

async function getPendingBroadcast() {
  const res = await fetch(`${SERVER_URL}/api/broadcasts?status=approved&limit=1`, { headers: headers() });
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] || null;
}

async function reportProgress(id, sent, total, status, errorReason) {
  const body = { groups_sent: sent, groups_total: total, status };
  if (errorReason !== undefined && errorReason !== null) body.error_reason = errorReason;
  await fetch(`${SERVER_URL}/api/broadcasts/${id}/progress`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  }).catch(() => {});
}

async function markBroadcastFailed(id, reason) {
  console.error(`[Helper] Marking broadcast ${id} as failed: ${reason}`);
  await reportProgress(id, 0, 0, 'failed', String(reason || 'Unknown error'));
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode && res.statusCode >= 400) {
        file.close();
        fs.unlink(dest, () => {});
        reject(new Error(`Download failed with status ${res.statusCode}`));
        return;
      }

      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function loadGroups() {
  if (!fs.existsSync(GROUPS_FILE)) {
    console.error(`[Helper] groups.json not found at ${GROUPS_FILE}`);
    console.error('[Helper] Run: node discover-groups.js to auto-discover your groups.');
    process.exit(1);
  }
  // Strip UTF-8 BOM if present (added by Windows editors like Notepad)
  const raw = fs.readFileSync(GROUPS_FILE, 'utf-8').replace(/^﻿/, '');
  return JSON.parse(raw);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function debugDump(page, label) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const ts = Date.now();
    const base = path.join(DEBUG_DIR, `${label}-${ts}`);
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => '');
    fs.writeFileSync(`${base}.html`, html, 'utf8');
    console.error(`[Helper] Debug dump: ${base}.png / ${base}.html`);
  } catch (e) {
    console.error('[Helper] debugDump failed:', e.message);
  }
}

async function humanClick(page, element) {
  const box = await element.boundingBox();
  if (box) {
    await page.mouse.move(
      box.x + box.width / 2 + rand(-8, 8),
      box.y + box.height / 2 + rand(-4, 4),
      { steps: rand(5, 15) }
    );
    await sleep(rand(100, 400));
  }
  await element.click();
}

/**
 * Lexical / WA Web: focus editor then use keyboard (not ElementHandle.type).
 */
async function humanTypeIntoLocator(page, locator, text) {
  const el = locator.first();
  await el.waitFor({ state: 'visible', timeout: 15000 });
  await el.click();
  await sleep(rand(200, 500));
  await page.mouse.move(rand(200, 800), rand(200, 500));
  await sleep(rand(100, 250));
  await page.keyboard.press('Control+A');
  await sleep(rand(50, 120));
  await page.keyboard.press('Backspace');
  await sleep(rand(100, 200));
  await page.keyboard.type(text, { delay: rand(40, 130) });
  await sleep(rand(800, 2500));
}

async function focusSearchWithShortcut(page) {
  // WhatsApp Web frequently changes search DOM structure; Ctrl+K is stable.
  await page.keyboard.press('Control+K').catch(() => {});
  await sleep(rand(200, 450));
  const focused = page.locator(':focus').first();
  if ((await focused.count()) > 0 && (await focused.isVisible().catch(() => false))) {
    return focused;
  }
  return null;
}

async function resolveSearchBox(page) {
  // WhatsApp Business on Web uses a plain <input>, not a contenteditable div.
  // Regular WhatsApp Web uses contenteditable. Try both, input selectors first.
  const candidates = [
    page.locator('input[data-tab="3"]'),
    page.locator('input[aria-label*="Search" i]'),
    page.locator('input[placeholder*="Search" i]'),
    page.locator('#side input[type="text"]'),
    // Legacy / regular WhatsApp Web (contenteditable div)
    page.locator('#side div[role="textbox"][contenteditable="true"]'),
    page.locator('div[contenteditable="true"][data-tab="3"]'),
    page.locator('div[contenteditable="true"][aria-label*="Search" i]'),
    page.locator('#side div[contenteditable="true"]'),
  ];
  for (const loc of candidates) {
    const first = loc.first();
    if ((await first.count()) > 0 && (await first.isVisible().catch(() => false))) return first;
  }

  const focusedFromShortcut = await focusSearchWithShortcut(page);
  if (focusedFromShortcut) return focusedFromShortcut;

  await debugDump(page, 'search-box-missing');
  throw new Error('Search box not found');
}

async function resolveComposeBox(page) {
  const candidates = [
    page.locator('footer div[role="textbox"][contenteditable="true"]'),
    page.locator('#main footer div[contenteditable="true"]'),
    page.locator('footer div[contenteditable="true"]'),
    page.locator('#main div[role="textbox"][contenteditable="true"]'),
    page.locator('div[contenteditable="true"][data-tab="10"]'),
    page.locator('div[contenteditable="true"][title*="Type a message" i]'),
    page.locator('div[contenteditable="true"][aria-label*="message" i]'),
    page.locator('#main div[contenteditable="true"][data-lexical-editor="true"]'),
  ];
  for (const loc of candidates) {
    const first = loc.first();
    if ((await first.count()) > 0 && (await first.isVisible().catch(() => false))) return first;
  }
  await debugDump(page, 'compose-box-missing');
  throw new Error('Compose box not found');
}

async function clearSearch(page) {
  try {
    const search = (await focusSearchWithShortcut(page)) || (await resolveSearchBox(page));
    await search.click();
    await sleep(rand(80, 180));
    await page.keyboard.press('Control+A');
    await sleep(rand(40, 100));
    await page.keyboard.press('Backspace');
    await sleep(rand(80, 200));
    // Escape exits WhatsApp Business's search mode (plain <input> stays in search
    // mode until dismissed, keeping the chat list in filtered state)
    await page.keyboard.press('Escape');
    await sleep(rand(150, 300));
  } catch (_) {
    /* ignore */
  }
}

function norm(s) {
  return String(s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesGroupName(titleAttr, rowText, groupName) {
  const n = norm(groupName);
  const t = norm(titleAttr);
  const r = norm((rowText || '').split('\n')[0] || '');
  if (!n) return false;
  if (t === n || r === n) return true;
  if (t.includes(n) || n.includes(t)) return true;
  if (r.includes(n) || n.includes(r)) return true;
  return false;
}

function findChannelRingsGroupName(groups) {
  const candidate = groups.find((group) => {
    const normalized = norm(group);
    return normalized.includes('channel') && normalized.includes('rings');
  });
  return candidate || '';
}

async function openGroup(page, groupName) {
  await clearSearch(page);
  const search = await resolveSearchBox(page);
  await humanTypeIntoLocator(page, search, groupName);

  // Wait for WhatsApp to filter the search results before scanning rows.
  // Strategy: wait until a cell-frame-title span appears whose text matches
  // our group name. Timeout 8s — if nothing appears, fall through to manual scan.
  const normName = norm(groupName);
  let target = null;

  try {
    // Fast path: wait for a visible title span containing the group name
    const titleSpan = page.locator('span[title]').filter({ hasText: new RegExp(normName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
    await titleSpan.waitFor({ state: 'visible', timeout: 8000 });
    target = titleSpan;
    console.log(`  [Helper] Fast-matched: "${groupName}"`);
  } catch (_) {
    // Slow path: manual scan across all visible rows
    await sleep(rand(500, 1000));
    const rowSelectors = '[data-testid="cell-frame-container"], #pane-side div[role="listitem"], #side div[role="listitem"]';
    const rows = page.locator(rowSelectors);
    const count = await rows.count();

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      if (!(await row.isVisible().catch(() => false))) continue;
      const titleEl = row.locator('span[title]').first();
      const titleAttr = (await titleEl.getAttribute('title').catch(() => '')) || '';
      const rowText = (await row.innerText().catch(() => '')) || '';
      if (matchesGroupName(titleAttr, rowText, groupName)) {
        target = titleEl && (await titleEl.count()) > 0 ? titleEl : row;
        break;
      }
    }
  }

  // Final fallback: exact title attribute match
  if (!target) {
    const exact = page.locator(`span[title="${groupName.replace(/"/g, '\\"')}"]`).first();
    if ((await exact.count()) > 0 && (await exact.isVisible().catch(() => false))) target = exact;
  }

  if (!target || (await target.count()) === 0) {
    console.warn(`  [Helper] Group not found: "${groupName}" - skipping`);
    await debugDump(page, `group-not-found-${norm(groupName).slice(0, 30).replace(/\W+/g, '_')}`);
    await clearSearch(page);
    return false;
  }

  await humanClick(page, target.first());
  await sleep(rand(600, 1500));
  await page.mouse.wheel(0, rand(-80, -200));
  await sleep(rand(200, 600));
  return true;
}

async function resolveAttachmentInput(page, mediaType) {
  const selectors =
    mediaType === 'image'
      ? ['input[accept*="image"]', 'input[accept*="video"]', 'input[type="file"]']
      : ['input[type="file"]', 'input[accept="*"]'];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) return locator;
  }
  return null;
}

async function sendTextToGroup(page, groupName, message) {
  const opened = await openGroup(page, groupName);
  if (!opened) return false;

  if (FLAG_DRY_RUN) {
    console.log(`  [Helper] [DRY-RUN] Would send text to: "${groupName}"`);
    await clearSearch(page);
    return true;
  }

  const compose = await resolveComposeBox(page);
  await humanTypeIntoLocator(page, compose, message);

  // Try clicking the send button first (more reliable in WhatsApp Business on Web).
  // Fall back to Enter if the button isn't visible.
  const sendBtn = page
    .locator(
      'span[data-icon="send"], span[data-icon="wds-ic-send-filled"], [data-testid="send"], button[aria-label="Send"], button[aria-label="send"], div[role="button"][aria-label="Send"]'
    )
    .first();
  if (await sendBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await humanClick(page, sendBtn);
  } else {
    await page.keyboard.press('Enter');
  }

  await sleep(rand(400, 800));
  await clearSearch(page);
  return true;
}

async function sendMediaToGroup(page, groupName, localFilePath, caption, mediaType) {
  const opened = await openGroup(page, groupName);
  if (!opened) return false;

  if (FLAG_DRY_RUN) {
    console.log(`  [Helper] [DRY-RUN] Would send media to: "${groupName}"`);
    await clearSearch(page);
    return true;
  }

  try {
    const attachBtn = page
      .locator(
        'button[title="Attach"], button[title="attach"], [data-testid="attach-btn"], span[data-icon="attach-menu-plus"], span[data-icon="plus-rounded"], span[data-icon="plus"]'
      )
      .first();
    if (!(await attachBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      console.warn(`  [Helper] Could not find attach button for "${groupName}" - falling back to text only`);
      return sendTextToGroup(page, groupName, `${caption}\n\n[Media attachment not sent - attach button not found]`);
    }

    await humanClick(page, attachBtn);
    await sleep(rand(600, 1200));

    const fileInput = await resolveAttachmentInput(page, mediaType);
    if (!fileInput) throw new Error('Attachment input not found');

    await fileInput.setInputFiles(localFilePath);
    await sleep(rand(2000, 3500));

    await page
      .waitForSelector(
        '[data-testid="media-editor"], .media-editor, [data-testid="send-media-dialog"], [role="dialog"]',
        { timeout: 15000 }
      )
      .catch(() => {});
    await sleep(rand(1000, 2000));

    if (caption) {
      const captionCandidates = [
        page.locator('div[role="textbox"][contenteditable="true"][aria-label*="caption" i]').first(),
        page.locator('[data-testid="caption-input"]').first(),
        page.locator('div[contenteditable="true"][aria-label*="caption" i]').first(),
      ];
      for (const captionBox of captionCandidates) {
        if ((await captionBox.count()) > 0 && (await captionBox.isVisible({ timeout: 2000 }).catch(() => false))) {
          await humanTypeIntoLocator(page, captionBox, caption);
          break;
        }
      }
    }

    const sendBtn = page
      .locator(
        'span[data-icon="wds-ic-send-filled"], [data-testid="send"], button[aria-label="Send"], button[aria-label="send"], div[role="button"][aria-label="Send"]'
      )
      .first();
    if (await sendBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await humanClick(page, sendBtn);
    } else {
      await page.keyboard.press('Enter');
    }

    await sleep(rand(1500, 3000));
    await clearSearch(page);
    return true;
  } catch (err) {
    console.error(`  [Helper] Media send failed for "${groupName}":`, err.message);
    console.log(`  [Helper] Falling back to text-only for "${groupName}"`);
    await clearSearch(page);
    return sendTextToGroup(page, groupName, `${caption}\n\n[Note: Media could not be attached]`);
  }
}

async function sendToGroup(page, groupName, broadcast) {
  if (broadcast.media_url && broadcast.media_type) {
    const ext = broadcast.media_type === 'pdf' ? 'pdf' : 'jpg';
    const localPath = path.join(DOWNLOADS_DIR, `media_${broadcast.id}.${ext}`);

    if (!fs.existsSync(localPath)) {
      try {
        console.log(`  [Helper] Downloading media: ${broadcast.media_url}`);
        await downloadFile(broadcast.media_url, localPath);
        console.log(`  [Helper] Media saved to: ${localPath}`);
      } catch (err) {
        console.error('  [Helper] Failed to download media:', err.message);
        return sendTextToGroup(page, groupName, broadcast.message);
      }
    }

    return sendMediaToGroup(page, groupName, localPath, broadcast.message, broadcast.media_type);
  }

  return sendTextToGroup(page, groupName, broadcast.message);
}

async function ensureBrowserContext() {
  if (browserContext) return browserContext;
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  browserContext = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const closeCtx = async () => {
    if (browserContext) {
      await browserContext.close().catch(() => {});
      browserContext = null;
    }
  };
  process.once('SIGINT', async () => {
    await closeCtx();
    process.exit(0);
  });
  process.once('SIGTERM', async () => {
    await closeCtx();
    process.exit(0);
  });

  return browserContext;
}

async function getWhatsAppPage() {
  const ctx = await ensureBrowserContext();
  let page = ctx.pages()[0];
  if (!page || page.isClosed()) page = await ctx.newPage();

  const url = page.url() || '';
  if (!url.includes('web.whatsapp.com')) {
    await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  console.log('[Helper] Waiting for WhatsApp Web to load (scan QR if prompted)...');
  await page.waitForSelector('#side, #pane-side, [data-testid="chat-list"]', { timeout: 90000 });
  console.log('[Helper] WhatsApp Web loaded\n');
  await sleep(rand(1500, 3000));
  return page;
}

/**
 * --dry-run without server: walk groups.json and verify search/list resolution only.
 */
async function dryRunLocalOnly() {
  console.log('[Helper] --dry-run (local): verifying selectors against groups.json\n');
  const groups = loadGroups();
  const page = await getWhatsAppPage();
  for (let i = 0; i < Math.min(groups.length, 3); i++) {
    const g = groups[i];
    console.log(`[Helper] [DRY-RUN] Resolving row for (${i + 1}/3 sample): ${g}`);
    const ok = await openGroup(page, g);
    console.log(`  -> openGroup: ${ok ? 'OK' : 'SKIP'}`);
    await clearSearch(page);
    await sleep(500);
  }
  console.log('\n[Helper] Dry-run sample done. (Only first 3 groups tested to limit UI churn.)');
}

async function runBroadcast(broadcast) {
  const allGroups = loadGroups();
  let groups = shuffle([...allGroups]);

  if (broadcast.group_filter && broadcast.group_filter !== 'all') {
    const filter = broadcast.group_filter.toLowerCase();

    if (filter === 'channel_rings') {
      if (WHATSAPP_GROUP_CHANNEL_RINGS_NAME) {
        groups = [WHATSAPP_GROUP_CHANNEL_RINGS_NAME];
        console.log('[Helper] Special filter "channel_rings" -> sending only to Channel Rings team group');
      } else {
        const inferred = findChannelRingsGroupName(groups);
        if (inferred) {
          groups = [inferred];
          console.log('[Helper] Special filter "channel_rings" -> inferred Channel Rings group from groups.json:', inferred);
        } else {
          console.error('[Helper] WHATSAPP_GROUP_CHANNEL_RINGS_NAME not set in .env and no channel rings group found in groups.json');
          console.error('[Helper] Run discover-groups.js and set WHATSAPP_GROUP_CHANNEL_RINGS_NAME in your .env');
          await markBroadcastFailed(broadcast.id, 'Channel Rings group name missing');
          return;
        }
      }
    } else {
      groups = groups.filter((group) => group.toLowerCase().includes(filter));
      console.log(`[Helper] Filter "${broadcast.group_filter}" matched ${groups.length} groups`);
    }
  }

  const total = groups.length;
  if (total === 0) {
    await markBroadcastFailed(broadcast.id, `No groups matched filter "${broadcast.group_filter}"`);
    return;
  }

  console.log(`\n[Helper] Starting broadcast to ${total} groups${FLAG_DRY_RUN ? ' [DRY-RUN]' : ''}`);
  console.log(`[Helper] Message: "${String(broadcast.message).slice(0, 60)}..."`);
  if (broadcast.media_url) {
    console.log(`[Helper] Media: ${broadcast.media_type} -> ${broadcast.media_url}`);
  }
  console.log('');

  await reportProgress(broadcast.id, 0, total, 'sending');
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

  try {
    const page = await getWhatsAppPage();

    let sent = 0;
    let breakThreshold = rand(8, 12);

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      console.log(`[Helper] [${i + 1}/${total}] Sending to: ${group}`);

      const ok = await sendToGroup(page, group, broadcast);
      if (ok) {
        sent++;
        await reportProgress(broadcast.id, sent, total, 'sending');
        console.log(`[Helper]   Sent (${sent}/${total})`);
      }

      if ((i + 1) % breakThreshold === 0 && i < groups.length - 1) {
        const breakSec = rand(60, 120);
        console.log(`\n[Helper] Taking a human break for ${breakSec}s after ${i + 1} groups...\n`);
        await sleep(breakSec * 1000);
        breakThreshold = rand(8, 12);
      } else if (i < groups.length - 1) {
        const delaySec = rand(5, 15);
        console.log(`[Helper]   Waiting ${delaySec}s before next group...`);
        await sleep(delaySec * 1000);
      }
    }

    const finalStatus = sent === total ? 'sent' : sent > 0 ? 'sent' : 'failed';
    await reportProgress(
      broadcast.id,
      sent,
      total,
      finalStatus,
      finalStatus === 'failed' ? 'No messages were delivered to any group' : undefined
    );
    console.log(`\n[Helper] Broadcast complete: ${sent}/${total} groups reached\n`);

    if (broadcast.media_url && !FLAG_DRY_RUN) {
      const ext = broadcast.media_type === 'pdf' ? 'pdf' : 'jpg';
      const localPath = path.join(DOWNLOADS_DIR, `media_${broadcast.id}.${ext}`);
      fs.unlink(localPath, () => {});
    }
  } catch (err) {
    console.error('[Helper] Fatal error during broadcast execution:', err.message);
    try {
      const ctx = browserContext || (await ensureBrowserContext());
      const pages = ctx.pages();
      const pg = pages[0];
      if (pg) await debugDump(pg, 'fatal-broadcast');
    } catch (_) {
      /* ignore */
    }
    await markBroadcastFailed(broadcast.id, err.message);
  }
}

async function poll() {
  console.log(`[Helper] Polling ${SERVER_URL}/api/broadcasts every ${POLL_MS / 1000}s...`);
  if (FLAG_ONCE) console.log('[Helper] --once: will exit after one idle poll (or after processing one broadcast)');
  if (FLAG_DRY_RUN) console.log('[Helper] --dry-run: will not press Send / no real messages');

  let busy = false;
  let processed = false;

  const tick = async () => {
    if (busy) return;

    try {
      const broadcast = await getPendingBroadcast();
      if (!broadcast) {
        if (FLAG_ONCE && !processed) {
          console.log('[Helper] --once: no approved broadcast; exiting.');
          process.exit(0);
        }
        return;
      }

      busy = true;
      processed = true;
      console.log(`[Helper] Found approved broadcast: ${broadcast.id}`);
      await runBroadcast(broadcast);
      if (FLAG_ONCE) {
        console.log('[Helper] --once: done; exiting.');
        process.exit(0);
      }
    } catch (err) {
      console.error('[Helper] Error:', err.message);
    } finally {
      busy = false;
    }
  };

  await tick();
  if (!FLAG_ONCE) setInterval(tick, POLL_MS);
}

async function main() {
  if (FLAG_DRY_RUN) {
    const broadcast = await getPendingBroadcast();
    if (broadcast) {
      console.log('[Helper] --dry-run: approved broadcast found; simulating send flow (no Enter / no media upload).');
      await runBroadcast(broadcast);
    } else {
      if (FLAG_ONCE) {
        console.log('[Helper] --once --dry-run: no approved broadcast on server; running local selector sample (3 groups).');
      } else {
        console.log('[Helper] --dry-run: no approved broadcast on server; running local selector sample (3 groups).');
      }
      await dryRunLocalOnly();
    }
    process.exit(0);
    return;
  }

  await poll();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
