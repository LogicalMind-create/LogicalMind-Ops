'use strict';
require('dotenv').config({path: require('path').resolve(__dirname, '../.env')});
const { chromium } = require('playwright');
const supabase = require('../server/lib/supabase');
const fs = require('fs');

async function run() {
  const {data} = await supabase.from('scraper_sessions').select('cookies').eq('key', 'teachx').single();
  const b = await chromium.launch();
  const c = await b.newContext();
  await c.addCookies(JSON.parse(data.cookies));
  const p = await c.newPage();
  await p.goto('https://cmsone.teachx.in/marketing/notifications', {waitUntil:'networkidle'});
  const html = await p.content();
  fs.writeFileSync('C:/Users/kumar/.gemini/antigravity/scratch/notif.html', html);
  await b.close();
  console.log('Saved to notif.html');
}
run().catch(console.error);
