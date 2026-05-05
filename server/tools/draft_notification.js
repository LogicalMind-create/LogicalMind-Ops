'use strict';
const supabase = require('../lib/supabase');

module.exports = {
  declaration: {
    name: 'draft_notification',
    description: 'Draft a push notification to be sent to APPX students. The notification goes into an approval queue and must be approved in the dashboard before sending.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'Title of the push notification (max 60 chars).'
        },
        body: {
          type: 'STRING',
          description: 'Main content/body of the notification.'
        },
        target_type: {
          type: 'STRING',
          description: 'Who to send to. For now, always use "all_users".',
          enum: ['all_users']
        },
        category: {
          type: 'STRING',
          description: 'Category of the notification.',
          enum: ['marketing', 'reminder', 'reengagement', 'announcement']
        },
        scheduled_for: {
          type: 'STRING',
          description: 'Optional ISO-8601 date-time string if this should be sent in the future. Leave empty for immediate send upon approval.'
        }
      },
      required: ['title', 'body', 'target_type', 'category']
    }
  },
  async execute({ title, body, target_type = 'all_users', category = 'marketing', scheduled_for }) {
    try {
      const { data, error } = await supabase.from('app_notifications').insert([{
        title,
        body,
        target_type,
        category,
        scheduled_for: scheduled_for || null,
        status: 'pending_approval',
        created_by: 'agent'
      }]).select().single();

      if (error) throw error;
      return { success: true, message: `Notification drafted successfully and is waiting for approval. Draft ID: ${data.id}` };
    } catch (err) {
      console.error('[draft_notification] Error:', err.message);
      return { success: false, error: err.message };
    }
  }
};
