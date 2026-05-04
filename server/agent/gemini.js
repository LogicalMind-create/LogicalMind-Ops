'use strict';
require('dotenv').config();
const Groq = require('groq-sdk');
const supabase = require('../lib/supabase');

// ─── Tool registry ───────────────────────────────────────────────────────────
const toolModules = {
  assign_task:        require('../tools/assign_task'),
  list_tasks:         require('../tools/list_tasks'),
  complete_task:      require('../tools/complete_task'),
  notify_team:        require('../tools/notify_team'),
  list_orders:        require('../tools/list_orders'),
  create_shipment:    require('../tools/create_shipment'),
  track_shipment:     require('../tools/track_shipment'),
  broadcast_whatsapp: require('../tools/broadcast_whatsapp'),
};

// ─── Convert Gemini-style declarations → OpenAI/Groq format ─────────────────
function convertSchema(schema) {
  if (!schema) return {};
  const out = {};
  if (schema.type)        out.type        = schema.type.toLowerCase();
  if (schema.description) out.description = schema.description;
  if (schema.enum)        out.enum        = schema.enum;
  if (schema.items)       out.items       = convertSchema(schema.items);
  if (schema.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties))
      out.properties[k] = convertSchema(v);
  }
  if (schema.required)    out.required    = schema.required;
  return out;
}

const tools = Object.values(toolModules).map(m => ({
  type: 'function',
  function: {
    name:        m.declaration.name,
    description: m.declaration.description,
    parameters:  convertSchema(m.declaration.parameters),
  },
}));

// ─── System prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the LogicalMind Ops agent — the internal AI assistant for Logical Mind Education.

You help a 2-person team manage:
- A YouTube channel (~50K subs)
- An Android course app for Telangana DSA/TET aspirants
- A printed-materials shop on Amazon SmartBiz (shipped via Shiprocket)
- 43 WhatsApp groups for student community management

Today's date: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

RULES:
1. Always use the provided tools to act on data — never make up order IDs, task IDs, or numbers.
2. When you call a tool and get results, summarize them clearly in plain English.
3. For ambiguous requests, ask one clarifying question rather than guessing.
4. Currency is always in Indian Rupees (₹).
5. Keep responses concise — the team is busy. No unnecessary padding.
6. When assigning tasks to "me", treat it as the currently logged-in user.

Current capabilities:
- assign_task, list_tasks, complete_task — manage your team's task board
- notify_team — send a message to the Telegram group
- list_orders — list SmartBiz/Shiprocket orders; flag delayed ones
- create_shipment, track_shipment — create and track Shiprocket shipments
- broadcast_whatsapp — queue a message (with optional image or PDF) to broadcast to 43 WhatsApp groups (requires dashboard approval before sending). You can attach media_url and media_type ('image' or 'pdf') for rich broadcasts.`;

// ─── Groq client ─────────────────────────────────────────────────────────────
let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set in environment');
    _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _client;
}

// ─── Save message to DB ──────────────────────────────────────────────────────
async function saveMessage(role, content, runId) {
  try {
    await supabase.from('chat_messages').insert([{ role, content, run_id: runId }]);
  } catch (e) {
    console.error('[Agent] Failed to save message:', e.message);
  }
}

// ─── Main agent function ─────────────────────────────────────────────────────
async function runAgent(userMessage, history = [], runId = null) {
  const client = getClient();
  const toolsUsed = [];

  await saveMessage('user', userMessage, runId);

  // Build messages: system + history + new user message
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userMessage },
  ];

  // Agentic loop — keep calling tools until model stops
  while (true) {
    const response = await client.chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens:  2048,
      temperature: 0.3,
    });

    const msg = response.choices[0].message;
    messages.push(msg);

    // No tool calls → final answer
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const reply = msg.content || '';
      await saveMessage('assistant', reply, runId);
      // Return history without system prompt (caller stores it)
      return { reply, history: messages.slice(1), toolsUsed };
    }

    // Execute tool calls in parallel
    const toolResults = await Promise.all(
      msg.tool_calls.map(async (tc) => {
        const toolName = tc.function.name;
        let args = {};
        try { args = JSON.parse(tc.function.arguments); } catch (_) {}
        toolsUsed.push(toolName);

        console.log(`[Agent] Calling tool: ${toolName}`, args);

        let result;
        try {
          const mod = toolModules[toolName];
          if (!mod) throw new Error(`Unknown tool: ${toolName}`);
          result = await mod.execute(args);
        } catch (err) {
          console.error(`[Agent] Tool ${toolName} failed:`, err.message);
          result = { error: err.message };
        }

        return {
          role:         'tool',
          tool_call_id: tc.id,
          content:      JSON.stringify(result),
        };
      })
    );

    messages.push(...toolResults);
  }
}

module.exports = { runAgent };
