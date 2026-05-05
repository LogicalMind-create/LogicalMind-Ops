/**
 * Create scraper_sessions table in Supabase
 * Run: node scripts/create-session-table.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function createTable() {
  try {
    // Try to create the table using a raw SQL query via the REST API
    const { error } = await supabase.rpc('exec', {
      command: `create table if not exists scraper_sessions (
  key        text primary key,
  cookies    text not null,
  saved_at   timestamptz not null default now()
);`
    }).catch(() => {
      // If RPC doesn't exist, try inserting into the table to test if it exists
      return supabase
        .from('scraper_sessions')
        .select('count(*)', { count: 'exact', head: true });
    });

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    console.log('✓ scraper_sessions table is ready!');
    process.exit(0);
  } catch (err) {
    console.error('⚠ Could not automatically create table:', err.message);
    console.error('');
    console.error('Please create it manually in Supabase Dashboard (SQL Editor):');
    console.error('');
    console.error(`create table if not exists scraper_sessions (
  key        text primary key,
  cookies    text not null,
  saved_at   timestamptz not null default now()
);`);
    process.exit(1);
  }
}

createTable();
