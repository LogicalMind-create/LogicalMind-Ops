'use strict';
require('dotenv').config();
const cronParser = require('cron-parser');
const supabase = require('../lib/supabase');
const teachx = require('../lib/teachx');

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
let poller = null;

async function poll() {
  console.log('[NotificationScheduler] Checking campaigns and dispatch queue...');
  const now = new Date();

  try {
    // 1. Process Campaigns
    const { data: campaigns, error: campaignErr } = await supabase
      .from('notification_campaigns')
      .select('*')
      .eq('is_active', true);

    if (campaignErr) throw campaignErr;

    for (const campaign of campaigns || []) {
      try {
        const interval = cronParser.parseExpression(campaign.cron_rule, { tz: 'Asia/Kolkata' });
        const prevDate = interval.prev().toDate();
        
        // If the cron rule should have triggered since the last run (or roughly within the last 5 minutes)
        const lastRun = campaign.last_run_at ? new Date(campaign.last_run_at) : new Date(now.getTime() - POLL_INTERVAL);
        
        if (prevDate >= lastRun && prevDate <= now) {
          console.log(`[NotificationScheduler] Campaign "${campaign.name}" is due. Drafting notification.`);
          
          // Create draft
          await supabase.from('app_notifications').insert([{
            title: campaign.template_title,
            body: campaign.template_body,
            target_type: campaign.target_type,
            target_filter: campaign.target_filter,
            status: 'pending_approval',
            category: campaign.category,
            created_by: 'agent'
          }]);
          
          // Update last_run_at
          await supabase.from('notification_campaigns').update({ last_run_at: now.toISOString() }).eq('id', campaign.id);
        }
      } catch (err) {
        console.error(`[NotificationScheduler] Error processing campaign ${campaign.id}:`, err.message);
      }
    }

    // 2. Process Dispatch Queue
    // We fetch any that are 'approved' and scheduled for now or in the past
    // OR 'approved' with no scheduled_for date (immediate)
    const { data: drafts, error: draftsErr } = await supabase
      .from('app_notifications')
      .select('*')
      .eq('status', 'approved')
      .lte('scheduled_for', now.toISOString());

    const { data: immediateDrafts, error: immediateErr } = await supabase
      .from('app_notifications')
      .select('*')
      .eq('status', 'approved')
      .is('scheduled_for', null);

    if (draftsErr) throw draftsErr;
    if (immediateErr) throw immediateErr;

    const toDispatch = [...(drafts || []), ...(immediateDrafts || [])];
    
    // Deduplicate in case any overlapped
    const uniqueDispatch = [];
    const seen = new Set();
    for (const d of toDispatch) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        uniqueDispatch.push(d);
      }
    }

    for (const draft of uniqueDispatch) {
      console.log(`[NotificationScheduler] Dispatching notification #${draft.id}`);
      
      // Mark as sending to prevent double-dispatch if process is slow
      await supabase.from('app_notifications').update({ status: 'sending' }).eq('id', draft.id);

      try {
        const result = await teachx.sendNotification({
          title: draft.title,
          body: draft.body,
          target_type: draft.target_type
        });
        
        await supabase.from('app_notifications').update({
          status: 'sent',
          sent_at: now.toISOString(),
          appx_response: result,
          error_reason: null
        }).eq('id', draft.id);

        const telegram = require('../lib/telegram');
        if (telegram.sendMessage) {
          await telegram.sendMessage(`✅ <b>APPX Push Sent</b>\n"${draft.title}"`);
        }

      } catch (err) {
        console.error(`[NotificationScheduler] Dispatch failed for #${draft.id}:`, err.message);
        await supabase.from('app_notifications').update({
          status: 'failed',
          error_reason: err.message
        }).eq('id', draft.id);
        
        const telegram = require('../lib/telegram');
        if (telegram.sendMessage) {
          await telegram.sendMessage(`❌ <b>APPX Push Failed</b>\n"${draft.title}"\nReason: ${err.message}`);
        }
      }
    }

  } catch (err) {
    console.error('[NotificationScheduler] Poll error:', err.message);
  }
}

async function start() {
  console.log('[NotificationScheduler] 🚀 Starting (every 5 min)');
  await poll(); // initial poll
  poller = setInterval(poll, POLL_INTERVAL);
}

function stop() {
  if (poller) {
    clearInterval(poller);
    poller = null;
    console.log('[NotificationScheduler] ⛔ Stopped');
  }
}

module.exports = { start, stop, poll };
