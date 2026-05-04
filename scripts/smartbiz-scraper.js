/**
 * SmartBiz Order Scraper — LogicalMind Ops Phase 2
 *
 * Scrapes Amazon SmartBiz orders and upserts them into Supabase.
 * Run via GitHub Actions every 10 minutes.
 *
 * EXIT CODES:
 *  0 — Success (even if 0 orders found, that's valid)
 *  1 — Fatal error (login failed, OTP challenge, unrecoverable error)
 *
 * IMPORTANT: If Amazon requires OTP/passkey, exit code 1 is used so
 * GitHub Actions shows a failure email and you know it needs attention.
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SMARTBIZ_EMAIL       = process.env.SMARTBIZ_EMAIL;
const SMARTBIZ_PASSWORD    = process.env.SMARTBIZ_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SMARTBIZ_EMAIL || !SMARTBIZ_PASSWORD) {
  console.error('[SmartBiz Scraper] ❌ Missing required environment variables.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Helper: human-like random delay ─────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = (min = 1000, max = 2500) =>
  sleep(Math.floor(Math.random() * (max - min) + min));

// ── Helper: safe fill ────────────────────────────────────────────
async function safeFill(page, selectorList, value, label) {
  for (const sel of selectorList) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 5000 }).catch(() => false)) {
        await el.fill(value);
        console.log(`[SmartBiz Scraper] Filled ${label} using selector: ${sel}`);
        return true;
      }
    } catch (_) {}
  }
  console.error(`[SmartBiz Scraper] ❌ Could not find ${label} field with any known selector.`);
  return false;
}

// ── Helper: safe click ───────────────────────────────────────────
async function safeClick(page, selectorList, label) {
  for (const sel of selectorList) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        await el.click();
        console.log(`[SmartBiz Scraper] Clicked ${label} using selector: ${sel}`);
        return true;
      }
    } catch (_) {}
  }
  return false; // Not an error — some fields are optional (e.g., Continue button might not exist)
}

(async () => {
  console.log('[SmartBiz Scraper] Starting…');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    // ── STEP 1: Login ───────────────────────────────────────────
    console.log('[SmartBiz Scraper] Navigating to SmartBiz login…');
    await page.goto('https://smartbiz.amazon.in/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await randomDelay();

    // Click Sign In if present on landing page
    await safeClick(
      page,
      ['text=Sign in', 'a:has-text("Sign in")', 'button:has-text("Sign in")'],
      'Sign In button'
    );
    await randomDelay();

    // Fill email field
    const emailFilled = await safeFill(
      page,
      ['input[type="email"]', 'input[name="email"]', '#ap_email', 'input[id*="email"]'],
      SMARTBIZ_EMAIL,
      'email'
    );
    if (!emailFilled) {
      await browser.close();
      console.error('[SmartBiz Scraper] ❌ Email field not found. Amazon may have changed login UI.');
      process.exit(1);
    }
    await randomDelay(500, 1000);

    // Continue / Next button (optional — some Amazon pages go directly to password)
    await safeClick(
      page,
      ['input[type="submit"]', '#continue', 'button[type="submit"]', 'input#continue'],
      'Continue button'
    );
    await randomDelay();

    // Fill password field
    const pwFilled = await safeFill(
      page,
      ['input[type="password"]', 'input[name="password"]', '#ap_password', 'input[id*="password"]'],
      SMARTBIZ_PASSWORD,
      'password'
    );
    if (!pwFilled) {
      await browser.close();
      console.error('[SmartBiz Scraper] ❌ Password field not found.');
      process.exit(1);
    }
    await randomDelay(500, 1000);

    // Submit login
    await safeClick(
      page,
      ['input[type="submit"]', '#signInSubmit', 'button[type="submit"]', 'input[id*="signIn"]'],
      'Sign In submit'
    );
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await randomDelay(2000, 3000);

    // ── CHECK: Login challenge (OTP / passkey / CAPTCHA) ─────────
    const currentUrl = page.url();
    console.log(`[SmartBiz Scraper] After login URL: ${currentUrl}`);

    if (
      currentUrl.includes('challenge') ||
      currentUrl.includes('ap/mfa') ||
      currentUrl.includes('cvf') ||
      currentUrl.includes('ap/signin') // Still on sign-in = login failed
    ) {
      await browser.close();
      // ⚠ EXIT CODE 1 — GitHub Actions will send failure email
      // This is INTENTIONAL: the team must know the scraper needs attention
      console.error('[SmartBiz Scraper] ❌ Login challenge detected (OTP/passkey/CAPTCHA) OR login failed.');
      console.error('[SmartBiz Scraper] ACTION REQUIRED: Log in manually to SmartBiz once, or disable 2FA for this account.');
      console.error('[SmartBiz Scraper] Current URL:', currentUrl);
      process.exit(1);
    }

    // ── STEP 2: Navigate to Orders ──────────────────────────────
    console.log('[SmartBiz Scraper] Navigating to orders…');
    await page.goto('https://smartbiz.amazon.in/orders/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await randomDelay(2000, 3500);

    // ── STEP 3: Extract orders ──────────────────────────────────
    // SmartBiz is a React SPA — we try multiple selectors and fallback strategies
    const orderSelectors = [
      '[data-testid="order-row"]',
      '.order-item',
      '[class*="orderRow"]',
      '[class*="order-card"]',
      '[class*="OrderCard"]',
      'tr[data-order-id]',
    ];

    let selectorMatched = false;
    for (const sel of orderSelectors) {
      const count = await page.locator(sel).count().catch(() => 0);
      if (count > 0) {
        selectorMatched = true;
        console.log(`[SmartBiz Scraper] Found orders with selector: ${sel}`);
        break;
      }
    }

    if (!selectorMatched) {
      console.warn('[SmartBiz Scraper] ⚠ No order rows found with known selectors.');
      console.warn('[SmartBiz Scraper] This could mean: 0 orders, or the page structure changed.');
      // Take a screenshot for debugging
      const screenshotPath = '/tmp/smartbiz-debug.png';
      await page.screenshot({ path: screenshotPath }).catch(() => {});
      console.log(`[SmartBiz Scraper] Debug screenshot saved to: ${screenshotPath}`);
    }

    const orders = await page.evaluate(() => {
      const results = [];

      // Strategy 1: data-testid attributes (most reliable)
      const rows = document.querySelectorAll(
        '[data-testid="order-row"], .order-item, [class*="OrderRow"], [class*="orderCard"], [class*="order-card"]'
      );

      rows.forEach((row) => {
        const textContent = row.innerText || '';

        // Extract order ID — Amazon format: 403-1234567-1234567
        const orderIdMatch = textContent.match(/\d{3}-\d{7}-\d{7}/);
        const orderId = orderIdMatch ? orderIdMatch[0] : null;

        // Extract product name — largest/most prominent text in the row
        const titleEl = row.querySelector('h2, h3, [class*="title"], [class*="product"], [class*="name"], [class*="Title"]');
        const productName = titleEl ? titleEl.innerText.trim() : '';

        // Status
        const statusEl = row.querySelector('[class*="status"], [class*="Status"], [data-testid*="status"]');
        const statusText = statusEl ? statusEl.innerText.trim().toLowerCase() : 'pending';

        // Amount
        const amountMatch = textContent.match(/₹\s?[\d,]+\.?\d*/);
        const amount = amountMatch ? parseFloat(amountMatch[0].replace(/[₹,\s]/g, '')) : null;

        // Customer name (often not shown in list view — leave blank)
        const customerEl = row.querySelector('[class*="customer"], [class*="buyer"], [class*="Buyer"]');
        const customerName = customerEl ? customerEl.innerText.trim() : '';

        if (orderId) {
          results.push({
            channel: 'smartbiz',
            external_id: orderId,
            customer_name: customerName || '',
            product_name: productName || 'Unknown',
            sku: '',
            quantity: 1,
            amount: amount,
            status:
              statusText.includes('ship') ? 'shipped'
              : statusText.includes('deliver') ? 'delivered'
              : statusText.includes('cancel') ? 'cancelled'
              : 'pending',
          });
        }
      });

      return results;
    });

    console.log(`[SmartBiz Scraper] Found ${orders.length} orders on page.`);

    // ── STEP 4: Upsert into Supabase ────────────────────────────
    let newCount = 0;
    let updatedCount = 0;
    for (const order of orders) {
      const { data: existing, error: fetchErr } = await supabase
        .from('orders')
        .select('id, status')
        .eq('external_id', order.external_id)
        .maybeSingle(); // ← maybeSingle() doesn't throw if not found

      if (fetchErr) {
        console.error(`[SmartBiz Scraper] Fetch failed for ${order.external_id}:`, fetchErr.message);
        continue;
      }

      if (!existing) {
        const { error: insertErr } = await supabase.from('orders').insert([{
          ...order,
          scraped_at: new Date().toISOString(),
        }]);
        if (insertErr) {
          console.error(`[SmartBiz Scraper] Insert failed for ${order.external_id}:`, insertErr.message);
        } else {
          newCount++;
          console.log(`[SmartBiz Scraper] ✅ Inserted: ${order.external_id} (${order.status})`);
        }
      } else if (existing.status !== order.status) {
        const { error: updateErr } = await supabase
          .from('orders')
          .update({ status: order.status, scraped_at: new Date().toISOString() })
          .eq('external_id', order.external_id);
        if (!updateErr) {
          updatedCount++;
          console.log(`[SmartBiz Scraper] 🔄 Updated: ${order.external_id} ${existing.status} → ${order.status}`);
        }
      }
    }

    console.log(`[SmartBiz Scraper] ✅ Done. ${newCount} new, ${updatedCount} updated.`);
    process.exit(0);
  } catch (err) {
    console.error('[SmartBiz Scraper] Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await browser.close().catch(() => {});
  }
})();
