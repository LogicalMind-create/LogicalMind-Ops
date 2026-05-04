/**
 * Create scraper_sessions table in Supabase via SQL
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

async function createTable() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Try direct insert to test if table exists
  console.log('Checking if scraper_sessions table exists...');
  
  try {
    const { error } = await supabase
      .from('scraper_sessions')
      .select('*')
      .limit(0);

    if (error && error.code === 'PGRST116') {
      // Table doesn't exist
      console.log('❌ Table does not exist yet.');
      console.log('');
      console.log('⚠️  You need to create it manually in Supabase dashboard:');
      console.log('');
      console.log('1. Go to SQL Editor: https://supabase.com/dashboard/project/oksjqtnlajfhfzmxtjnd/sql/new');
      console.log('2. Paste and run this SQL:');
      console.log('');
      console.log('```sql');
      console.log('create table if not exists scraper_sessions (');
      console.log('  key        text primary key,');
      console.log('  cookies    text not null,');
      console.log('  saved_at   timestamptz not null default now()');
      console.log(');');
      console.log('```');
      console.log('');
      console.log('3. Then run this command again to save your session:');
      console.log('   node scripts/smartbiz-scraper.js');
      process.exit(1);
    } else if (error) {
      throw error;
    }

    console.log('✅ Table scraper_sessions already exists!');
    process.exit(0);
  } catch (err) {
    console.error('Error checking table:', err.message);
    process.exit(1);
  }
}

createTable();
