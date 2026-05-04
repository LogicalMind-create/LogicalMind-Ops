# LogicalMind Ops — Bug Fix Handover for Anti-Gravity

**Date:** 2026-05-04  
**Status:** Critical bugs identified, ready for implementation  
**Priority:** Phase 1–3 rock-solid (orders, AI agent, WhatsApp broadcasts)

---

## Summary of Findings

Initial audit claimed the AI agent "loses system prompt context every turn" — **this was WRONG**. The system prompt is correctly re-prepended every turn at `server/agent/gemini.js:98`. However, the codebase has several **real critical bugs** that block core functionality:

1. **Orders cannot ship** — hardcoded fake address/email/phone in create_shipment
2. **Schema is split across two files** — new installs incomplete
3. **No customer address fields** — even if fake data is fixed, there's nothing to read
4. **SmartBiz scraper doesn't extract addresses** — root cause of #2 and #3
5. **Auth is bypassed in dev** — anyone with URL has full access
6. **Agent loop has no max iterations** — can hang if model hallucinates tool calls
7. **Rate limit too low** — 12/min is unnecessarily restrictive

---

## Bugs to Fix (Priority Order)

### CRITICAL — Orders Cannot Ship

#### 1.1 server/tools/create_shipment.js:67–74 — Replace fake data with real customer info

**Current (broken):**
```javascript
const payload = {
  ...
  billing_address: "Address Pending Scraper",
  billing_city: "Hyderabad",
  billing_pincode: "500001",
  billing_email: "test@example.com",
  billing_phone: "9999999999",
  ...
};
```

**Fix:** Replace with values read from the `orders` row. Add these to the payload:
```javascript
const payload = {
  ...
  billing_address: order.address_line1 || '',
  billing_address_2: order.address_line2 || '',
  billing_city: order.city || '',
  billing_pincode: order.pincode || '',
  billing_state: order.state || '',
  billing_email: order.customer_email || '',
  billing_phone: order.customer_phone || '',
  ...
};
```

**Validation:** If any required field is null/empty, return a structured error:
```javascript
const required = ['address_line1', 'city', 'pincode', 'customer_name', 'customer_email', 'customer_phone'];
const missing = required.filter(f => !order[f]);
if (missing.length > 0) {
  return { error: 'MISSING_CUSTOMER_DATA', fields: missing, message: `Cannot ship: missing ${missing.join(', ')}` };
}
```

---

#### 1.2 supabase_schema.sql — Add customer address columns to `orders` table

**Current:** `orders` table (lines 48–64) has no address fields.

**Add these columns** (before the closing `;` at line 64):
```sql
  customer_phone    text,
  customer_email    text,
  address_line1     text,
  address_line2     text,
  city              text,
  state             text,
  pincode           text,
```

**Also add an index** (after line 64):
```sql
create index if not exists orders_external_id_idx on orders(external_id);
create index if not exists orders_awb_idx on orders(awb);
```

---

#### 1.3 scripts/smartbiz-scraper.js — Extract customer address from order detail page

**Current:** Scraper only pulls what's on the listing page (product name, amount, order date). Does NOT pull customer address.

**To fix:**
1. After finding an order row in the table (line 170–177), navigate INTO that order's detail page
2. Extract these fields from the detail page:
   - `customer_name` — buyer name
   - `customer_phone` — buyer phone
   - `customer_email` — buyer email
   - `address_line1` — street address
   - `address_line2` — apartment/suite (if present)
   - `city`
   - `state`
   - `pincode`

3. Persist these to the `orders` upsert payload (line 280–287)

**Example structure:**
```javascript
const addressData = {
  customer_name: extractedFromPage.buyerName,
  customer_phone: extractedFromPage.phone,
  customer_email: extractedFromPage.email,
  address_line1: extractedFromPage.street,
  address_line2: extractedFromPage.apt || '',
  city: extractedFromPage.city,
  state: extractedFromPage.state,
  pincode: extractedFromPage.zip,
};

// Then include in upsert:
const orderRow = {
  external_id: ...existing...,
  customer_name: addressData.customer_name,
  customer_phone: addressData.customer_phone,
  customer_email: addressData.customer_email,
  address_line1: addressData.address_line1,
  ...etc
};
```

