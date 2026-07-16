// Minimal ClickUp API helper (v2). Uses global fetch/FormData/Blob (Node 18+).

const API = 'https://api.clickup.com/api/v2';

function token() {
  const t = process.env.CLICKUP_API_TOKEN;
  if (!t) throw new Error('CLICKUP_API_TOKEN is not set');
  return t;
}

// Create a task. Defaults to the Product Submissions list (CLICKUP_LIST_ID),
// but pass listId to post elsewhere (e.g. the Brands list). Optional
// customFields = [{ id, value }] sets ClickUp custom fields on creation.
// Returns { id, url }.
async function createTask({ name, markdown, status, listId, customFields }) {
  const list = listId || process.env.CLICKUP_LIST_ID;
  if (!list) throw new Error('ClickUp list id is not set');

  const body = {
    name,
    markdown_content: markdown,   // renders markdown in the task body
    status: status || 'Submitted'
  };
  if (Array.isArray(customFields) && customFields.length) {
    body.custom_fields = customFields.filter(f => f && f.id && f.value != null && f.value !== '');
  }

  const res = await fetch(`${API}/list/${list}/task`, {
    method: 'POST',
    headers: { Authorization: token(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error('ClickUp createTask failed: ' + (data.err || res.status));
  return { id: data.id, url: data.url };
}

// Attach one photo (from a data URL) to a task.
async function attachPhoto(taskId, photo) {
  const m = /^data:(.+?);base64,(.*)$/.exec(photo.dataUrl || '');
  if (!m) return;
  const buffer = Buffer.from(m[2], 'base64');
  const blob = new Blob([buffer], { type: m[1] });

  const fd = new FormData();
  fd.append('attachment', blob, photo.name || 'photo.jpg');

  const res = await fetch(`${API}/task/${taskId}/attachment`, {
    method: 'POST',
    headers: { Authorization: token() },  // do NOT set Content-Type — FormData sets it
    body: fd
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('ClickUp attachment failed: ' + t);
  }
}

// Attach a set of photos. Optional prefix is prepended to filenames so you can
// tell product shots from lifestyle/UGC shots in the ClickUp task.
async function attachPhotos(taskId, photos, prefix) {
  for (const p of (photos || [])) {
    const photo = prefix ? { ...p, name: prefix + (p.name || 'photo.jpg') } : p;
    try { await attachPhoto(taskId, photo); } catch (e) { /* keep going if one fails */ }
  }
}

module.exports = { createTask, attachPhotos };
