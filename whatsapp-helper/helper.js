/**
 * WhatsApp Helper — LogicalMind Ops Phase 3
 *
 * Runs on YOUR PC (not on Render).
 * Polls the server for approved broadcasts and sends them
 * to all your WhatsApp groups via WhatsApp Web.
 *
 * SUPPORTS: Text, Images (jpg/png), PDFs
 *
 * ANTI-BAN MEASURES:
 *  - Human-speed typing (random 40–120ms per character)
 *  - Random delay 5–15 sec between each group
 *  - Long break (60–120 sec) every 8–12 groups
 *  - Random group order each session
 *  - Mouse micro-jitter before clicking
 *  - Scroll behavior before typing
 *  - WhatsApp Web session saved (QR scan only needed once)
 */

'use strict';
require('dotenv').config();
const { chromium } = require('playwright');
const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const http   = require('http');
const fetch  = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

// ── Config ────────────────────────────────────────────────────────────────────
const SERVER_URL              = process.env.SERVER_URL || 'http://localhost:3000';
const DASHBOARD_SECRET        = process.env.DASHBOARD_SECRET || '';
const POLL_MS                 = Number(process.env.POLL_INTERVAL_MS) || 30_000;
const SESSION_DIR             = path.join(__dirname, 'wa-session');
const GROUPS_FILE             = path.join(__dirname, 'groups.json');
const DOWNLOADS_DIR           = path.join(__dirname, 'downloads');
const WHATSAPP_GROUP_CHANNEL_RINGS_NAME = process.env.WHATSAPP_GROUP_CHANNEL_RINGS_NAME || '';

// ── Human-behaviour helpers ───────────────────────────────────────────────────
const rand  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms)       => new Promise(r => setTimeout(r, ms));

/** Type text character by character at human speed */
async function humanType(page, selector, text) {
  const el = await page.waitForSelector(selector, { timeout: 15000 });
  await el.click();
  await sleep(rand(300, 700));
  // Occasionally move mouse before typing
  await page.mouse.move(rand(200, 800), rand(200, 500));
  await sleep(rand(100, 300));
  for (const char of text) {
    await el.type(char, { delay: rand(40, 130) });
    // Rare extra pause — like a human thinking mid-message
    if (Math.random() < 0.04) await sleep(rand(400, 1200));
  }
  await sleep(rand(800, 2500)); // pause before sending
}

/** Jitter mouse over an element before clicking */
async function humanClick(page, element) {
  const box = await element.boundingBox();
  if (box) {
    // Move to element with slight random offset
    await page.mouse.move(
      box.x + box.width / 2 + rand(-8, 8),
      box.y + box.height / 2 + rand(-4, 4),
      { steps: rand(5, 15) }
    );
    await sleep(rand(100, 400));
  }
  await element.click();
}

/** Shuffle array in-place (Fisher-Yates) */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── API helpers ───────────────────────────────────────────────────────────────
const headers = () => ({
  'Content-Type': 'application/json',
  ...(DASHBOARD_SECRET ? { 'X-Dashboard-Secret': DASHBOARD_SECRET } : {}),
});

async function getPendingBroadcast() {
  const res = await fetch(`${SERVER_URL}/api/broadcasts?status=approved&limit=1`, { headers: headers() });
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] || null;
}

async function reportProgress(id, sent, total, status) {
  await fetch(`${SERVER_URL}/api/broadcasts/${id}/progress`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ groups_sent: sent, groups_total: total, status }),
  }).catch(() => {});
}

// ── Media downloader ──────────────────────────────────────────────────────────
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Handle redirect
        file.close();
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
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

// ── Load group list ───────────────────────────────────────────────────────────
function loadGroups() {
  if (!fs.existsSync(GROUPS_FILE)) {
    console.error(`[Helper] groups.json not found at ${GROUPS_FILE}`);
    console.error('[Helper] Run: node discover-groups.js  to auto-discover your groups.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf-8'));
}

// ── Core: open a group ───────────────────────────────────────────────────────
async function openGroup(page, groupName) {
  // Search for the group
  const searchBox = 'div[contenteditable="true"][data-tab="3"], input[type="text"][title="Search input textbox"]';
  await humanType(page, searchBox, groupName);
  await sleep(rand(1000, 2000));

  // Click the first result
  const results = page.locator(`//span[@title="${groupName}"]`).first();
  const fallback = page.locator('[data-testid="cell-frame-title"]').filter({ hasText: groupName }).first();

  const target = await results.isVisible({ timeout: 4000 }).catch(() => false)
    ? results : fallback;

  if (!await target.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.warn(`  [Helper] Group not found: "${groupName}" — skipping`);
    // Clear search
    await page.keyboard.press('Escape');
    await sleep(rand(500, 1000));
    return false;
  }

  await humanClick(page, target);
  await sleep(rand(600, 1500));

  // Scroll slightly in chat (human behaviour)
  await page.mouse.wheel(0, rand(-80, -200));
  await sleep(rand(200, 600));

  return true;
}

