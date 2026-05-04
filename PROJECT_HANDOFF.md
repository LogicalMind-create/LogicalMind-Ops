# LogicalMind Ops - Project Handoff

## Purpose

LogicalMind Ops is an internal operations dashboard for a small team at Logical Mind Education.

It currently handles:

- Team task management
- AI agent chat for ops actions
- Amazon SmartBiz order tracking
- Shiprocket shipment creation/tracking
- Telegram alerts
- WhatsApp group broadcast queue + local WhatsApp Web helper

This file is meant to let another AI continue bug fixing without re-analyzing the repo from scratch.

---

## Project Root

`C:\Users\kumar\OneDrive\Desktop\LogicalMind_Ops`

---

## High-Level Architecture

### Frontend

Static dashboard served from:

- [public/index.html](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/public/index.html)
- [public/app.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/public/app.js)
- [public/style.css](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/public/style.css)

Main pages in UI:

- Home
- AI Agent
- Tasks
- Orders
- WhatsApp Broadcasts

### Backend

Node/Express server:

- [server/index.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/index.js)

Main routes:

- [server/routes/chat.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/routes/chat.js)
- [server/routes/tasks.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/routes/tasks.js)
- [server/routes/orders.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/routes/orders.js)
- [server/routes/broadcasts.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/routes/broadcasts.js)

Main integrations:

- Supabase
- Groq LLM
- Telegram Bot
- Shiprocket
- WhatsApp Web automation via Playwright

### AI Agent

Agent implementation:

- [server/agent/gemini.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/agent/gemini.js)

Important note:

- File name still says `gemini.js`
- Actual implementation uses `groq-sdk`
- Model used: `llama-3.3-70b-versatile`

### Database

Supabase schema files:

- [supabase_schema.sql](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/supabase_schema.sql)
- [supabase_broadcasts.sql](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/supabase_broadcasts.sql)

Important:

- `supabase_schema.sql` contains core tables like `tasks`, `chat_messages`, `agent_runs`, `orders`, `products`
- `supabase_broadcasts.sql` contains the actual `broadcasts` table and related migration bits
- Main schema and broadcast schema are still split across two files

### WhatsApp Automation

Local helper lives in:

- [whatsapp-helper/helper.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/whatsapp-helper/helper.js)
- [whatsapp-helper/discover-groups.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/whatsapp-helper/discover-groups.js)
- [whatsapp-helper/groups.json](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/whatsapp-helper/groups.json)

This helper:

- Runs on a local PC, not on Render
- Polls `/api/broadcasts`
- Picks up approved broadcasts
- Opens WhatsApp Web through Playwright
- Sends text/image/pdf to groups listed in `groups.json`

---

## Main Flows

### 1. Task Flow

- User creates or updates tasks from dashboard or AI agent
- Stored in Supabase `tasks`
- Task tools:
  - `assign_task`
  - `list_tasks`
  - `complete_task`

Relevant files:

- [server/tools/assign_task.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/tools/assign_task.js)
- [server/tools/list_tasks.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/tools/list_tasks.js)
- [server/tools/complete_task.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/tools/complete_task.js)

### 2. Orders / Shiprocket Flow

- Orders are scraped from Amazon SmartBiz
- Orders stored in Supabase `orders`
- Shipments created via Shiprocket
- Shiprocket webhook updates order state

Relevant files:

- [scripts/smartbiz-scraper.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/scripts/smartbiz-scraper.js)
- [server/routes/orders.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/routes/orders.js)
- [server/lib/shiprocket.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/lib/shiprocket.js)
- [server/tools/create_shipment.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/tools/create_shipment.js)
- [server/tools/track_shipment.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/tools/track_shipment.js)
- [server/webhooks/shiprocket.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/webhooks/shiprocket.js)

### 3. Telegram Flow

- Team alerts can be sent via bot
- Telegram webhook can also create WhatsApp broadcasts for a special team-group path

Relevant files:

- [server/lib/telegram.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/lib/telegram.js)
- [server/webhooks/telegram.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/webhooks/telegram.js)

### 4. WhatsApp Broadcast Flow

Current intended flow:

1. Draft broadcast in dashboard or via AI tool
2. Entry inserted into Supabase `broadcasts` with status `draft`
3. User clicks `Approve & Send`
4. Route updates broadcast to `approved`
5. Local helper polls approved broadcasts
6. Helper changes status to `sending`
7. Helper sends to matching groups
8. Helper updates `groups_sent`, `groups_total`, `status`
9. Final status becomes `sent` or `failed`

Relevant files:

- [public/app.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/public/app.js)
- [server/routes/broadcasts.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/routes/broadcasts.js)
- [server/tools/broadcast_whatsapp.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/tools/broadcast_whatsapp.js)
- [whatsapp-helper/helper.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/whatsapp-helper/helper.js)

---

## Environment Variables

Main `.env.example`:

- [\.env.example](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/.env.example)

Important env vars:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `GROQ_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_WEBHOOK_SECRET`
- `APP_URL`
- `SHIPROCKET_EMAIL`
- `SHIPROCKET_PASSWORD`
- `SHIPROCKET_WEBHOOK_SECRET`
- `SMARTBIZ_EMAIL`
- `SMARTBIZ_PASSWORD`
- `PORT`
- `NODE_ENV`
- `DASHBOARD_SECRET`
- `WHATSAPP_GROUP_CHANNEL_RINGS_NAME`
- `SERVER_URL`
- `POLL_INTERVAL_MS`

Important caution:

- `.env.example` still contains mixed Gemini/Groq history and should be reviewed
- `whatsapp-helper/.env` exists locally
- `whatsapp-helper/wa-session` exists locally and contains sensitive browser session state

