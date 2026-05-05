'use strict';
const supabase = require('../lib/supabase');

module.exports = {
  declaration: {
    name: 'list_app_users',
    description: 'List all registered students in TeachX app. (Currently stubbed / returning empty until sync is enabled in Phase 4b).',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: []
    }
  },
  async execute() {
    return { success: true, message: 'Nightly sync is disabled. No users synced to DB yet.', users: [] };
  }
};
