'use strict';
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
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

const functionDeclarations = Object.values(toolModules).map((m) => m.declaration);

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
6. When assigning tasks to "me", treat it as the currently logged-in user. When you don't know the person's name, use "me" as the person field.

Current capabilities (Phase 1, 2 & 3):
- assign_task: Add a task for yourself or your teammate
- list_tasks: View pending/completed tasks
- complete_task: Mark a task done
- notify_team: Send a message to the Telegram group
- list_orders: List your Amazon SmartBiz orders. Pay attention to the agent_note which indicates delayed orders.
- create_shipment: Creates a Shiprocket shipment for a given order ID.
- track_shipment: Gets current tracking info for an AWB.
- broadcast_whatsapp: Queue a message to broadcast to all 43 WhatsApp student groups. The message goes into an approval queue — the user must approve it in the Broadcasts page of the dashboard before it sends. IMPORTANT: always confirm the message text with the user before calling this tool.

Coming soon (not yet available): finance tracking, app notifications.

If the user asks for something you can't do yet, let them know it's on the roadmap and suggest what you CAN do instead.`;

// ─── Gemini setup ────────────────────────────────────────────────────────────
let genAI = null;
let model = null;

function getModel() {
  if (!model) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not set in environment');
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations }],
    });
  }
  return model;
}

// ─── Save message to DB ──────────────────────────────────────────────────────
async function saveMessage(role, content, run_id) {
  try {
    await supabase
      .from('chat_messages')
      .insert([{ role, content, run_id }]);
  } catch (e) {
    console.error('[Agent] Failed to save message:', e.message);
  }
}

// ─── Main agent function ─────────────────────────────────────────────────────
/**
 * Run the agent with a user message, maintaining conversation history.
 * @param {string} userMessage
 * @param {Array}  history   — Array of {role, parts} objects (Gemini format)
 * @param {string} runId     — Unique ID for this conversation run
 * @returns {{ reply: string, history: Array, toolsUsed: string[] }}
 */
async function runAgent(userMessage, history = [], runId = null) {
  const m = getModel();
  const chat = m.startChat({ history });
  const toolsUsed = [];

  await saveMessage('user', userMessage, runId);

  // Initial send
  let response = await chat.sendMessage(userMessage);
  let candidate = response.response;

  // Agentic loop — keep calling tools until the model stops
  while (true) {
    const fnCalls = candidate.functionCalls();
    if (!fnCalls || fnCalls.length === 0) break;

    // Execute all requested tool calls in parallel
    const fnResults = await Promise.all(
      fnCalls.map(async (fc) => {
        const toolName = fc.name;
        const args = fc.args;
        toolsUsed.push(toolName);

        console.log(`[Agent] Calling tool: ${toolName}`, args);

        let result;
        try {
          const toolModule = toolModules[toolName];
          if (!toolModule) throw new Error(`Unknown tool: ${toolName}`);
          result = await toolModule.execute(args);
        } catch (err) {
          console.error(`[Agent] Tool ${toolName} failed:`, err.message);
          result = { error: err.message };
        }

        return {
          functionResponse: {
            name: toolName,
            response: result,
          },
        };
      })
    );

    // Feed results back to model
    response = await chat.sendMessage(fnResults);
    candidate = response.response;
  }

  const reply = candidate.text();
  await saveMessage('assistant', reply, runId);

  // Return updated history for the caller to store in session
  const updatedHistory = await chat.getHistory();

  return { reply, history: updatedHistory, toolsUsed };
}

module.exports = { runAgent };