// ── Core: send text message ───────────────────────────────────────────────────
async function sendTextToGroup(page, groupName, message) {
  const opened = await openGroup(page, groupName);
  if (!opened) return false;

  // Type message in chat box
  const chatBox = 'div[contenteditable="true"][data-tab="10"], div[contenteditable="true"][title="Type a message"]';
  await humanType(page, chatBox, message);

  // Hit Enter to send
  await page.keyboard.press('Enter');
  await sleep(rand(400, 800));

  // Clear search for next group
  await page.keyboard.press('Escape');
  await sleep(rand(300, 600));

  return true;
}

// ── Core: send media (image or PDF) with caption ─────────────────────────────
async function sendMediaToGroup(page, groupName, localFilePath, caption, mediaType) {
  const opened = await openGroup(page, groupName);
  if (!opened) return false;

  try {
    // Click the attachment (paperclip) button
    const attachBtn = page.locator('[data-testid="attach-btn"], span[data-icon="attach-menu-plus"], [title="Attach"]').first();
    if (!await attachBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.warn(`  [Helper] Could not find attach button for "${groupName}" — falling back to text only`);
      return await sendTextToGroup(page, groupName, `${caption}\n\n[Media attachment not sent — attach button not found]`);
    }

    await humanClick(page, attachBtn);
    await sleep(rand(600, 1200));

    // Choose the right file input
    // For images: "Photos & Videos", for PDFs: "Document"
    let fileInputSelector;
    if (mediaType === 'image') {
      // Click "Photos & Videos" option
      const photosOption = page.locator('[data-testid="mi-attach-image"], input[accept="image/*,video/mp4"]').first();
      if (await photosOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        fileInputSelector = photosOption;
      }
    }

    if (!fileInputSelector) {
      // Fallback: document upload (works for both images and PDFs)
      fileInputSelector = page.locator('[data-testid="mi-attach-document"], input[accept="*"]').first();
    }

    // Set the file
    await fileInputSelector.setInputFiles(localFilePath);
    await sleep(rand(2000, 3500));

    // Wait for media preview to appear
    await page.waitForSelector('[data-testid="media-editor"], .media-editor, [data-testid="send-media-dialog"]', {
      timeout: 15000
    }).catch(() => {});
    await sleep(rand(1000, 2000));

    // Add caption if there's a caption input
    if (caption) {
      const captionBox = page.locator('[data-testid="caption-input"], div[contenteditable="true"][data-tab="10"]').first();
      if (await captionBox.isVisible({ timeout: 3000 }).catch(() => false)) {
        await captionBox.click();
        await sleep(rand(300, 600));
        await captionBox.type(caption, { delay: rand(30, 80) });
        await sleep(rand(500, 1000));
      }
    }

    // Click Send button for media
    const sendBtn = page.locator('[data-testid="send"], button[aria-label="Send"]').first();
    if (await sendBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await humanClick(page, sendBtn);
    } else {
      await page.keyboard.press('Enter');
    }
    await sleep(rand(1500, 3000));

    // Clear search for next group
    await page.keyboard.press('Escape');
    await sleep(rand(300, 600));

    return true;
  } catch (err) {
    console.error(`  [Helper] Media send failed for "${groupName}":`, err.message);
    // Fallback: send text only
    console.log(`  [Helper] Falling back to text-only for "${groupName}"`);
    await page.keyboard.press('Escape');
    await sleep(rand(500, 1000));
    return await sendTextToGroup(page, groupName, `${caption}\n\n[Note: Media could not be attached]`);
  }
}

// ── Core: send to one group (text or media) ───────────────────────────────────
async function sendToGroup(page, groupName, broadcast) {
  if (broadcast.media_url && broadcast.media_type) {
    // Download media file first
    const ext = broadcast.media_type === 'pdf' ? 'pdf' : 'jpg';
    const localPath = path.join(DOWNLOADS_DIR, `media_${broadcast.id}.${ext}`);

    if (!fs.existsSync(localPath)) {
      try {
        console.log(`  [Helper] Downloading media: ${broadcast.media_url}`);
        await downloadFile(broadcast.media_url, localPath);
        console.log(`  [Helper] Media saved to: ${localPath}`);
      } catch (err) {
        console.error(`  [Helper] Failed to download media:`, err.message);
        // Fallback: send text only
        return await sendTextToGroup(page, groupName, broadcast.message);
      }
    }

    return await sendMediaToGroup(page, groupName, localPath, broadcast.message, broadcast.media_type);
  } else {
    return await sendTextToGroup(page, groupName, broadcast.message);
  }
}

