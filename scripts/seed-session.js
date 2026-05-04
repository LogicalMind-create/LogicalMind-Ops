/**
 * Manually save a session entry to Supabase
 * This creates a placeholder that tells the scraper "session exists, don't re-login"
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

async function seedSession() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Placeholder session object - in real usage this would come from Playwright
  // This is just to bootstrap the first run while 2FA is an issue
  const placeholderSession = {
    cookies: [],
    origins: []
  };

  console.log('Saving session marker to Supabase...');
  
  try {
    const { data, error } = await supabase
      .from('scraper_sessions')
      .upsert({
        key: 'smartbiz',
        cookies: JSON.stringify(placeholderSession),
        saved_at: new Date().toISOString()
      }, { onConflict: 'key' });

    if (error) throw error;

    console.log('✅ Session marker saved to Supabase!');
    console.log('');
    console.log('Next time you run the scraper, it will attempt to use this session.');
    console.log('If 2FA is still required, you''ll need to:');
    console.log('');
    console.log('OPTION A: Disable 2FA on your Amazon Seller account');
    console.log('  → Go to https://www.amazon.in/account-security/');
    console.log('  → Look for "Two-Step Verification"');
    console.log('  → Disable or set up App Passwords');
    console.log('');
    console.log('OPTION B: Use an App Password instead');
    console.log('  → If 2FA is required, set up an app-specific password in Amazon');
    console.log('  → Update SMARTBIZ_PASSWORD in .env with the app password');
    console.log('');
    console.log('OPTION C: Accept 2FA for automated runs');
    console.log('  → CI/CD will detect 2FA and exit gracefully');
    console.log('  → You manually log in once when needed');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error saving session:', err.message);
    process.exit(1);
  }
}

seedSession();
