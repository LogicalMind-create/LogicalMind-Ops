'use strict';
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * Tool: broadcast_whatsapp
 * Queues a message for broadcast to WhatsApp groups.
 * The local helper picks it up and sends via WhatsApp Web.
 */
module.exports = {
  declaration: {
    name: 'broadcast_whatsapp',
    description:
      'Queue a message to be broadcast to all 43 WhatsApp student groups. ' +
      'The message goes into an approval queue — you must approve it in the dashboard before it sends. ' +
      'Use this for TET updates, mock test announcements, holiday notices, etc.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message text to send to the WhatsApp groups (plain text, emojis allowed)',
        },
        group_filter: {
          type: 'string',
          description: 'Which groups to send to: "all" (default) or a specific subset like "TET groups only"',
          enum: ['all', 'tet', 'dsc', 'general'],
        },
      },
      required: ['message'],
    },
  },

  async execute({ message, group_filter = 'all' }) {
    if (!message || message.trim().length < 3) {
      return { success: false, error: 'Message is too short.' };
    }

    const { data, error } = await supabase
      .from('broadcasts')
      .insert([{
        message: message.trim(),
        group_filter,
        status: 'draft',
        drafted_by: 'agent',
      }])
      .select()
      .single();

    if (error) {
      console.error('[broadcast_whatsapp] DB error:', error.message);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      broadcast_id: data.id,
      status: 'draft',
      message: `✅ Broadcast queued for approval. Go to the Broadcasts page in the dashboard to review and approve it before it sends to your WhatsApp groups.`,
    };
  },
};
