'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { chromium } = require('playwright');
const supabase = require('../server/lib/supabase');

async function run() {
  console.log('🚀 Launching TeachX Login Script...');
  console.log('You will have 2 minutes to log in (including solving the CAPTCHA).');
  
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--start-maximized']
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  const baseUrl = process.env.TEACHX_BASE_URL || 'https://cmsone.teachx.in';
  await page.goto(`${baseUrl}/login`);

  console.log('⏳ Please fill out the login form and solve the CAPTCHA now...');
  
  // Wait until the URL changes away from the login page, meaning successful login
  let loggedIn = false;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);
    if (!page.url().includes('login')) {
      loggedIn = true;
      break;
    }
  }
  
  if (!loggedIn) {
    console.error('❌ You did not log in within 2 minutes. Please run the script again.');
    await browser.close();
    process.exit(1);
  }

  console.log('✅ Logged in successfully! Extracting session state...');
  const state = await context.storageState();
  
  console.log('💾 Saving session to Supabase `scraper_sessions` table...');
  const { error } = await supabase
    .from('scraper_sessions')
    .upsert({
      key: 'teachx',
      cookies: JSON.stringify(state),
      saved_at: new Date().toISOString()
    }, { onConflict: 'key' });

  if (error) {
    console.error('❌ Failed to save cookies to Supabase:', error.message);
  } else {
    console.log('🎉 Success! TeachX session is now securely stored in Supabase.');
    console.log('The server can now dispatch notifications automatically.');
  }

  await browser.close();
  process.exit(0);
}

run().catch(console.error);
