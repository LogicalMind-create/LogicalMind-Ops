'use strict';
const supabase = require('../lib/supabase');

module.exports = {
  declaration: {
    name: 'list_courses',
    description: 'List all available courses from TeachX app. (Currently stubbed / returning empty until sync is enabled in Phase 4b).',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: []
    }
  },
  async execute() {
    return { success: true, message: 'Nightly sync is disabled. No courses synced to DB yet.', courses: [] };
  }
};