---

### HIGH — Schema and Auth Issues

#### 2.1 supabase_schema.sql + supabase_broadcasts.sql — Consolidate into single file

**Current:** Two separate files. New installs may apply only one, resulting in incomplete schema.

**Fix:**
1. Copy all content from `supabase_broadcasts.sql` into `supabase_schema.sql` (append before the closing comments/EOF)
2. In the consolidated file, ensure:
   - All `CREATE TABLE IF NOT EXISTS` use the broadcasts schema from `supabase_broadcasts.sql:2–15` (not the commented-out version)
   - All ALTER TABLE statements are present
   - Add migration note: "Run this entire file once; it's idempotent (IF NOT EXISTS)"
3. Delete or archive `supabase_broadcasts.sql` (no longer needed)

**Result:** Single source of truth. Fresh installs run one file and get everything.

---

#### 2.2 server/index.js:30 — Fix auth bypass in development

**Current:**
```javascript
function authMiddleware(req, res, next) {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return next();
  if (process.env.NODE_ENV !== 'production') return next();  // <-- bypasses ALL auth in dev
  ...
}
```

**Problem:** Entire dashboard is unprotected in dev mode. Anyone with the URL has full access.

**Fix:** Change to:
```javascript
function authMiddleware(req, res, next) {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) {
    console.warn('[⚠️  Auth] DASHBOARD_SECRET not set. Dashboard is unprotected.');
    return next();
  }
  // Apply auth check in ALL environments
  const provided = req.headers['x-dashboard-secret'];
  if (provided === secret) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}
```

---

#### 2.3 server/index.js:17–24 — Raise rate limit and fix comment

**Current:**
```javascript
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,  // <-- too low for Groq
  message: { error: 'Too many requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});
```

