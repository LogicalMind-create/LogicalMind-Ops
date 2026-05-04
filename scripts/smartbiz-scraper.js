/**
 * SmartBiz Order Scraper — LogicalMind Ops Phase 2
 *
 * Scrapes Amazon SmartBiz orders and upserts them into Supabase.
 * Run via GitHub Actions every 10 minutes.
 *
 * FEATURES:
 *  - Extracts order list from SmartBiz orders page
 *  - Navigates INTO each order's detail page to extract customer address
 *  - Upserts orders with full customer data (name, phone, email, address)
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
const os = require('os');
const path = require('path');
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

const SCREENSHOT_PATH = path.join(os.tmpdir(), 'smartbiz-debug.png');
const SESSION_KEY = 'smartbiz';

// ── Helper: human-like random delay ─────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = (min = 1000, max = 2500) =>
  sleep(Math.floor(Math.random() * (max - min) + min));

// ── Helper: screenshot at failure point ─────────────────────────
async function takeFailureScreenshot(page) {
  try {
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    console.log(`[SmartBiz Scraper] Screenshot saved: ${SCREENSHOT_PATH}`);
  } catch (_) {}
}

// ── Session persistence ──────────────────────────────────────────
async function loadSession() {
  try {
    const { data } = await supabase
      .from('scraper_sessions')
      .select('cookies, saved_at')
      .eq('key', SESSION_KEY)
      .maybeSingle();
    if (!data) return null;
    const ageMs = Date.now() - new Date(data.saved_at).getTime();
    if (ageMs > 12 * 60 * 60 * 1000) {
      console.log('[SmartBiz Scraper] Saved session is >12h old, will re-login.');
      return null;
    }
    console.log('[SmartBiz Scraper] Found saved session, will try to restore.');
    return JSON.parse(data.cookies);
  } catch (e) {
    console.warn('[SmartBiz Scraper] ⚠ Could not load saved session:', e.message);
    return null;
  }
}

async function saveSession(context) {
  try {
    const state = await context.storageState();
    await supabase.from('scraper_sessions').upsert(
      { key: SESSION_KEY, cookies: JSON.stringify(state), saved_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    console.log('[SmartBiz Scraper] ✓ Session saved to Supabase.');
  } catch (e) {
    console.warn('[SmartBiz Scraper] ⚠ Failed to save session:', e.message);
  }
}

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

// ── Fresh login flow ─────────────────────────────────────────────
async function doFreshLogin(page, context) {
  console.log('[SmartBiz Scraper] Navigating to SmartBiz login…');
  await page.goto('https://smartbiz.amazon.in/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await randomDelay();

  // Try to find and click Sign in button
  const signInClicked = await safeClick(
    page,
    ['text=Sign in', 'a:has-text("Sign in")', 'button:has-text("Sign in")', '[data-testid="signin-button"]'],
    'Sign In button'
  );

  if (!signInClicked) {
    console.log('[SmartBiz Scraper] ℹ No Sign In button found, may already be on login page.');
  }

  await randomDelay();

  // Enhanced email field detection
  const emailFilled = await safeFill(
    page,
    [
      'input[type="email"]',
      'input[name="email"]',
      '#ap_email',
      'input[id*="email"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="Email" i]',
      'input[placeholder*="mobile" i]',
      'input:not([type="password"])[type="text"]'
    ],
    SMARTBIZ_EMAIL,
    'email'
  );
  if (!emailFilled) {
    await takeFailureScreenshot(page);
    console.error('[SmartBiz Scraper] ❌ Email field not found.');
    console.error('[SmartBiz Scraper] The Amazon login page structure may have changed.');
    console.error('[SmartBiz Scraper] Screenshot saved for inspection: C:\\Users\\kumar\\AppData\\Local\\Temp\\smartbiz-debug.png');
    process.exit(1);
  }
  await randomDelay(500, 1000);

  await safeClick(
    page,
    ['input[type="submit"]', '#continue', 'button[type="submit"]', 'input#continue'],
    'Continue button'
  );
  await randomDelay();

  const pwFilled = await safeFill(
    page,
    ['input[type="password"]', 'input[name="password"]', '#ap_password', 'input[id*="password"]'],
    SMARTBIZ_PASSWORD,
    'password'
  );
  if (!pwFilled) {
    await takeFailureScreenshot(page);
    console.error('[SmartBiz Scraper] ❌ Password field not found.');
    process.exit(1);
  }
  await randomDelay(500, 1000);

  await safeClick(
    page,
    ['input[type="submit"]', '#signInSubmit', 'button[type="submit"]', 'input[id*="signIn"]'],
    'Sign In submit'
  );
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await randomDelay(2000, 3000);

  const currentUrl = page.url();
  console.log(`[SmartBiz Scraper] After login URL: ${currentUrl}`);

  if (
    currentUrl.includes('challenge') ||
    currentUrl.includes('ap/mfa') ||
    currentUrl.includes('cvf') ||
    currentUrl.includes('ap/signin')
  ) {
    await takeFailureScreenshot(page);
    console.error('[SmartBiz Scraper] ❌ Amazon 2FA / OTP / CAPTCHA required.');
    console.error('[SmartBiz Scraper] URL:', currentUrl);
    console.error('');
    console.error('[SmartBiz Scraper] 2FA blocks automated login. Choose one:');
    console.error('');
    console.error('  OPTION 1 (Recommended): Disable 2FA');
    console.error('    → Go to: https://www.amazon.in/account-security/');
    console.error('    → Find "Two-Step Verification" settings');
    console.error('    → Turn off 2FA (or set up app-specific password)');
    console.error('');
    console.error('  OPTION 2: Use App Password');
    console.error('    → Enable 2FA if not already enabled');
    console.error('    → Create app-specific password in Amazon settings');
    console.error('    → Update SMARTBIZ_PASSWORD in .env file');
    console.error('');
    console.error('  OPTION 3: Manual Login + Session Seeding');
    console.error('    → Manually log into https://smartbiz.amazon.in/');
    console.error('    → Complete 2FA on browser');
    console.error('    → Session will be cached for ~12 hours');
    console.error('    → GitHub Actions will use this cached session');
    console.error('');
    console.error('[SmartBiz Scraper] Once resolved, re-run: node scripts/smartbiz-scraper.js');
    process.exit(1);
  }

  // Save the fresh session so the next run skips login
  await saveSession(context);
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
  return false;
}

// ── Helper: extract text from first matching selector ────────────
async function extractText(page, selectorList, fallback = '') {
  for (const sel of selectorList) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        const text = await el.innerText();
        if (text && text.trim()) return text.trim();
      }
    } catch (_) {}
  }
  return fallback;
}

// ── Helper: extract customer address from order detail page ──────
async function extractCustomerAddress(page) {
  const address = {
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    pincode: '',
  };

  try {
    // Wait for the detail page to load
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await randomDelay(1500, 2500);

    // Full page text for regex extraction
    const pageText = await page.evaluate(() => document.body.innerText || '').catch(() => '');

    // ── Extract buyer/customer name ──────────────────────────────
    address.customer_name = await extractText(page, [
      '[data-testid="buyer-name"]',
      '[class*="buyerName"]',
      '[class*="BuyerName"]',
      '[class*="customer-name"]',
      '[class*="CustomerName"]',
      'div:has-text("Buyer") + div',
      'span:has-text("Buyer") + span',
    ]);

    // Fallback: find "Buyer:" or "Customer:" label in page text
    if (!address.customer_name) {
      const buyerMatch = pageText.match(/(?:Buyer|Customer)\s*(?:Name)?[\s:]+([^\n]+)/i);
      if (buyerMatch) address.customer_name = buyerMatch[1].trim();
    }

    // ── Extract phone number ────────────────────────────────────
    address.customer_phone = await extractText(page, [
      '[data-testid="buyer-phone"]',
      '[class*="phone"]',
      '[class*="Phone"]',
      '[class*="mobile"]',
    ]);

    // Fallback: regex for Indian phone numbers
    if (!address.customer_phone) {
      const phoneMatch = pageText.match(/(?:Phone|Mobile|Contact)[\s:]+(\+?91[\s-]?\d{10}|\d{10})/i);
      if (phoneMatch) address.customer_phone = phoneMatch[1].replace(/[\s-]/g, '');
    }

    // ── Extract email ───────────────────────────────────────────
    address.customer_email = await extractText(page, [
      '[data-testid="buyer-email"]',
      '[class*="email"]',
      '[class*="Email"]',
    ]);

    if (!address.customer_email) {
      const emailMatch = pageText.match(/(?:Email)[\s:]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
      if (emailMatch) address.customer_email = emailMatch[1];
    }

    // ── Extract shipping address block ──────────────────────────
    // Try structured selectors first
    const addressBlock = await extractText(page, [
      '[data-testid="shipping-address"]',
      '[class*="shippingAddress"]',
      '[class*="ShippingAddress"]',
      '[class*="shipping-address"]',
      '[class*="delivery-address"]',
      '[class*="DeliveryAddress"]',
      '[data-testid="address-block"]',
    ]);

    if (addressBlock) {
      // Parse the address block — typically multi-line
      const lines = addressBlock.split('\n').map(l => l.trim()).filter(Boolean);

      // First line is usually the name (already have it), skip if matches
      let startIdx = 0;
      if (lines[0] && address.customer_name && lines[0].includes(address.customer_name)) {
        startIdx = 1;
      }

      // Look for pincode pattern (6 digits) to identify city/state/pincode line
      const pincodeLineIdx = lines.findIndex(l => /\b\d{6}\b/.test(l));

      if (pincodeLineIdx >= 0) {
        // Everything before pincode line is address
        const addressLines = lines.slice(startIdx, pincodeLineIdx);
        address.address_line1 = addressLines[0] || '';
        address.address_line2 = addressLines.slice(1).join(', ');

        // Parse city, state, pincode from the pincode line
        const pLine = lines[pincodeLineIdx];
        const pinMatch = pLine.match(/\b(\d{6})\b/);
        if (pinMatch) address.pincode = pinMatch[1];

        // Try to split "City, State PIN" or "City, State - PIN"
        const cityStateMatch = pLine.match(/^([^,]+),\s*([^,\d-]+)/);
        if (cityStateMatch) {
          address.city = cityStateMatch[1].trim();
          address.state = cityStateMatch[2].trim();
        } else {
          // Just use what's before the pincode
          const beforePin = pLine.replace(/\b\d{6}\b/, '').replace(/[-,]/g, ' ').trim();
          const parts = beforePin.split(/\s{2,}/).filter(Boolean);
          if (parts.length >= 2) {
            address.city = parts[0];
            address.state = parts[1];
          } else if (parts.length === 1) {
            address.city = parts[0];
          }
        }
      } else {
        // No pincode line found — just use the raw lines
        address.address_line1 = lines[startIdx] || '';
        address.address_line2 = lines.slice(startIdx + 1).join(', ');
      }
    }

    // ── Fallback: regex extraction from full page text ───────────
    if (!address.pincode) {
      const pinMatch = pageText.match(/(?:Pin\s*code|PIN|Zip)[\s:]+(\d{6})/i);
      if (pinMatch) address.pincode = pinMatch[1];
    }

    if (!address.city) {
      const cityMatch = pageText.match(/(?:City|Town)[\s:]+([^\n,]+)/i);
      if (cityMatch) address.city = cityMatch[1].trim();
    }

    if (!address.state) {
      const stateMatch = pageText.match(/(?:State|Province)[\s:]+([^\n,]+)/i);
      if (stateMatch) address.state = stateMatch[1].trim();
    }

    if (!address.address_line1) {
      const addrMatch = pageText.match(/(?:Address|Street|Ship to)[\s:]+([^\n]+)/i);
      if (addrMatch) address.address_line1 = addrMatch[1].trim();
    }

  } catch (err) {
    console.warn(`[SmartBiz Scraper] ⚠ Error extracting customer address: ${err.message}`);
  }

  return address;
}

(async () => {
  console.log('[SmartBiz Scraper] Starting…');

  // Try to restore a previously saved session to avoid re-logging in every run
  const savedSession = await loadSession();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ...(savedSession ? { storageState: savedSession } : {}),
  });
  const page = await context.newPage();

  try {
    // ── STEP 1: Login (or restore session) ──────────────────────
    if (savedSession) {
      console.log('[SmartBiz Scraper] Trying saved session — navigating to orders page directly…');
      await page.goto('https://smartbiz.amazon.in/orders/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await randomDelay(1500, 2500);
      const sessionUrl = page.url();
      console.log(`[SmartBiz Scraper] Session check URL: ${sessionUrl}`);

      if (sessionUrl.includes('ap/signin') || sessionUrl.includes('signin')) {
        console.log('[SmartBiz Scraper] Saved session expired — falling back to fresh login.');
        // Fall through to fresh login below
        await doFreshLogin(page, context);
      } else {
        console.log('[SmartBiz Scraper] ✓ Session valid — skipping login.');
      }
    } else {
      await doFreshLogin(page, context);
    }

    // ── STEP 2: Navigate to Orders ──────────────────────────────
    console.log('[SmartBiz Scraper] Navigating to orders…');
    await page.goto('https://smartbiz.amazon.in/orders/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await randomDelay(2000, 3500);

    // ── STEP 3: Extract basic order info from listing page ───────
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
      await takeFailureScreenshot(page);
    }

    // Extract basic order info + clickable links from listing page
    const orders = await page.evaluate(() => {
      const results = [];
      const normaliseStatus = (statusText = '') => {
        const status = statusText.toLowerCase();
        if (status.includes('ready') && status.includes('ship')) return 'ready_to_ship';
        if (status.includes('deliver')) return 'delivered';
        if (status.includes('cancel')) return 'cancelled';
        if (status.includes('transit') || status.includes('shipped')) return 'shipped';
        return 'pending';
      };

      const rows = document.querySelectorAll(
        '[data-testid="order-row"], .order-item, [class*="OrderRow"], [class*="orderCard"], [class*="order-card"]'
      );

      rows.forEach((row) => {
        const textContent = row.innerText || '';

        // Extract order ID — Amazon format: 403-1234567-1234567
        const orderIdMatch = textContent.match(/\d{3}-\d{7}-\d{7}/);
        const orderId = orderIdMatch ? orderIdMatch[0] : null;

        // Extract product name
        const titleEl = row.querySelector('h2, h3, [class*="title"], [class*="product"], [class*="name"], [class*="Title"]');
        const productName = titleEl ? titleEl.innerText.trim() : '';

        // Status
        const statusEl = row.querySelector('[class*="status"], [class*="Status"], [data-testid*="status"]');
        const statusText = statusEl ? statusEl.innerText.trim().toLowerCase() : 'pending';

        // Date
        const dateMatch = textContent.match(
          /\b(?:\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/i
        );
        const orderDate = dateMatch ? new Date(dateMatch[0]) : null;

        // Amount
        const amountMatch = textContent.match(/₹\s?[\d,]+\.?\d*/);
        const amount = amountMatch ? parseFloat(amountMatch[0].replace(/[₹,\s]/g, '')) : null;

        // Customer name
        const customerEl = row.querySelector('[class*="customer"], [class*="buyer"], [class*="Buyer"]');
        const customerName = customerEl ? customerEl.innerText.trim() : '';

        // Detail link (for navigating into the order)
        const link = row.querySelector('a[href*="order"]');
        const detailUrl = link ? link.href : null;

        if (orderId) {
          results.push({
            channel: 'smartbiz',
            external_id: orderId,
            customer_name: customerName || '',
            product_name: productName || 'Unknown',
            sku: '',
            quantity: 1,
            amount: amount,
            status: normaliseStatus(statusText),
            order_date: orderDate && !Number.isNaN(orderDate.getTime()) ? orderDate.toISOString() : null,
            detail_url: detailUrl,
          });
        }
      });

      return results;
    });

    console.log(`[SmartBiz Scraper] Found ${orders.length} orders on listing page.`);

    // ── STEP 4: Navigate into each order detail to get customer address ──
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];

      // Only fetch details for orders that don't already have address in DB
      const { data: existing } = await supabase
        .from('orders')
        .select('id, address_line1, customer_phone')
        .eq('external_id', order.external_id)
        .maybeSingle();

      // Skip address extraction if we already have it
      if (existing && existing.address_line1 && existing.customer_phone) {
        console.log(`[SmartBiz Scraper] Skipping detail for ${order.external_id} — address already in DB`);
        continue;
      }

      // Navigate to detail page
      const detailUrl = order.detail_url || `https://smartbiz.amazon.in/orders/${order.external_id}`;
      console.log(`[SmartBiz Scraper] [${i + 1}/${orders.length}] Fetching details for: ${order.external_id}`);

      try {
        await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const addressData = await extractCustomerAddress(page);

        // Merge address data into the order object
        Object.assign(order, addressData);

        // Use the detail page customer name if we didn't get one from the listing
        if (!order.customer_name && addressData.customer_name) {
          order.customer_name = addressData.customer_name;
        }

        const fieldsFound = Object.entries(addressData).filter(([_, v]) => v).map(([k]) => k);
        console.log(`[SmartBiz Scraper]   Found: ${fieldsFound.join(', ') || '(none)'}`);
      } catch (err) {
        console.warn(`[SmartBiz Scraper]   ⚠ Could not load detail page: ${err.message}`);
      }

      // Human-like delay between detail page visits
      await randomDelay(1500, 3000);
    }

    // ── STEP 5: Upsert into Supabase ────────────────────────────
    let newCount = 0;
    let updatedCount = 0;

    for (const order of orders) {
      // Remove detail_url — not a DB column
      delete order.detail_url;

      const { data: existing, error: fetchErr } = await supabase
        .from('orders')
        .select('id, status, order_date, address_line1')
        .eq('external_id', order.external_id)
        .maybeSingle();

      if (fetchErr) {
        console.error(`[SmartBiz Scraper] Fetch failed for ${order.external_id}:`, fetchErr.message);
        continue;
      }

      if (!existing) {
        // New order — insert with all data
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
      } else {
        // Existing order — update status + address if newly scraped
        const needsUpdate =
          existing.status !== order.status ||
          (!existing.order_date && order.order_date) ||
          (!existing.address_line1 && order.address_line1);

        if (needsUpdate) {
          const updatePayload = {
            status: order.status,
            scraped_at: new Date().toISOString(),
          };

          // Only update address fields if we have new data and DB doesn't
          if (!existing.address_line1 && order.address_line1) {
            updatePayload.address_line1 = order.address_line1;
            updatePayload.address_line2 = order.address_line2 || '';
            updatePayload.city = order.city || '';
            updatePayload.state = order.state || '';
            updatePayload.pincode = order.pincode || '';
            updatePayload.customer_phone = order.customer_phone || '';
            updatePayload.customer_email = order.customer_email || '';
            if (order.customer_name) updatePayload.customer_name = order.customer_name;
          }

          if (!existing.order_date && order.order_date) {
            updatePayload.order_date = order.order_date;
          }

          const { error: updateErr } = await supabase
            .from('orders')
            .update(updatePayload)
            .eq('external_id', order.external_id);
          if (!updateErr) {
            updatedCount++;
            console.log(`[SmartBiz Scraper] 🔄 Updated: ${order.external_id} ${existing.status} → ${order.status}`);
          }
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