// ── Core: broadcast to all groups ────────────────────────────────────────────
async function runBroadcast(broadcast) {
  const allGroups = loadGroups();
  let groups = shuffle([...allGroups]); // fresh shuffle every broadcast

  // Apply group_filter
  if (broadcast.group_filter && broadcast.group_filter !== 'all') {
    const filter = broadcast.group_filter.toLowerCase();

    // Special case: channel_rings (alerts to team group only)
    if (filter === 'channel_rings') {
      if (!WHATSAPP_GROUP_CHANNEL_RINGS_NAME) {
        console.error('[Helper] ❌ WHATSAPP_GROUP_CHANNEL_RINGS_NAME not set in .env — cannot send to Channel Rings');
        console.error('[Helper] Run discover-groups.js, find "Channel Rings", and add to .env');
        return;
      }
      groups = [WHATSAPP_GROUP_CHANNEL_RINGS_NAME];
      console.log(`[Helper] Special filter "channel_rings" → sending only to Channel Rings team group`);
    } else {
      // Regular filter (dsc, tet, general, etc.)
      groups = groups.filter(g => g.toLowerCase().includes(filter));
      console.log(`[Helper] Filter "${broadcast.group_filter}" matched ${groups.length} groups`);
    }
  }

  const total = groups.length;
  console.log(`\n[Helper] 📢 Starting broadcast to ${total} groups`);
  console.log(`[Helper] Message: "${broadcast.message.slice(0, 60)}…"`);
  if (broadcast.media_url) {
    console.log(`[Helper] Media: ${broadcast.media_type} → ${broadcast.media_url}`);
  }
  console.log('');

  await reportProgress(broadcast.id, 0, total, 'sending');

  // Ensure downloads dir exists
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

  // Launch browser with saved session
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false, // Must be visible for WhatsApp Web
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = browser.pages()[0] || await browser.newPage();

  // Open WhatsApp Web
  await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('[Helper] Waiting for WhatsApp Web to load (scan QR if prompted)…');

  // Wait for chats to appear (up to 90 sec — gives time to scan QR)
  await page.waitForSelector('[data-testid="chat-list"], #pane-side', { timeout: 90000 });
  console.log('[Helper] ✅ WhatsApp Web loaded\n');
  await sleep(rand(2000, 4000));

  let sent = 0;
  let breakThreshold = rand(8, 12); // take a break after this many groups

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    console.log(`[Helper] [${i + 1}/${total}] Sending to: ${group}`);

    const ok = await sendToGroup(page, group, broadcast);
    if (ok) {
      sent++;
      await reportProgress(broadcast.id, sent, total, 'sending');
      console.log(`[Helper]   ✓ Sent (${sent}/${total})`);
    }

    // Human break after every N groups
    if ((i + 1) % breakThreshold === 0 && i < groups.length - 1) {
      const breakSec = rand(60, 120);
      console.log(`\n[Helper] ☕ Taking a human break for ${breakSec}s after ${i + 1} groups…\n`);
      await sleep(breakSec * 1000);
      breakThreshold = rand(8, 12); // reset for next batch
    } else {
      // Normal delay between groups — 5–15 seconds
      const delaySec = rand(5, 15);
      console.log(`[Helper]   ⏱ Waiting ${delaySec}s before next group…`);
      await sleep(delaySec * 1000);
    }
  }

  await browser.close();

  // Cleanup downloaded media
  if (broadcast.media_url) {
    const ext = broadcast.media_type === 'pdf' ? 'pdf' : 'jpg';
    const localPath = path.join(DOWNLOADS_DIR, `media_${broadcast.id}.${ext}`);
    fs.unlink(localPath, () => {});
  }

  const finalStatus = sent === total ? 'sent' : sent > 0 ? 'sent' : 'failed';
  await reportProgress(broadcast.id, sent, total, finalStatus);
  console.log(`\n[Helper] 🎉 Broadcast complete: ${sent}/${total} groups reached\n`);
}

// ── Poll loop ─────────────────────────────────────────────────────────────────
async function poll() {
  console.log(`[Helper] 🔄 Polling ${SERVER_URL}/api/broadcasts every ${POLL_MS / 1000}s…`);

  let busy = false;
  setInterval(async () => {
    if (busy) return;
    try {
      const broadcast = await getPendingBroadcast();
      if (!broadcast) return;

      busy = true;
      console.log(`[Helper] 📬 Found approved broadcast: ${broadcast.id}`);
      await runBroadcast(broadcast);
    } catch (err) {
      console.error('[Helper] Error:', err.message);
    } finally {
      busy = false;
    }
  }, POLL_MS);
}

poll();