**Comment at line 17:** "Gemini free tier: 15 req/min" is wrong (it's Groq, and it supports much more).

**Fix:**
```javascript
// Groq llama-3.3-70b: 30 requests/minute limit (https://console.groq.com/docs/rate-limits)
// We use 60/min to leave headroom and allow multi-turn agent loops
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,  // <-- raised from 12
  message: { error: 'Too many requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});
```

---

### MEDIUM — Agent Loop Safety

#### 3.1 server/agent/gemini.js:104 — Add max-iteration guard

**Current:**
```javascript
while (true) {
  const response = await client.chat.completions.create({...});
  ...
  if (!msg.tool_calls || msg.tool_calls.length === 0) {
    // final answer, break
    return { reply, history: messages.slice(1), toolsUsed };
  }
  // execute tools and loop
}
```

**Problem:** If the model halluccinates an infinite tool-call loop, the agent never returns. Hangs and burns tokens.

**Fix:** Add iteration counter:
```javascript
const MAX_ITERATIONS = 20;
let iterations = 0;

while (true) {
  iterations++;
  if (iterations > MAX_ITERATIONS) {
    console.warn(`[Agent] Hit max iterations (${MAX_ITERATIONS}). Returning partial response.`);
    const reply = 'Agent encountered a loop while processing. Please try a simpler request.';
    return { reply, history: messages.slice(1), toolsUsed, warning: 'max_iterations_reached' };
  }

  const response = await client.chat.completions.create({...});
  ...
}
```

---

### LOW — Error Message Clarity

#### 4.1 server/routes/chat.js:45 — Fix misleading error message

**Current:**
```javascript
if (err.message?.includes('API_KEY')) {
  return res.status(503).json({ error: 'AI service not configured. Check GEMINI_API_KEY.' });
}
```

**Problem:** Says GEMINI_API_KEY but this app uses Groq (GROQ_API_KEY).

**Fix:**
```javascript
if (err.message?.includes('API_KEY')) {
  return res.status(503).json({ error: 'AI service not configured. Check GROQ_API_KEY.' });
}
```

---

#### 4.2 server/routes/broadcasts.js:67–73 — Fix potential 500 on progress update

**Current:**
```javascript
router.post('/:id/progress', async (req, res) => {
  const { groups_sent, groups_total, status } = req.body;
  const update = {};
  if (groups_sent  !== undefined) update.groups_sent  = groups_sent;
  if (groups_total !== undefined) update.groups_total = groups_total;
  if (status) {
    update.status = status;
    if (status === 'sent') update.sent_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from('broadcasts').update(update)
    .eq('id', req.params.id).select().single();  // <-- .single() will 500 if row doesn't exist
  ...
});
```

**Fix:** Change `.single()` to `.maybeSingle()` at line 70:
```javascript
const { data, error } = await supabase
  .from('broadcasts').update(update)
  .eq('id', req.params.id).select().maybeSingle();  // returns null if not found, not error
```

Then handle the null case:
```javascript
if (error) return res.status(500).json({ error: error.message });
if (!data) return res.status(404).json({ error: 'Broadcast not found' });
res.json(data);
```

---

## Verification Steps

After each fix, verify:

### Test 1: Order Shipping
1. Add a test product to `products` table with valid SKU and dimensions
2. Manually insert one test order into `orders` table with all customer address fields filled
3. Call `POST /api/chat` with message: "Ship order [order_id]"
4. Confirm Shiprocket creates the order (no 400 validation error)
5. Confirm `orders` row updates with `status='shipped'` and an `awb` code

### Test 2: Schema Integrity
1. Drop all Supabase tables
2. Run the consolidated `supabase_schema.sql` once
3. Verify all tables exist: `tasks`, `chat_messages`, `agent_runs`, `orders`, `products`, `broadcasts`
4. Verify `broadcasts` has columns: `media_url`, `media_type`, `groups_sent`, `groups_total`
5. Verify `orders` has columns: `customer_name`, `customer_phone`, `customer_email`, `address_line*`, `city`, `state`, `pincode`

### Test 3: Agent Loop Safety
1. Send a chat message that would cause the agent to call tools in a loop (e.g., "list tasks and mark each done")
2. Confirm agent completes within 20 iterations, doesn't hang forever

### Test 4: SmartBiz Scraper Address Extraction
1. Run `node scripts/smartbiz-scraper.js`
2. Verify one order upserts with non-empty `customer_phone`, `customer_email`, `address_line1`, `city`, `pincode`
3. Check Supabase `orders` table for these fields populated

---

## Files to Modify (Summary)

| File | Lines | Change |
|------|-------|--------|
| `server/tools/create_shipment.js` | 67–74 | Replace hardcoded fake data |
| `server/tools/create_shipment.js` | Before line 99 | Add customer data validation |
| `supabase_schema.sql` | After line 64 | Add customer address columns + indices |
| `supabase_broadcasts.sql` | Content | Move into supabase_schema.sql (then delete this file) |
| `scripts/smartbiz-scraper.js` | 170–287 | Add order detail navigation + address extraction |
| `server/index.js` | 17–24 | Raise rate limit to 60/min, fix comment |
| `server/index.js` | 30 | Remove dev mode auth bypass |
| `server/agent/gemini.js` | 104–154 | Add MAX_ITERATIONS guard |
| `server/routes/chat.js` | 45 | Change GEMINI_API_KEY → GROQ_API_KEY |
| `server/routes/broadcasts.js` | 70 | Change .single() → .maybeSingle() |

---

## Post-Implementation

Once these fixes are in:
1. Run all verification tests above
2. Boot server locally: `npm run dev`
3. Send a multi-turn chat conversation; agent should maintain context
4. Attempt a full order-to-shipment cycle (create order → list → ship → track)
5. Attempt a WhatsApp broadcast approval and send

---

## Notes for Anti-Gravity

- The AI agent context-loss claim was a false lead — the agent is correctly designed
- The rate limit is a major pain point for agentic loops with 3+ tool calls
- SmartBiz scraper order-detail navigation is Playwright-based; if Amazon SmartBiz UI changes, selectors may break (out of scope for this round, but flagging for future maintenance)
- Supabase customer address field names should match what the scraper extracts

---

**Ready for handoff to Anti-Gravity.**
