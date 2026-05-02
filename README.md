# LogicalMind Ops

AI-agent operations dashboard for Logical Mind Education. Talks to you in plain English and actually does the work.

## Quick start (local dev)

```bash
# 1. Copy env template and fill in your keys
copy .env.example .env
# (edit .env with your real keys — see .env.example)

# 2. Install dependencies
npm install

# 3. Start server
npm run dev

# 4. Open http://localhost:3000
```

## What works now (Phase 1 + 2)

### Phase 1 — Agent & Tasks
- ✅ AI Agent chat powered by **Gemini 2.5 Flash**
- ✅ `assign_task` — "Add a task for me to call printer tomorrow"
- ✅ `list_tasks`  — "What are my pending tasks?"
- ✅ `complete_task` — "Mark the printer task as done"
- ✅ `notify_team` — "Send team alert: TET mock test tonight 8pm"
- ✅ Task board UI with quick-add form
- ✅ Telegram team alerts on task creation

### Phase 2 — Orders & Shipping
- ✅ `list_orders` — "List all pending orders. Are any delayed?" (flags orders ≥2 days old)
- ✅ `create_shipment` — "Ship order ABC123" → books Shiprocket, stores AWB
- ✅ `track_shipment` — "Track AWB 123456789IN"
- ✅ Orders dashboard with filter by status, Ship & Track buttons
- ✅ Home dashboard shows today's orders + delayed count
- ✅ Shiprocket webhook auto-updates order status + Telegram alert on delivery
- ✅ GitHub Actions scraper polls SmartBiz every 10 min

## Required environment variables

| Variable | Where to get it |
|---|---|
| `SUPABASE_URL` | Supabase project → Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase project → Settings → API → service_role key |
| `GEMINI_API_KEY` | https://ai.google.dev |
| `TELEGRAM_BOT_TOKEN` | @BotFather on Telegram |
| `TELEGRAM_CHAT_ID` | Your Telegram group/chat ID |
| `SHIPROCKET_EMAIL` | Your Shiprocket login email |
| `SHIPROCKET_PASSWORD` | Your Shiprocket login password |
| `SMARTBIZ_EMAIL` | Your Amazon SmartBiz login email |
| `SMARTBIZ_PASSWORD` | Your Amazon SmartBiz login password |
| `DASHBOARD_SECRET` | Any random strong string (shared with your teammate) |

## GitHub Secrets (for the scraper to run in Actions)

Add these in your repo → Settings → Secrets → Actions:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SMARTBIZ_EMAIL`
- `SMARTBIZ_PASSWORD`

## Supabase setup

1. Run `supabase_schema.sql` in your Supabase SQL editor (new project, not the PDF store)
2. After running, manually add your book SKUs to the `products` table:

```sql
INSERT INTO products (sku, name, weight_g, length_cm, breadth_cm, height_cm)
VALUES ('SKU001', 'TET Book Vol 1', 300, 28, 21, 1.5);
-- Add more rows for each book
```

## Deploy to Render

1. Push to GitHub repo `LogicalMind-Ops`
2. New Web Service → connect repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add all env vars from the table above
6. Set UptimeRobot to ping `https://logicalmind-ops.onrender.com/health` every 5 min

## Shiprocket webhook

In Shiprocket dashboard → Settings → Webhooks, add:
```
https://logicalmind-ops.onrender.com/webhooks/shiprocket
```
Events to enable: Shipment Delivered, Shipment Cancelled, Out for Delivery

## Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Agent + tasks + Telegram | ✅ Live |
| 2 | Amazon SmartBiz → Shiprocket orders | ✅ Live |
| 3 | WhatsApp 43-group fan-out | 🔜 Next |
| 4 | Finance & monthly cycle | 🔜 |
| 5 | App notifications + marketing | 🔜 |
