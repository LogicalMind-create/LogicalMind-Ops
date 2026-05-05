/**
 * Interactive session saver - paste JSON and it saves automatically
 */
const { createClient } = require('@supabase/supabase-js');
const readline = require('readline');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('📋 Paste your session JSON from browser console below:');
console.log('(It should start with {"cookies":[...])');
console.log('');

rl.question('Session JSON: ', async (jsonString) => {
  try {
    const sessionData = JSON.parse(jsonString.trim());

    console.log('💾 Saving session to Supabase...');

    const { error } = await supabase
      .from('scraper_sessions')
      .upsert({
        key: 'smartbiz',
        cookies: JSON.stringify(sessionData),
        saved_at: new Date().toISOString()
      }, { onConflict: 'key' });

    if (error) throw error;

    console.log('✅ Session saved successfully!');
    console.log('');
    console.log('🚀 Now test the scraper:');
    console.log('node scripts/smartbiz-scraper.js');

  } catch (err) {
    console.error('❌ Error:', err.message);
    console.log('');
    console.log('💡 Make sure you copied the complete JSON string');
    console.log('💡 It should start with {"cookies": and end with }');
  }

  rl.close();
});