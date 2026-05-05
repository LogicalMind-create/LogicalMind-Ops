'use strict';
const supabase = require('../lib/supabase');

module.exports = {
  declaration: {
    name: 'schedule_campaign',
    description: 'Schedule a recurring notification campaign using a cron rule.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: {
          type: 'STRING',
          description: 'Name of the campaign.'
        },
        category: {
          type: 'STRING',
          description: 'Category of the campaign.',
          enum: ['marketing', 'reminder', 'reengagement', 'announcement']
        },
        cron_rule: {
          type: 'STRING',
          description: 'Cron expression for the schedule (e.g. "0 9 * * 1" for every Monday at 9am).'
        },
        template_title: {
          type: 'STRING',
          description: 'Title template for the notification.'
        },
        template_body: {
          type: 'STRING',
          description: 'Body template for the notification.'
        },
        target_type: {
          type: 'STRING',
          description: 'Who to send to. For now, always use "all_users".',
          enum: ['all_users']
        }
      },
      required: ['name', 'category', 'cron_rule', 'template_title', 'template_body', 'target_type']
    }
  },
  async execute({ name, category, cron_rule, template_title, template_body, target_type = 'all_users' }) {
    try {
      const { data, error } = await supabase.from('notification_campaigns').insert([{
        name,
        category,
        cron_rule,
        template_title,
        template_body,
        target_type,
        is_active: true
      }]).select().single();

      if (error) throw error;
      return { success: true, message: `Campaign "${name}" scheduled successfully. ID: ${data.id}` };
    } catch (err) {
      console.error('[schedule_campaign] Error:', err.message);
      return { success: false, error: err.message };
    }
  }
};
