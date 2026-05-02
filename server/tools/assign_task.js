'use strict';
const supabase = require('../lib/supabase');
const telegram = require('../lib/telegram');

// ─── Tool definition (sent to Gemini as function declaration) ───────────────
const declaration = {
  name: 'assign_task',
  description: 'Assign a task to a team member. Use this when the user says "add a task", "remind me to", "assign to teammate", etc.',
  parameters: {
    type: 'OBJECT',
    properties: {
      person: {
        type: 'STRING',
        description: 'Who the task is for. Use "me" or the person\'s name (e.g. "Ravi").',
      },
      title: {
        type: 'STRING',
        description: 'Short title / description of the task.',
      },
      due_date: {
        type: 'STRING',
        description: 'Due date in YYYY-MM-DD format. Use today\'s date if not specified.',
      },
      notes: {
        type: 'STRING',
        description: 'Optional additional notes.',
      },
    },
    required: ['person', 'title', 'due_date'],
  },
};

// ─── Tool executor ───────────────────────────────────────────────────────────
async function execute({ person, title, due_date, notes = '' }) {
  const { data, error } = await supabase
    .from('tasks')
    .insert([{ person, title, due_date, notes, status: 'pending' }])
    .select()
    .single();

  if (error) throw new Error(`DB error: ${error.message}`);

  // Telegram alert
  await telegram.alert(
    '📌',
    'New Task Assigned',
    `<b>${title}</b>\nAssigned to: ${person}\nDue: ${due_date}${notes ? `\nNotes: ${notes}` : ''}`
  );

  return {
    success: true,
    task_id: data.id,
    message: `Task "${title}" assigned to ${person}, due ${due_date}.`,
  };
}

module.exports = { declaration, execute };