---

## Current Status by Phase

### Phase 1

Status: mostly working

- AI agent chat
- Task creation/list/complete
- Telegram notify tool

### Phase 2

Status: mostly working

- Orders dashboard
- Delayed order highlighting
- Shipment creation
- Tracking
- Shiprocket webhook updates

### Phase 3

Status: implemented but still operationally fragile

- Broadcast queue exists
- Draft -> approve -> send flow exists
- Local WhatsApp helper exists
- Telegram -> WhatsApp forwarding path exists
- Main instability area is still the real-world WhatsApp Web automation path

### Phase 4

Status: not really implemented

- Finance is mostly placeholder UI and commented schema ideas

### Phase 5

Status: not implemented

- Notifications / marketing are still roadmap-level

---

## Recent Fixes Already Applied

These fixes were already made and pushed.

Commit pushed:

- `a2063c4` on `main`

### 1. Broadcast approval backend fix

File:

- [server/routes/broadcasts.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/routes/broadcasts.js)

Fix:

- approval route changed from `.single()` to `.maybeSingle()`

Why:

- `single()` could cause approval to fail noisily when no matching draft row existed
- now it handles "not found or already approved" more cleanly

### 2. Dashboard approval error visibility fix

File:

- [public/app.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/public/app.js)

Fix:

- when approval fails, dashboard now shows backend error text instead of only generic `Failed to approve`

### 3. WhatsApp helper hardening

File:

- [whatsapp-helper/helper.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/whatsapp-helper/helper.js)

Fixes included:

- clears search box before each group lookup
- broader selectors for search/chat/caption/input
- more resilient file input handling
- immediate poll on startup
- fails early if `channel_rings` config is missing
- fails early when no groups match a filter

---

## Known Risk Areas / Likely Remaining Bugs

These are the places another AI should investigate first.

### A. WhatsApp Web selector fragility

Even after helper hardening, WhatsApp Web can still break due to UI changes.

High-risk file:

- [whatsapp-helper/helper.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/whatsapp-helper/helper.js)

Most likely breakpoints:

- search box selector
- attach button selector
- actual file input selector
- caption input selector
- send button selector
- title matching for groups with Unicode / emoji / punctuation

### B. Broadcast approval might still fail due to auth or DB state

If `Approve & Send` still fails, likely causes:

- wrong `DASHBOARD_SECRET`
- stale draft already approved
- missing `broadcasts` table columns
- frontend using stale server bundle
- Supabase service key / permissions problem

Check:

- [server/index.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/index.js)
- [server/routes/broadcasts.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/server/routes/broadcasts.js)
- [public/app.js](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/public/app.js)

### C. Main schema still split across two SQL files

Still a setup/documentation gap:

- [supabase_schema.sql](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/supabase_schema.sql)
- [supabase_broadcasts.sql](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/supabase_broadcasts.sql)

This can cause:

- incomplete fresh setup
- missing `broadcasts` table
- missing `media_url`, `media_type`, `groups_sent`, `groups_total`

### D. `.env.example` still needs cleanup

Potential confusion:

- Gemini references still linger
- example file should probably reflect only the real stack now

### E. Sensitive local helper data in repo folder

Local-only but risky:

- `whatsapp-helper/.env`
- `whatsapp-helper/wa-session`

Also `.gitignore` is minimal:

- [\.gitignore](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/.gitignore)

### F. Finance / notifications UI may exist without backend

UI mentions these sections, but backend implementation is not present in equivalent depth.

---

## Suggested Debug Order for Another AI

If another AI is asked to continue bug-fixing, this is the best order:

1. Verify `Approve & Send` end to end
2. Verify broadcast row changes from `draft` -> `approved`
3. Run local helper and verify it picks up approved rows immediately
4. Verify helper can send to exactly one safe test group
5. Verify media upload path separately from text-only path
6. Verify `channel_rings` special route
7. Clean schema split between `supabase_schema.sql` and `supabase_broadcasts.sql`
8. Clean `.env.example` and `.gitignore`

---

## Quick Local Run Commands

### Server

```powershell
cd "C:\Users\kumar\OneDrive\Desktop\LogicalMind_Ops"
npm install
npm run dev
```

### WhatsApp helper

```powershell
cd "C:\Users\kumar\OneDrive\Desktop\LogicalMind_Ops\whatsapp-helper"
npm install
node helper.js
```

### Discover groups again if needed

```powershell
cd "C:\Users\kumar\OneDrive\Desktop\LogicalMind_Ops\whatsapp-helper"
node discover-groups.js
```

---

## Current Group List

Main group source:

- [whatsapp-helper/groups.json](C:/Users/kumar/OneDrive/Desktop/LogicalMind_Ops/whatsapp-helper/groups.json)

Current `groups.json` appears to contain about 42 groups, mostly DSC / Logical Mind / SGT groups.

Special team-group flow depends on:

- `WHATSAPP_GROUP_CHANNEL_RINGS_NAME`

---

## Git / Push Status

Last known pushed commit for recent WhatsApp fixes:

- `a2063c4`

Remote:

- `https://github.com/LogicalMind-create/LogicalMind-Ops.git`

Branch:

- `main`

---

## Short Summary

This is a working internal ops dashboard with real Phase 1, 2, and 3 functionality.

The main remaining bug-fix surface is not the general app architecture - it is the fragile operational edge around:

- broadcast approval flow
- Supabase broadcast schema consistency
- WhatsApp Web automation selectors
- local helper/session/config reliability

If another AI needs to continue work, the fastest payoff is to focus on the broadcast pipeline and helper runtime, not the rest of the dashboard first.
