'use strict';
const supabase = require('../lib/supabase');

const declaration = {
  name: 'list_tasks',
  description: 'List tasks from the team task board. Filter by person and/or status.',
  parameters: {
    type: 'OBJECT',
    properties: {
      person: {
        type: 'STRING',
        description: 'Filter by person name. Omit to show all people.',
      },
      status: {
        type: 'STRING',
        enum: ['pending', 'done', 'all'],
        description: 'Filter by status. Default is "pending".',
      },
    },
    required: [],
  },
};

async function execute({ person, status = 'pending' }) {
  let query = supabase
    .from('tasks')
    .select('id, person, title, due_date, status, notes, created_at')
    .order('due_date', { ascending: true });

  if (person) query = query.ilike('person', `%${person}%`);
  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query.limit(50);
  if (error) throw new Error(`DB error: ${error.message}`);

  if (!data || data.length === 0) {
    return { tasks: [], message: 'No tasks found matching the criteria.' };
  }

  const formatted = data.map((t) => ({
    id: t.id,
    person: t.person,
    title: t.title,
    due: t.due_date,
    status: t.status,
    notes: t.notes || '',
  }));

  return {
    tasks: formatted,
    message: `Found ${data.length} task(s).`,
  };
}

module.exports = { declaration, execute };
