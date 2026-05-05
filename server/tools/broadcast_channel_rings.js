'use strict';
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * Tool: broadcast_channel_rings
 * Sends a message immediately to the Channel Rings WhatsApp group.
 * This is for urgent Telegram-to-WhatsApp alerts and does not require dashboard approval.
 */
module.exports = {
  declaration: {
    name: 'broadcast_channel_rings',
    description:
      'Send an urgent message directly to the Channel Rings WhatsApp group. ' +
      'This bypasses the general broadcast approval queue and is intended for immediate alerts from Telegram or internal agent notifications.',
    parameters: {
      type: 'OBJECT',
      properties: {
        message: {
          type: 'STRING',
          description: 'The text message to send directly to the Channel Rings WhatsApp group.',
        },
        media_url: {
          type: 'STRING',
          description: 'Optional: public URL to an image or PDF to attach to the Channel Rings message.',
        },
        media_type: {
          type: 'STRING',
          description: 'Optional: type of media — "image" or "pdf". Required when media_url is provided.',
        },
      },
      required: ['message'],
    },
  },

  async execute({ message, media_url, media_type }) {
    if (!message || message.trim().length < 3) {
      return { success: false, error: 'Message must be at least 3 characters long.' };
    }

    if (media_url && !media_type) {
      return { success: false, error: 'media_type is required when media_url is provided. Use "image" or "pdf".' };
    }
    if (media_type && !['image', 'pdf'].includes(media_type)) {
      return { success: false, error: 'media_type must be "image" or "pdf".' };
    }

    const insertData = {
      message: message.trim(),
      group_filter: 'channel_rings',
      status: 'approved',
      created_at: new Date().toISOString(),
    };
    if (media_url) insertData.media_url = media_url;
    if (media_type) insertData.media_type = media_type;

    const { data, error } = await supabase
      .from('broadcasts')
      .insert([insertData])
      .select()
      .single();

    if (error) {
      console.error('[broadcast_channel_rings] DB error:', error.message);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      broadcast_id: data.id,
      status: 'approved',
      message: '✅ Channel Rings alert queued and approved for immediate send.',
    };
  },
};
