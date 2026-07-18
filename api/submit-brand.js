// POST /api/submit-brand
// Brand onboarding: creates a task in the ClickUp BRANDS list with the full
// brand profile (in the task body) + maps the key fields to ClickUp custom
// fields, and attaches the logo.

const { createTask, attachPhotos } = require('../lib/clickup');

// Brands list + its custom-field IDs (from the ClickUp Brands list).
const BRANDS_LIST_ID = '901615887011';
const FIELD = {
  contactDetails: '538d9163-2b0b-4f3c-9009-747299495b03',
  location:       'c84471df-af5f-4c01-b151-396d3f82957d',
  production:     '367c3ed8-779b-43f3-a382-60464be2c177',
  storePlatform:  'dd97df18-55bf-4e9d-a666-ac437cc53fb8',
  madeReady:      '239595c8-22ea-49e8-bcc9-d91f68763209'
};
const MADE_READY_OPTION = {
  'Made to Order': '349bb0be-728d-441f-95ed-58733f4f1352',
  'Ready Made':    'df532abc-1959-4b58-9394-2f06daf7b23f',
  'Both':          'ee932fb4-6d93-42c6-90dd-d06eea9cec1f'
};

function row(label, val) { return val ? `**${label}:** ${val}\n\n` : ''; }

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const f = body.fields || {};
    const logo = body.logo || [];

    if (!f.brandName || !f.contactEmail) {
      res.status(400).send('Missing required fields (brand name and contact email).'); return;
    }

    const md =
      `# ${f.brandName}\n\n` +
      row('Legal / trading name', f.legalName) +
      row('Business structure', f.businessStructure) +
      row('Contact name', f.contactName) +
      row('Contact email', f.contactEmail) +
      row('Phone', f.phone) +
      row('Location', f.location) +
      row('Website', f.website) +
      row('Instagram / socials', f.socials) +
      `\n## Brand\n\n` +
      row('Tagline / bio', f.bio) +
      row('Production method & materials', f.production) +
      row('Made to order / ready made', f.madeReady) +
      row('Currently sells on', f.storePlatform) +
      `\n## ZIGGY Certified — how they meet the five criteria\n\n` +
      row('Their answer', f.ziggyCriteria) +
      `\n---\n_Submitted via the ZIGGY brand onboarding form._`;

    const customFields = [
      { id: FIELD.contactDetails, value: [f.contactName, f.contactEmail, f.phone].filter(Boolean).join(' · ') },
      { id: FIELD.location, value: f.location },
      { id: FIELD.production, value: f.production },
      { id: FIELD.storePlatform, value: f.storePlatform || f.website },
    ];
    if (f.madeReady && MADE_READY_OPTION[f.madeReady]) {
      customFields.push({ id: FIELD.madeReady, value: MADE_READY_OPTION[f.madeReady] });
    }

    const task = await createTask({
      name: f.brandName,
      markdown: md,
      status: 'to do',
      listId: BRANDS_LIST_ID,
      customFields,
      assignees: [222060393]   // Anna — assigning emails her when a brand onboards
    });

    if (logo.length) {
      try { await attachPhotos(task.id, logo, 'LOGO-'); } catch (e) { /* non-fatal */ }
    }

    res.status(200).json({ ok: true, taskUrl: task.url });
  } catch (e) {
    res.status(500).send('Something went wrong: ' + e.message);
  }
};
