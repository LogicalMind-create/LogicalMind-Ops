'use strict';
require('dotenv').config();
const supabase = require('../lib/supabase');
const { listOrders } = require('../lib/shiprocket');

// Track order states to know which alerts we've already sent
const orderState = new Map(); // { orderId: { status, alertsSent: { 'new': timestamp, 'pending_24h': timestamp, ... } } }

const POLL_INTERVAL = 15 * 60 * 1000; // 15 minutes
let poller = null;

async function broadcastAlert(message) {
  try {
    const { data, error } = await supabase
      .from('broadcasts')
      .insert([{
        message,
        group_filter: 'channel_rings', // Send only to Channel Rings team group
        status: 'approved', // Skip draft, go straight to approved for auto-send
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (error) {
      console.error('[OrderPoller] Failed to create broadcast alert:', error.message);
    } else {
      console.log(`[OrderPoller] ✅ Alert queued (broadcast #${data.id})`);
    }
  } catch (err) {
    console.error('[OrderPoller] Error queuing alert:', err.message);
  }
}

async function getOrderName(orderId) {
  try {
    const orders = await listOrders({ per_page: 100 });
    const orders_arr = orders?.data?.orders || orders?.orders || [];
    const found = orders_arr.find(o => (o.id || o.order_id) === orderId);
    if (found) {
      return found.products?.[0]?.name || found.channel_order_id || 'Unknown Book';
    }
  } catch (_) {}
  return 'Unknown Book';
}

async function poll() {
  try {
    const orders = await listOrders({ per_page: 100 });
    const ordersArr = orders?.data?.orders || orders?.orders || [];
    const now = new Date();

    for (const order of ordersArr) {
      const orderId = order.id || order.order_id;
      const status = (order.status || '').toLowerCase();
      const createdAt = new Date(order.created_at || order.order_date);
      const ageHours = (now - createdAt) / (1000 * 60 * 60);

      // Initialize state for this order if not exists
      if (!orderState.has(orderId)) {
        orderState.set(orderId, { status, alertsSent: {} });
      }

      const state = orderState.get(orderId);
      const bookName = await getOrderName(orderId);

      // ── Alert: NEW order (just arrived, not yet accepted) ──────────────────
      if ((status.includes('new') || status.includes('pending')) && ageHours < 1) {
        if (!state.alertsSent['new']) {
          const msg = `📦 New Order Received!\nBook: ${bookName}\nCustomer: ${order.customer_name || 'N/A'}\nOrder ID: #${orderId}\n\n⚠ Please accept it in SmartBiz.`;
          await broadcastAlert(msg);
          state.alertsSent['new'] = now;
        }
      }

      // ── Alert: Order pending for 24+ hours ──────────────────────────────────
      if ((status.includes('new') || status.includes('pending')) && ageHours >= 24) {
        if (!state.alertsSent['pending_24h']) {
          const msg = `⏰ Reminder: Order not accepted for 1 day!\nBook: ${bookName}\nOrder ID: #${orderId}\n\nPlease accept immediately in SmartBiz.`;
          await broadcastAlert(msg);
          state.alertsSent['pending_24h'] = now;
        }
      }

      // ── Alert: Order moved to Ready to Ship ─────────────────────────────────
      if (status.includes('ready to ship') || status.includes('ready_to_ship')) {
        if (state.status !== 'ready_to_ship') {
          if (!state.alertsSent['ready_to_ship']) {
            const msg = `✅ Ready to Ship!\nBook: ${bookName}\nCustomer: ${order.customer_name || 'N/A'}\nOrder ID: #${orderId}\n\n👉 Please pack and hand over to courier.`;
            await broadcastAlert(msg);
            state.alertsSent['ready_to_ship'] = now;
          }
        }

        // ── Alert: Ready to Ship stuck for 2+ days ─────────────────────────
        if (ageHours >= 48) {
          if (!state.alertsSent['ready_2days']) {
            const msg = `⏰ Reminder: Order not shipped for 2 days!\nBook: ${bookName}\nOrder ID: #${orderId}\n\nPlease dispatch today!`;
            await broadcastAlert(msg);
            state.alertsSent['ready_2days'] = now;
          }
        }
      }

      // Update state
      state.status = status;
    }

    console.log(`[OrderPoller] ✓ Checked ${ordersArr.length} orders at ${now.toISOString()}`);
  } catch (err) {
    console.error('[OrderPoller] Poll error:', err.message);
  }
}

async function start() {
  console.log('[OrderPoller] 🚀 Starting order poller (every 15 min)');

  // Poll immediately on start
  await poll();

  // Then poll every 15 minutes
  poller = setInterval(poll, POLL_INTERVAL);
}

function stop() {
  if (poller) {
    clearInterval(poller);
    poller = null;
    console.log('[OrderPoller] ⛔ Stopped');
  }
}

module.exports = { start, stop, poll };
