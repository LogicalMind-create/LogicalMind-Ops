/**
 * Save session data manually to Supabase
 * Usage: node scripts/save-session-manual.js <session-json-file>
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function saveSession(sessionData) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log('Saving session to Supabase...');

  try {
    const { error } = await supabase
      .from('scraper_sessions')
      .upsert({
        key: 'smartbiz',
        cookies: JSON.stringify(sessionData),
        saved_at: new Date().toISOString()
      }, { onConflict: 'key' });

    if (error) throw error;

    console.log('✅ Session saved successfully!');
    console.log('You can now run: node scripts/smartbiz-scraper.js');
  } catch (err) {
    console.error('❌ Error saving session:', err.message);
    process.exit(1);
  }
}

// If run directly with session data as argument
if (require.main === module) {
  const sessionJson = process.argv[2];
  if (!sessionJson) {
    console.log('Usage: node scripts/save-session-manual.js <session-json-string>');
    console.log('');
    console.log('Example:');
    console.log('node scripts/save-session-manual.js \'{"cookies": [...], "localStorage": {...}}\'');
    process.exit(1);
  }

  try {
    const sessionData = JSON.parse(sessionJson);
    saveSession(sessionData);
  } catch (err) {
    console.error('❌ Invalid JSON:', err.message);
    process.exit(1);
  }
}

module.exports = { saveSession };