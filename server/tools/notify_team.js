'use strict';
const telegram = require('../lib/telegram');

const declaration = {
  name: 'notify_team',
  description: 'Send a message to the team Telegram group. Use for urgent alerts, FYIs, or updates.',
  parameters: {
    type: 'OBJECT',
    properties: {
      message: {
        type: 'STRING',
        description: 'The message to send to the team.',
      },
    },
    required: ['message'],
  },
};

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function execute({ message }) {
  // Send to Telegram
  await telegram.notify(`📢 <b>Agent Alert</b>\n${message}`);

  // Send to Channel Rings via broadcast queue
  try {
    await supabase.from('broadcasts').insert([{
      message: `📲 [From Agent]\n${message}`,
      group_filter: 'channel_rings',
      status: 'approved',
      created_at: new Date().toISOString(),
    }]);
  } catch (err) {
    console.error('[notify_team] Failed to enqueue Channel Rings broadcast:', err.message);
  }

  return { success: true, message: 'Message sent to team Telegram and Channel Rings WhatsApp group.' };
}

module.exports = { declaration, execute };
