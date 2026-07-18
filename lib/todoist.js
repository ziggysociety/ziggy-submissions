// Minimal Todoist helper (REST API v2). Creates a task in your Todoist.
// Needs TODOIST_API_TOKEN (Todoist → Settings → Integrations → Developer → API token).
// Optional TODOIST_PROJECT_ID to drop tasks into a specific project/board;
// without it, tasks land in your Inbox.

async function createTodoistTask({ content, description }) {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) return { skipped: 'TODOIST_API_TOKEN not set' };

  const body = { content };
  if (description) body.description = description;
  const projectId = process.env.TODOIST_PROJECT_ID;
  if (projectId) body.project_id = projectId;

  const res = await fetch('https://api.todoist.com/rest/v2/tasks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Todoist create failed: ' + (await res.text()));
  return await res.json();
}

module.exports = { createTodoistTask };
