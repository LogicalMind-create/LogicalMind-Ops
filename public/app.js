/* ================================================================
   LogicalMind Ops — Dashboard App JS
   Phase 1: Chat agent + Task board
   Phase 2: Orders (SmartBiz → Shiprocket) + Tracking
   ================================================================ */

// ── Config ──────────────────────────────────────────────────────
const API_BASE = '';   // same origin
let SESSION_ID = localStorage.getItem('lm_session_id') || null;

let DASHBOARD_SECRET = localStorage.getItem('lm_dashboard_secret') || '';

function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (DASHBOARD_SECRET) {
    headers['x-dashboard-secret'] = DASHBOARD_SECRET;
  }
  return fetch(API_BASE + path, { ...opts, headers }).then(async (res) => {
    if (res.status === 401) {
      const secret = prompt('Dashboard is protected. Please enter the DASHBOARD_SECRET:');
      if (secret !== null) {
        localStorage.setItem('lm_dashboard_secret', secret);
        DASHBOARD_SECRET = secret;
        // Reload page to retry with new secret
        window.location.reload();
      }
    }
    return res;
  });
}

// ── Navigation ───────────────────────────────────────────────────
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');
  const navBtn = document.getElementById('nav-' + page);
  if (navBtn) navBtn.classList.add('active');

  if (page === 'tasks')      loadTasks();
  if (page === 'home')       loadStats();
  if (page === 'orders')     loadOrders();
  if (page === 'broadcasts') loadBroadcasts();
  if (page === 'notifications') switchNotifTab('queue');
}

// ── Toast ────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const icon = document.createElement('span');
  icon.textContent = icons[type] || '';
  const text = document.createElement('span');
  text.textContent = msg;
  el.appendChild(icon);
  el.appendChild(text);
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)';
    el.style.transition = 'all .3s'; setTimeout(() => el.remove(), 300); }, 3500);
}

// ── Clock ────────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('topbar-time');
  if (el) el.textContent = new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit'
  });
}
setInterval(updateClock, 30000);
updateClock();

