'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key  = process.env.SUPABASE_SERVICE_KEY;

if (!url || url.includes('your-project') || !key || key.includes('your-supabase')) {
  console.warn('[Supabase] ⚠ Not configured — DB calls will fail. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
}

// Create client even with placeholder values — individual calls will error gracefully
const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  key  || 'placeholder',
  { auth: { persistSession: false } }
);

module.exports = supabase;
