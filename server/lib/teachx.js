'use strict';
const { chromium } = require('playwright');
const supabase = require('./supabase');

let _browser = null;
let _context = null;

function cleanEnvSecret(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Ensures a Playwright context exists, loading cookies from Supabase if available.
 */
async function getContext() {
  if (_context) return _context;

  if (!_browser) {
    _browser = await chromium.launch({ headless: true });
  }

  // Try to load session from Supabase
  const { data } = await supabase
    .from('scraper_sessions')
    .select('cookies')
    .eq('key', 'teachx')
    .maybeSingle();

  if (data && data.cookies) {
    let state;
    try {
      state = typeof data.cookies === 'string' ? JSON.parse(data.cookies) : data.cookies;
    } catch (e) {
      console.error('[TeachX] Error parsing saved state', e);
    }
    
    // If it's an array, it's the old cookie format. If it's an object with cookies array, it's storageState.
    if (Array.isArray(state)) {
      _context = await _browser.newContext();
      await _context.addCookies(state);
    } else if (state && state.cookies) {
      _context = await _browser.newContext({ storageState: state });
    } else {
      _context = await _browser.newContext();
    }
    console.log('[TeachX] Loaded saved session from Supabase');
  } else {
    _context = await _browser.newContext();
  }

  return _context;
}

/**
 * Log in to TeachX manually.
 * Requires cookies to be pre-populated via a local script since there is a CAPTCHA.
 */
async function login() {
  const context = await getContext();
  const page = await context.newPage();
  
  const baseUrl = cleanEnvSecret(process.env.TEACHX_BASE_URL) || 'https://cmsone.teachx.in';

  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  
  if (page.url().includes('login')) {
    console.warn('[TeachX] Session expired or missing. Manual login required due to CAPTCHA.');
    await page.close();
    throw new Error('TeachX authentication required. Please run the local login script to solve CAPTCHA and save cookies.');
  } else {
    console.log('[TeachX] Session is active.');
  }

  await page.close();
  return true;
}

/**
 * Drives the 4-step wizard to send a notification.
 */
async function sendNotification({ title, body, target_type = 'all_users' }) {
  const context = await getContext();
  const page = await context.newPage();
  const baseUrl = cleanEnvSecret(process.env.TEACHX_BASE_URL) || 'https://cmsone.teachx.in';
  
  try {
    console.log('[TeachX] Navigating to notifications page...');
    await page.goto(`${baseUrl}/marketing/notifications`, { waitUntil: 'networkidle' });

    // Step 1: Open modal
    console.log('[TeachX] Opening new notification modal...');
    // Look for the round plus button
    await page.locator('button').filter({ hasText: '+' }).first().click();
    await page.waitForTimeout(1500);
    
    // Step 1: Audience Setup
    console.log('[TeachX] Step 1: Audience Setup');
    // Wait for Audience Setup tab to be active
    await page.waitForSelector('text=Audience Type');
    
    // Click Audience Type dropdown (usually the second "Select" dropdown)
    const dropdowns = await page.locator('.select__indicator').all();
    if (dropdowns.length >= 2) {
      await dropdowns[1].click(); // Click second dropdown (Audience Type)
    } else {
      // Fallback
      await page.locator('text=Select').nth(1).click();
    }
    
    await page.waitForTimeout(500);
    if (target_type === 'all_users') {
      await page.getByText('All Users', { exact: true }).click();
    } else {
      // Default to All Users if segment is unsupported for now
      await page.getByText('All Users', { exact: true }).click();
    }
    
    await page.getByRole('button', { name: 'Save and Go To Next' }).click();

    // Step 2: Notification Content
    console.log('[TeachX] Step 2: Notification Content');
    await page.waitForTimeout(1000);
    
    // Fill title
    const titleInputs = await page.locator('input[type="text"]').all();
    if (titleInputs.length > 0) {
      await titleInputs[0].fill(title.substring(0, 60));
    }
    
    // Fill body (rich text editor)
    const editor = page.locator('.ql-editor');
    if (await editor.count() > 0) {
      await editor.fill(body);
    } else {
      // Fallback if not quill
      await page.locator('textarea').first().fill(body);
    }
    
    await page.getByRole('button', { name: 'Save and Go To Next' }).click();

    // Step 3: Additional Settings
    console.log('[TeachX] Step 3: Additional Settings');
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Save and Go To Next' }).click();

    // Step 4: Publish
    console.log('[TeachX] Step 4: Publish Notification');
    await page.waitForTimeout(1000);
    
    // Click Publish button
    await page.getByRole('button', { name: 'Publish' }).first().click();
    
    // Wait a few seconds for the request to complete
    await page.waitForTimeout(4000);
    console.log('[TeachX] ✅ Notification published successfully');

    await page.close();
    return { success: true, message: 'Sent via APPX' };

  } catch (error) {
    console.error('[TeachX] Error sending notification:', error);
    await page.close();
    throw new Error(`Failed to send notification in APPX: ${error.message}`);
  }
}

async function close() {
  if (_browser) {
    await _browser.close();
    _browser = null;
    _context = null;
  }
}

module.exports = {
  login,
  sendNotification,
  close
};