// ── Stats (home page) ────────────────────────────────────────────
async function loadStats() {
  // Task count
  try {
    const res = await apiFetch('/api/tasks?status=pending');
    if (res.ok) {
      const tasks = await res.json();
      const el = document.getElementById('stat-pending-tasks');
      if (el) el.textContent = tasks.length;
    }
  } catch (_) {}

  // Order stats
  try {
    const res = await apiFetch('/api/orders/stats');
    if (res.ok) {
      const stats = await res.json();
      const todayEl   = document.getElementById('stat-today-orders');
      const pendingEl = document.getElementById('stat-pending-orders');
      const delayedEl = document.getElementById('stat-delayed-orders');

      if (todayEl)   todayEl.textContent   = stats.today_count;
      if (pendingEl) pendingEl.textContent = stats.pending_count;
      if (delayedEl) {
        if (stats.delayed_count > 0) {
          delayedEl.innerHTML = `<span style="color:#f59e0b;font-weight:600">⚠ ${stats.delayed_count} delayed (≥2 days)</span>`;
          // Flash the order badge
          const badge = document.getElementById('order-badge');
          if (badge) { badge.style.display = ''; badge.textContent = stats.delayed_count; }
        } else {
          delayedEl.textContent = 'All on track';
          const badge = document.getElementById('order-badge');
          if (badge) { badge.style.display = 'none'; badge.textContent = '!'; }
        }
      }
    }
  } catch (_) {}

  // Notification stats
  try {
    const res = await apiFetch('/api/notifications/stats');
    if (res.ok) {
      const stats = await res.json();
      const pendingEl = document.getElementById('stat-pending-notifs');
      const sentEl = document.getElementById('stat-sent-notifs');
      if (pendingEl) pendingEl.textContent = stats.pending;
      if (sentEl) sentEl.textContent = stats.sentToday;

      const badge = document.getElementById('notif-badge');
      if (badge) {
        badge.style.display = stats.pending > 0 ? '' : 'none';
        badge.textContent = stats.pending;
      }
    }
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════
// ── CHAT ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
const chatMessages  = document.getElementById('chat-messages');
const chatInput     = document.getElementById('chat-input');
const btnSend       = document.getElementById('btn-send');
let   isThinking    = false;

function renderMessage(role, text, toolsUsed = []) {
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.textContent = role === 'user' ? '👤' : '🤖';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.textContent = text;

  const wrapper = document.createElement('div');
  wrapper.appendChild(bubble);

  if (toolsUsed && toolsUsed.length > 0) {
    const badge = document.createElement('div');
    badge.className = 'chat-tools-badge';
    badge.innerHTML = '⚡ Used: ' + toolsUsed.map(t => `<span>${t}</span>`).join(' ');
    wrapper.appendChild(badge);
  }

  div.appendChild(avatar);
  div.appendChild(wrapper);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showTyping() {
  const div = document.createElement('div');
  div.id = 'typing-indicator';
  div.className = 'chat-message agent';
  div.innerHTML = `
    <div class="chat-avatar">🤖</div>
    <div class="chat-bubble" style="padding:10px 14px">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function hideTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isThinking) return;

  isThinking = true;
  btnSend.disabled = true;
  chatInput.value = '';
  chatInput.style.height = 'auto';

  renderMessage('user', text);
  showTyping();

  try {
    const res = await apiFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: text, session_id: SESSION_ID }),
    });

    hideTyping();

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errMsg = err.detail || err.error || 'Something went wrong. Please try again.';
      renderMessage('agent', `⚠️ ${errMsg}`);
      toast(err.error || 'Request failed', 'error');
      return;
    }

    const data = await res.json();
    SESSION_ID = data.session_id;
    localStorage.setItem('lm_session_id', SESSION_ID);

    renderMessage('agent', data.reply, data.tools_used);

    // Refresh task badge/list if task tools were used
    if (data.tools_used?.some(t => t.includes('task'))) {
      updateTaskBadge();
      if (document.getElementById('page-tasks').classList.contains('active')) {
        loadTasks();
      }
    }
    // Refresh orders if order tools were used
    if (data.tools_used?.some(t => t.includes('order') || t.includes('shipment'))) {
      if (document.getElementById('page-orders').classList.contains('active')) {
        loadOrders();
      }
      loadStats(); // Refresh home stats card too
    }
  } catch (err) {
    hideTyping();
    renderMessage('agent', '⚠️ Could not reach the server. Check your connection.');
    toast('Network error', 'error');
  } finally {
    isThinking = false;
    btnSend.disabled = false;
    chatInput.focus();
  }
}

// Auto-resize textarea
chatInput?.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

chatInput?.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

btnSend?.addEventListener('click', sendMessage);

// Suggestion chips
document.querySelectorAll('.suggestion-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (chatInput) {
      chatInput.value = chip.dataset.msg || chip.textContent.trim();
      chatInput.focus();
    }
  });
});

function clearChat() {
  if (SESSION_ID) {
    apiFetch(`/api/chat/${SESSION_ID}`, { method: 'DELETE' }).catch(() => {});
    SESSION_ID = null;
    localStorage.removeItem('lm_session_id');
  }
  if (chatMessages) {
    // Keep only the welcome message
    chatMessages.innerHTML = `
      <div class="chat-message agent">
        <div class="chat-avatar">🤖</div>
        <div class="chat-bubble">
          Namaste! I'm your LogicalMind Ops agent. I can help you manage tasks, send team alerts, and more. Try asking me something! 🙏
        </div>
      </div>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// ── TASKS ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
let taskFilter = { status: 'pending', person: '' };

async function loadTasks() {
  const list = document.getElementById('task-list');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><div class="emoji">⏳</div><p>Loading...</p></div>';

  const params = new URLSearchParams();
  params.set('status', taskFilter.status);
  if (taskFilter.person) params.set('person', taskFilter.person);

  try {
    const res = await apiFetch(`/api/tasks?${params}`);
    const tasks = await res.json();
    renderTasks(tasks);
    updateTaskBadge(tasks.filter(t => t.status === 'pending').length);
  } catch (_) {
    list.innerHTML = '<div class="empty-state"><div class="emoji">❌</div><p>Failed to load tasks</p></div>';
  }
}

function renderTasks(tasks) {
  const list = document.getElementById('task-list');
  if (!list) return;

  if (!tasks || tasks.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="emoji">🎉</div>
        <p>${taskFilter.status === 'pending' ? 'No pending tasks! All clear.' : 'No tasks here.'}</p>
      </div>`;
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  list.innerHTML = tasks.map(t => {
    const isDone    = t.status === 'done';
    const isOverdue = !isDone && t.due_date < today;
    const dueLabel  = isOverdue
      ? `<span class="task-due-overdue">⚠ Overdue · ${t.due_date}</span>`
      : `<span>${t.due_date || ''}</span>`;

    return `
      <div class="task-item ${isDone ? 'done' : ''}" data-id="${t.id}">
        <div class="task-check" onclick="toggleTask('${t.id}','${t.status}')">
          ${isDone ? '✓' : ''}
        </div>
        <div class="task-body">
          <div class="task-title">${escHtml(t.title)}</div>
          <div class="task-meta">
            <span class="task-person-badge">${escHtml(t.person)}</span>
            ${dueLabel}
            ${t.notes ? `<span>· ${escHtml(t.notes)}</span>` : ''}
          </div>
        </div>
        <button class="task-delete" onclick="deleteTask('${t.id}')" title="Delete">🗑</button>
      </div>`;
  }).join('');
}

async function toggleTask(id, currentStatus) {
  const newStatus = currentStatus === 'done' ? 'pending' : 'done';
  try {
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    });
    loadTasks();
  } catch (_) { toast('Failed to update task', 'error'); }
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  try {
    await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
    loadTasks();
    toast('Task deleted', 'info');
  } catch (_) { toast('Failed to delete task', 'error'); }
}

async function addTaskManual() {
  const person   = document.getElementById('new-person').value.trim();
  const title    = document.getElementById('new-title').value.trim();
  const due_date = document.getElementById('new-due').value;

  if (!person || !title || !due_date) {
    toast('Fill in all fields', 'error'); return;
  }

  try {
    const res = await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ person, title, due_date }),
    });
    if (!res.ok) throw new Error('Failed');
    document.getElementById('new-person').value = '';
    document.getElementById('new-title').value  = '';
    document.getElementById('new-due').value    = '';
    loadTasks();
    toast('Task added!', 'success');
  } catch (_) { toast('Failed to add task', 'error'); }
}

function setTaskFilter(status) {
  taskFilter.status = status;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === status);
  });
  loadTasks();
}

function updateTaskBadge(count) {
  const badge = document.getElementById('task-badge');
  if (!badge) return;
  if (count === undefined) {
    apiFetch('/api/tasks?status=pending')
      .then(r => r.json())
      .then(t => { badge.textContent = t.length; })
      .catch(() => {});
  } else {
    badge.textContent = count;
  }
}

// ═══════════════════════════════════════════════════════════════
// ── ORDERS ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
let orderFilter = 'pending';
const orderDateFilter = {
  from: '',
  to: '',
  undeliveredOnly: false,
};

function setDefaultOrderDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);

  orderDateFilter.from = from.toISOString().slice(0, 10);
  orderDateFilter.to = to.toISOString().slice(0, 10);
}

function syncOrderFilterControls() {
  const fromEl = document.getElementById('orders-from-date');
  const toEl = document.getElementById('orders-to-date');
  const undeliveredEl = document.getElementById('orders-undelivered-only');
  if (fromEl) fromEl.value = orderDateFilter.from || '';
  if (toEl) toEl.value = orderDateFilter.to || '';
  if (undeliveredEl) undeliveredEl.checked = !!orderDateFilter.undeliveredOnly;
}

function applyOrderFilters() {
  const fromEl = document.getElementById('orders-from-date');
  const toEl = document.getElementById('orders-to-date');
  const undeliveredEl = document.getElementById('orders-undelivered-only');

  orderDateFilter.from = fromEl?.value || '';
  orderDateFilter.to = toEl?.value || '';
  orderDateFilter.undeliveredOnly = !!undeliveredEl?.checked;
  loadOrders();
}

function resetOrderFilters() {
  setDefaultOrderDateRange();
  orderDateFilter.undeliveredOnly = false;
  syncOrderFilterControls();
  loadOrders();
}

async function loadOrders() {
  const list = document.getElementById('order-list');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><div class="emoji">⏳</div><p>Loading orders…</p></div>';
  syncOrderFilterControls();

  try {
    const params = new URLSearchParams({ status: orderFilter, limit: 200, include_shiprocket: 'true' });
    if (orderDateFilter.from) params.set('start_date', orderDateFilter.from);
    if (orderDateFilter.to) params.set('end_date', orderDateFilter.to);
    if (orderDateFilter.undeliveredOnly) params.set('undelivered_only', 'true');

    const res    = await apiFetch(`/api/orders?${params}`);
    if (!res.ok) throw new Error('Failed');
    const orders = await res.json();
    renderOrders(orders);
  } catch (_) {
    list.innerHTML = '<div class="empty-state"><div class="emoji">❌</div><p>Failed to load orders. Check server.</p></div>';
  }
}

function renderOrders(orders) {
  const list = document.getElementById('order-list');
  if (!list) return;

  if (!orders || orders.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="emoji">📭</div>
        <p>No matching orders in this date range/filter. Try widening the date range.</p>
      </div>`;
    return;
  }

  list.innerHTML = orders.map(o => {
    const isDelayed = !!o.delay_flag;
    const statusColor = {
      pending:   isDelayed ? '#f59e0b' : '#6366f1',
      ready_to_ship: '#f59e0b',
      shipped:   '#22c55e',
      delivered: '#10b981',
      cancelled: '#ef4444',
    }[o.status] || '#6b7280';

    const destination = [o.address_line1, o.address_line2, o.city, o.state, o.pincode]
      .map(v => String(v || '').trim())
      .filter(Boolean)
      .join(', ') || 'Address not available';
    const shippingStage =
      o.status === 'delivered' ? 'Delivered' :
      o.status === 'shipped' ? 'In transit (not delivered yet)' :
      o.status === 'ready_to_ship' ? 'Ready to ship' :
      o.status === 'pending' ? 'Not shipped yet' :
      o.status;
    const ageText = Number.isFinite(o.age_days) ? `${o.age_days}d ago` : 'recently';

    return `
      <div class="task-item" style="${isDelayed ? 'border-left:3px solid #f59e0b;' : ''}">
        <div class="task-body" style="flex:1">
          <div class="task-title" style="display:flex;align-items:center;gap:8px">
            ${escHtml(o.product_name || 'Unknown Product')}
            <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:${statusColor}22;color:${statusColor}">
              ${o.status.toUpperCase()}
            </span>
            ${isDelayed ? `<span style="font-size:11px;color:#f59e0b;font-weight:600">⚠ ${escHtml(o.delay_flag)}</span>` : ''}
          </div>
          <div class="task-meta">
            <span class="task-person-badge">${escHtml(o.external_id || o.id.slice(0, 8))}</span>
            <span>Customer: ${escHtml(o.customer_name || '—')}</span>
            <span>Destination: ${escHtml(destination)}</span>
            <span>SKU: ${escHtml(o.sku || '—')}</span>
            <span>Qty: ${o.quantity}</span>
            ${o.awb && o.awb !== 'N/A' ? `<span>AWB: <strong>${escHtml(o.awb)}</strong></span>` : ''}
            <span>Shipping: ${escHtml(shippingStage)}</span>
            <span style="color:var(--muted)">Updated ${escHtml(ageText)}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          ${['pending', 'ready_to_ship'].includes(o.status) ? `
            <button class="btn btn-primary" style="font-size:11px;padding:4px 10px"
              onclick="shipViaAgent('${escJs(o.id)}', '${escJs(o.external_id || o.id.slice(0,8))}')">
              🚚 Ship via Agent
            </button>` : ''}
          ${(o.awb && o.awb !== 'N/A') ? `
            <button class="btn btn-ghost" style="font-size:11px;padding:4px 10px"
              onclick="trackViaAgent('${escJs(o.awb)}')">
              🔍 Track
            </button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function setOrderFilter(status) {
  orderFilter = status;
  // Update active filter button (scoped to orders page)
  const page = document.getElementById('page-orders');
  if (!page) return;
  page.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === status);
  });
  loadOrders();
}

// Pre-fill the chat with a ship command and navigate to agent
function shipViaAgent(orderId, externalId) {
  navigate('chat');
  if (chatInput) {
    chatInput.value = `Create a shipment for order ID ${orderId} (SmartBiz order ${externalId})`;
    chatInput.focus();
  }
}

function trackViaAgent(awb) {
  navigate('chat');
  if (chatInput) {
    chatInput.value = `Track shipment AWB ${awb}`;
    chatInput.focus();
  }
}

// ── Helpers ──────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function escJs(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
}

// ═════════════════════════════════════════════════════════════
// ── BROADCASTS ──────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════
async function loadBroadcasts() {
  const list = document.getElementById('broadcast-list');
  if (!list) return;
  try {
    const res  = await apiFetch('/api/broadcasts?limit=30');
    const data = await res.json();
    renderBroadcasts(data);
    // Update badge with draft count
    const drafts = data.filter(b => b.status === 'draft').length;
    const badge  = document.getElementById('broadcast-badge');
    if (badge) {
      badge.style.display = drafts > 0 ? '' : 'none';
      badge.textContent   = drafts;
    }
  } catch (_) {
    list.innerHTML = '<div class="empty-state"><div class="emoji">❌</div><p>Could not load broadcasts.</p></div>';
  }
}

function renderBroadcasts(broadcasts) {
  const list = document.getElementById('broadcast-list');
  if (!list) return;
  if (!broadcasts || broadcasts.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="emoji">📢</div><p>No broadcasts yet. Compose one above!</p></div>';
    return;
  }
  const statusColor = { draft:'#6366f1', approved:'#f59e0b', sending:'#3b82f6', sent:'#22c55e', failed:'#ef4444' };
  list.innerHTML = broadcasts.map(b => {
    const color    = statusColor[b.status] || '#6b7280';
    const progress = b.groups_total > 0
      ? `<div style="margin-top:6px;height:4px;background:var(--border);border-radius:99px;overflow:hidden">
           <div style="height:100%;width:${Math.round(b.groups_sent/b.groups_total*100)}%;background:#22c55e;transition:width .4s"></div>
         </div>
         <span style="font-size:11px;color:var(--muted)">${b.groups_sent}/${b.groups_total} groups</span>`
      : '';
    const dateStr = new Date(b.created_at).toLocaleString('en-IN', { timeZone:'Asia/Kolkata', dateStyle:'short', timeStyle:'short' });
    const mediaTag = b.media_url
      ? `<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:#3b82f622;color:#3b82f6;font-weight:600">
          ${b.media_type === 'pdf' ? '📄 PDF' : '🖼 Image'}
        </span>`
      : '';
    const errBlock = (b.status === 'failed' && b.error_reason)
      ? `<div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:#fef2f2;color:#b91c1c;font-size:12px;white-space:pre-wrap;border:1px solid #fecaca">
          <strong>Error:</strong> ${escHtml(b.error_reason)}
        </div>`
      : '';
    return `
      <div class="task-item">
        <div class="task-body" style="flex:1">
          <div class="task-title" style="white-space:pre-wrap">${escHtml(b.message)}</div>
          <div class="task-meta" style="margin-top:6px">
            <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:${color}22;color:${color}">${b.status.toUpperCase()}</span>
            ${mediaTag}
            <span>Filter: ${escHtml(b.group_filter)}</span>
            <span>${dateStr}</span>
          </div>
          ${progress}
          ${errBlock}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0">
          ${b.status === 'draft' ? `
            <button class="btn btn-primary" style="font-size:11px;padding:5px 12px"
              onclick="approveBroadcast('${b.id}')">Approve &amp; Send ✅</button>
            <button class="btn btn-ghost" style="font-size:11px;padding:5px 10px;color:var(--danger)"
              onclick="deleteBroadcast('${b.id}')">Delete</button>` : ''}
          ${b.status === 'failed' ? `
            <button class="btn btn-primary" style="font-size:11px;padding:5px 12px"
              onclick="retryBroadcast('${b.id}')">Retry ↻</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function createBroadcast() {
  const msg       = document.getElementById('broadcast-compose')?.value?.trim();
  const filter    = document.getElementById('broadcast-filter')?.value || 'all';
  const mediaUrl  = document.getElementById('broadcast-media-url')?.value?.trim() || null;
  const mediaType = document.getElementById('broadcast-media-type')?.value || null;

  if (!msg) { toast('Please type a message first', 'error'); return; }

  // Validate media
  if (mediaUrl && !mediaType) {
    toast('Please select a media type (Image or PDF)', 'error');
    return;
  }
  if (!mediaUrl && mediaType) {
    toast('Please paste a media URL for the selected type', 'error');
    return;
  }

  const body = { message: msg, group_filter: filter };
  if (mediaUrl)  body.media_url  = mediaUrl;
  if (mediaType) body.media_type = mediaType;

  const res = await apiFetch('/api/broadcasts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (res.ok) {
    document.getElementById('broadcast-compose').value = '';
    if (document.getElementById('broadcast-media-url')) document.getElementById('broadcast-media-url').value = '';
    if (document.getElementById('broadcast-media-type')) document.getElementById('broadcast-media-type').value = '';
    const mediaNote = mediaUrl ? ` with ${mediaType} attachment` : '';
    toast(`✅ Added to queue${mediaNote} — review and approve below`, 'success');
    loadBroadcasts();
  } else {
    const err = await res.json().catch(() => ({}));
    toast(err.error || 'Failed to create broadcast', 'error');
  }
}

async function approveBroadcast(id) {
  if (!confirm('Are you sure? This will send the message to your WhatsApp groups once the helper picks it up.')) return;
  const res = await apiFetch(`/api/broadcasts/${id}/approve`, { method: 'POST' });
  if (res.ok) {
    toast('✅ Approved! Helper will send within 30 seconds.', 'success');
    loadBroadcasts();
    // Auto-refresh while sending
    const interval = setInterval(async () => {
      const r = await apiFetch(`/api/broadcasts?limit=30`);
      const data = await r.json();
      renderBroadcasts(data);
      const stillSending = data.some(b => b.status === 'sending' || b.status === 'approved');
      if (!stillSending) clearInterval(interval);
    }, 5000);
  } else {
    const err = await res.json().catch(() => ({}));
    toast(err.error || 'Failed to approve', 'error');
  }
}

async function deleteBroadcast(id) {
  if (!confirm('Delete this draft?')) return;
  const res = await apiFetch(`/api/broadcasts/${id}`, { method: 'DELETE' });
  if (res.ok) { toast('Deleted', 'info'); loadBroadcasts(); }
  else toast('Could not delete', 'error');
}

async function retryBroadcast(id) {
  if (!confirm('Re-queue this broadcast for the WhatsApp helper? It will be set to approved again.')) return;
  const res = await apiFetch(`/api/broadcasts/${id}/retry`, { method: 'POST' });
  if (res.ok) {
    toast('↻ Re-queued — helper will pick it up shortly.', 'success');
    loadBroadcasts();
  } else {
    const err = await res.json().catch(() => ({}));
    toast(err.error || 'Retry failed', 'error');
  }
}

// ═════════════════════════════════════════════════════════════
// ── NOTIFICATIONS ──────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════

let currentNotifTab = 'queue';

function switchNotifTab(tab) {
  currentNotifTab = tab;
  ['queue', 'campaigns', 'history'].forEach(t => {
    const btn = document.getElementById(`tab-notif-${t}`);
    const div = document.getElementById(`notif-list-${t}`);
    if (btn) {
      btn.style.background = t === tab ? '#222' : 'transparent';
      btn.style.color = t === tab ? '#fff' : 'inherit';
    }
    if (div) div.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'queue') loadNotifications('pending_approval', 'queue');
  if (tab === 'history') loadNotifications('all', 'history');
  if (tab === 'campaigns') loadNotificationCampaigns();
}

async function loadNotifications(status = 'pending_approval', listId = 'queue') {
  const list = document.getElementById(`notif-list-${listId}`);
  if (!list) return;
  try {
    const res = await apiFetch(`/api/notifications?status=${status}&limit=50`);
    const data = await res.json();
    
    if (!data || data.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="emoji">🔔</div><p>No ${listId === 'queue' ? 'pending approvals' : 'history'} found.</p></div>`;
      return;
    }
    
    const statusColor = { draft:'#6366f1', pending_approval:'#f59e0b', sending:'#3b82f6', sent:'#22c55e', failed:'#ef4444' };
    
    list.innerHTML = data.map(n => {
      const color = statusColor[n.status] || '#6b7280';
      const dateStr = new Date(n.created_at).toLocaleString('en-IN', { timeZone:'Asia/Kolkata', dateStyle:'short', timeStyle:'short' });
      const errBlock = (n.status === 'failed' && n.error_reason) ? `<div style="margin-top:8px;color:#ef4444;font-size:12px">Error: ${escHtml(n.error_reason)}</div>` : '';
      
      return `
        <div class="task-item">
          <div class="task-body" style="flex:1">
            <div class="task-title">${escHtml(n.title)}</div>
            <div style="font-size:13px;color:#ccc;margin:4px 0">${escHtml(n.body)}</div>
            <div class="task-meta" style="margin-top:6px">
              <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:${color}22;color:${color}">${n.status.toUpperCase()}</span>
              <span>Target: ${escHtml(n.target_type)}</span>
              <span>Category: ${escHtml(n.category)}</span>
              ${n.scheduled_for ? `<span>Scheduled: ${new Date(n.scheduled_for).toLocaleString()}</span>` : ''}
              <span>Created: ${dateStr}</span>
            </div>
            ${errBlock}
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
            ${n.status === 'pending_approval' ? `
              <button class="btn btn-primary" style="font-size:11px;padding:5px 12px" onclick="approveNotif('${n.id}')">Approve ✅</button>
              <button class="btn btn-ghost" style="font-size:11px;padding:5px 10px;color:var(--danger)" onclick="rejectNotif('${n.id}')">Reject ❌</button>
            ` : ''}
          </div>
        </div>`;
    }).join('');
    
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><p>Error loading notifications.</p></div>';
  }
}

async function loadNotificationCampaigns() {
  const list = document.getElementById('notif-list-campaigns');
  if (!list) return;
  try {
    const res = await apiFetch('/api/notification-campaigns');
    const data = await res.json();
    
    if (!data || data.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="emoji">📅</div><p>No campaigns set up.</p></div>';
      return;
    }
    
    list.innerHTML = data.map(c => `
      <div class="task-item">
        <div class="task-body" style="flex:1">
          <div class="task-title">${escHtml(c.name)} <span style="font-size:12px;color:var(--muted)">(${c.is_active ? 'Active' : 'Paused'})</span></div>
          <div style="font-size:13px;color:#ccc;margin:4px 0">Template: ${escHtml(c.template_title)}</div>
          <div class="task-meta" style="margin-top:6px">
            <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:#3b82f622;color:#3b82f6">Cron: ${escHtml(c.cron_rule)}</span>
            <span>Target: ${escHtml(c.target_type)}</span>
            <span>Last run: ${c.last_run_at ? new Date(c.last_run_at).toLocaleString() : 'Never'}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          <button class="btn btn-ghost" style="font-size:11px;padding:5px 10px" onclick="toggleCampaign('${c.id}', ${!c.is_active})">${c.is_active ? 'Pause ⏸' : 'Resume ▶'}</button>
          <button class="btn btn-ghost" style="font-size:11px;padding:5px 10px;color:var(--danger)" onclick="deleteCampaign('${c.id}')">Delete 🗑</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><p>Error loading campaigns.</p></div>';
  }
}

async function draftNotification() {
  const title = document.getElementById('notif-title').value.trim();
  const body = document.getElementById('notif-body').value.trim();
  const target_type = document.getElementById('notif-target').value;
  const category = document.getElementById('notif-category').value;
  const scheduled_for = document.getElementById('notif-schedule').value || null;

  if (!title || !body) { toast('Title and body required', 'error'); return; }

  const payload = { title, body, target_type, category, scheduled_for };
  const res = await apiFetch('/api/notifications', { method: 'POST', body: JSON.stringify(payload) });
  if (res.ok) {
    document.getElementById('notif-title').value = '';
    document.getElementById('notif-body').value = '';
    document.getElementById('notif-schedule').value = '';
    toast('✅ Notification drafted and queued for approval', 'success');
    if (currentNotifTab === 'queue') loadNotifications('pending_approval', 'queue');
    loadStats();
  } else {
    toast('Failed to draft notification', 'error');
  }
}

async function approveNotif(id) {
  if (!confirm('Approve this notification? It will be sent via TeachX app.')) return;
  const res = await apiFetch(`/api/notifications/${id}/approve`, { method: 'POST' });
  if (res.ok) {
    toast('✅ Approved!', 'success');
    if (currentNotifTab === 'queue') loadNotifications('pending_approval', 'queue');
    loadStats();
  } else {
    toast('Failed to approve', 'error');
  }
}

async function rejectNotif(id) {
  if (!confirm('Reject and cancel this draft?')) return;
  const res = await apiFetch(`/api/notifications/${id}/reject`, { method: 'POST' });
  if (res.ok) {
    toast('❌ Rejected draft', 'info');
    if (currentNotifTab === 'queue') loadNotifications('pending_approval', 'queue');
    loadStats();
  }
}

async function toggleCampaign(id, isActive) {
  const res = await apiFetch(`/api/notification-campaigns/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) });
  if (res.ok) loadNotificationCampaigns();
}

async function deleteCampaign(id) {
  if (!confirm('Delete this campaign?')) return;
  const res = await apiFetch(`/api/notification-campaigns/${id}`, { method: 'DELETE' });
  if (res.ok) loadNotificationCampaigns();
}

// ── Secret setup ─────────────────────────────────────────────────
// ── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Set today's date as default for new task form
  const dueInput = document.getElementById('new-due');
  if (dueInput) dueInput.value = new Date().toISOString().slice(0, 10);
  setDefaultOrderDateRange();
  orderDateFilter.undeliveredOnly = true;
  syncOrderFilterControls();

  navigate('home');
  updateTaskBadge();
  loadStats();
  loadBroadcasts(); // Preload broadcast badge
  setInterval(loadStats, 5 * 60 * 1000);
});
