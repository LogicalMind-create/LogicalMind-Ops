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

async function execute({ message }) {
  await telegram.notify(`📢 <b>Agent Alert</b>\n${message}`);
  return { success: true, message: 'Message sent to team Telegram.' };
}

module.exports = { declaration, execute };
