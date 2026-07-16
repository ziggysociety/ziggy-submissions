// Look up an onboarded brand's contact email from the ClickUp BRANDS list,
// matched by brand name. Used so product submissions don't have to re-ask the
// vendor's email — we reuse what they gave at onboarding.

const API = 'https://api.clickup.com/api/v2';
const BRANDS_LIST_ID = '901615887011';
const CONTACT_FIELD = '538d9163-2b0b-4f3c-9009-747299495b03'; // "Contact Details"

function token() {
  const t = process.env.CLICKUP_API_TOKEN;
  if (!t) throw new Error('CLICKUP_API_TOKEN is not set');
  return t;
}

function firstEmail(str) {
  const m = String(str || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0] : null;
}

// Returns the brand's email, or null if the brand hasn't onboarded yet.
async function getBrandEmail(brandName) {
  if (!brandName) return null;
  try {
    const res = await fetch(
      `${API}/list/${BRANDS_LIST_ID}/task?archived=false&include_closed=true&subtasks=false`,
      { headers: { Authorization: token() } }
    );
    const data = await res.json();
    const tasks = data.tasks || [];
    const want = String(brandName).trim().toLowerCase();
    const match = tasks.find(t => String(t.name || '').trim().toLowerCase() === want);
    if (!match) return null;

    // Prefer the "Contact Details" custom field, fall back to the task body.
    const cf = (match.custom_fields || []).find(f => f.id === CONTACT_FIELD);
    return firstEmail(cf && cf.value) || firstEmail(match.text_content) || firstEmail(match.description) || null;
  } catch (e) {
    return null;
  }
}

module.exports = { getBrandEmail };
