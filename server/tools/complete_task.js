'use strict';
const supabase = require('../lib/supabase');

const declaration = {
  name: 'complete_task',
  description: 'Mark a task as done by its ID.',
  parameters: {
    type: 'OBJECT',
    properties: {
      task_id: {
        type: 'STRING',
        description: 'The UUID of the task to mark as done.',
      },
    },
    required: ['task_id'],
  },
};

async function execute({ task_id }) {
  const { data, error } = await supabase
    .from('tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', task_id)
    .select()
    .single();

  if (error) throw new Error(`DB error: ${error.message}`);
  return { success: true, message: `Task "${data.title}" marked as done.` };
}

module.exports = { declaration, execute };
