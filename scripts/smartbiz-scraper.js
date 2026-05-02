const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SMARTBIZ_EMAIL = process.env.SMARTBIZ_EMAIL;
const SMARTBIZ_PASSWORD = process.env.SMARTBIZ_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SMARTBIZ_EMAIL || !SMARTBIZ_PASSWORD) {
  console.error('Missing required environment variables for scraper.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Helper: human-like random delay ─────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = (min = 1000, max = 2500) =>
  sleep(Math.floor(Math.random() * (max - min) + min));

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
    const signInBtn = page.locator('text=Sign in').first();
    if (await signInBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await signInBtn.click();
      await randomDelay();
    }

    // Email field
    const emailField = page.locator('input[type="email"], input[name="email"], #ap_email');
    await emailField.waitFor({ timeout: 15000 });
    await emailField.fill(SMARTBIZ_EMAIL);
    await randomDelay(500, 1000);

    // Continue / Next button
    const continueBtn = page.locator('input[type="submit"], #continue, button[type="submit"]').first();
    if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await continueBtn.click();
      await randomDelay();
    }

    // Password field
    const pwField = page.locator('input[type="password"], input[name="password"], #ap_password');
    await pwField.waitFor({ timeout: 15000 });
    await pwField.fill(SMARTBIZ_PASSWORD);
    await randomDelay(500, 1000);

    // Submit login
    const loginBtn = page.locator('input[type="submit"], #signInSubmit, button[type="submit"]').first();
    await loginBtn.click();
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await randomDelay(2000, 3000);

    // Check if passkey/OTP challenge appeared — skip if possible
    const currentUrl = page.url();
    console.log(`[SmartBiz Scraper] After login URL: ${currentUrl}`);
    if (currentUrl.includes('challenge') || currentUrl.includes('ap/mfa') || currentUrl.includes('cvf')) {
      console.warn('[SmartBiz Scraper] ⚠ Login challenge detected (passkey/OTP). Cannot proceed automatically. Exiting.');
      await browser.close();
      process.exit(0); // Exit cleanly — don't fail the workflow
    }

    // ── STEP 2: Navigate to Orders ──────────────────────────────
    console.log('[SmartBiz Scraper] Navigating to orders…');
    await page.goto('https://smartbiz.amazon.in/orders/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await randomDelay(2000, 3500);

    // ── STEP 3: Extract orders ──────────────────────────────────
    // SmartBiz is a React SPA — we wait for order rows to render
    await page.waitForSelector('[data-testid="order-row"], .order-item, [class*="orderRow"], [class*="order-card"]', {
      timeout: 15000,
    }).catch(() => {
      console.warn('[SmartBiz Scraper] Order rows selector did not match — page structure may have changed.');
    });

    const orders = await page.evaluate(() => {
      const results = [];

      // Strategy 1: data-testid attributes (most reliable)
      const rows = document.querySelectorAll('[data-testid="order-row"], .order-item, [class*="OrderRow"], [class*="orderCard"]');

      rows.forEach((row) => {
        const textContent = row.innerText || '';
        // Extract order ID — typically a numeric string like "403-1234567-1234567"
        const orderIdMatch = textContent.match(/\d{3}-\d{7}-\d{7}/);
        const orderId = orderIdMatch ? orderIdMatch[0] : null;

        // Extract product name — largest/most prominent text in the row
        const titleEl = row.querySelector('h2, h3, [class*="title"], [class*="product"], [class*="name"]');
        const productName = titleEl ? titleEl.innerText.trim() : '';

        // Status
        const statusEl = row.querySelector('[class*="status"], [class*="Status"]');
        const status = statusEl ? statusEl.innerText.trim().toLowerCase() : 'pending';

        // Amount
        const amountMatch = textContent.match(/₹\s?[\d,]+\.?\d*/);
        const amount = amountMatch ? parseFloat(amountMatch[0].replace(/[₹,\s]/g, '')) : null;

        if (orderId) {
          results.push({
            channel: 'smartbiz',
            external_id: orderId,
            customer_name: '', // SmartBiz may not show customer name in list
            product_name: productName || 'Unknown',
            sku: '',
            quantity: 1,
            amount: amount,
            status: status.includes('ship') ? 'shipped'
                  : status.includes('deliver') ? 'delivered'
                  : status.includes('cancel') ? 'cancelled'
                  : 'pending',
          });
        }
      });

      return results;
    });

    console.log(`[SmartBiz Scraper] Found ${orders.length} orders on page.`);

    // ── STEP 4: Upsert into Supabase ────────────────────────────
    let newCount = 0;
    for (const order of orders) {
      const { data: existing } = await supabase
        .from('orders')
        .select('id, status')
        .eq('external_id', order.external_id)
        .single();

      if (!existing) {
        const { error } = await supabase.from('orders').insert([order]);
        if (error) {
          console.error(`[SmartBiz Scraper] Insert failed for ${order.external_id}:`, error.message);
        } else {
          newCount++;
          console.log(`[SmartBiz Scraper] Inserted new order: ${order.external_id}`);
        }
      } else {
        // Update status if it has changed
        if (existing.status !== order.status) {
          await supabase
            .from('orders')
            .update({ status: order.status })
            .eq('external_id', order.external_id);
          console.log(`[SmartBiz Scraper] Status updated for ${order.external_id}: ${existing.status} → ${order.status}`);
        }
      }
    }

    console.log(`[SmartBiz Scraper] ✅ Done. ${newCount} new orders inserted.`);
  } catch (err) {
    console.error('[SmartBiz Scraper] Fatal error:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
