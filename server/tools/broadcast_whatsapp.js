'use strict';
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * Tool: broadcast_whatsapp
 * Queues a message (with optional image/PDF) for broadcast to WhatsApp groups.
 * The local helper picks it up and sends via WhatsApp Web.
 */
module.exports = {
  declaration: {
    name: 'broadcast_whatsapp',
    description:
      'Queue a message to be broadcast to all 43 WhatsApp student groups. ' +
      'The message goes into an approval queue — you must approve it in the dashboard before it sends. ' +
      'Optionally attach an image or PDF by providing a public media_url and media_type. ' +
      'Use this for TET updates, mock test announcements, holiday notices, study material PDFs, etc.',
    parameters: {
      type: 'OBJECT',
      properties: {
        message: {
          type: 'STRING',
          description: 'The message text to send to the WhatsApp groups (plain text, emojis allowed). Required even when sending media.',
        },
        group_filter: {
          type: 'STRING',
          description: 'Which groups to send to: all (default), tet, dsc, or general',
        },
        media_url: {
          type: 'STRING',
          description: 'Optional: A publicly accessible URL to an image (jpg/png) or PDF to attach to the message.',
        },
        media_type: {
          type: 'STRING',
          description: 'Optional: Type of media — "image" or "pdf". Required if media_url is provided.',
        },
      },
      required: ['message'],
    },
  },

  async execute({ message, group_filter = 'all', media_url, media_type }) {
    if (!message || message.trim().length < 3) {
      return { success: false, error: 'Message is too short.' };
    }

    // Validate media fields
    if (media_url && !media_type) {
      return { success: false, error: 'media_type is required when media_url is provided. Use "image" or "pdf".' };
    }
    if (media_type && !['image', 'pdf'].includes(media_type)) {
      return { success: false, error: 'media_type must be "image" or "pdf".' };
    }

    const insertData = {
      message: message.trim(),
      group_filter,
      status: 'draft',
      drafted_by: 'agent',
    };

    if (media_url) insertData.media_url = media_url;
    if (media_type) insertData.media_type = media_type;

    const { data, error } = await supabase
      .from('broadcasts')
      .insert([insertData])
      .select()
      .single();

    if (error) {
      console.error('[broadcast_whatsapp] DB error:', error.message);
      return { success: false, error: error.message };
    }

    const mediaNote = media_url ? ` (with ${media_type} attachment)` : '';
    return {
      success: true,
      broadcast_id: data.id,
      status: 'draft',
      message: `✅ Broadcast queued${mediaNote} for approval. Go to the Broadcasts page in the dashboard to review and approve it before it sends to your WhatsApp groups.`,
    };
  },
};
