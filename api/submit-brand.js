// POST /api/submit-brand
// Brand onboarding: creates a task in the ClickUp BRANDS list with the full
// brand profile (in the task body) + maps the key fields to ClickUp custom
// fields, and attaches the logo.

const { createTask, attachPhotos } = require('../lib/clickup');
const { sendEmail } = require('../lib/email');

// Brands list + its custom-field IDs (from the ClickUp Brands list).
const BRANDS_LIST_ID = '901615887011';
const ONBOARDING_LIST_ID = '901615748957';
const FIELD = {
  contactDetails: '538d9163-2b0b-4f3c-9009-747299495b03',
  location: 'c84471df-af5f-4c01-b151-396d3f82957d',
  production: '367c3ed8-779b-43f3-a382-60464be2c177',
  storePlatform: 'dd97df18-55bf-4e9d-a666-ac437cc53fb8',
  madeReady: '239595c8-22ea-49e8-bcc9-d91f68763209',
  storeUrl: '2f3834b3-d1dc-4765-a5c4-d8e52de2b1a7',
  shipsFrom: '034e4c2d-6e07-4303-836b-3f1f19479830',
  accountHolder: 'aa9d0c31-cb8d-4a02-9732-4354d75c77f4',
  bankCountry: '3d1e93d3-1bfc-4d5d-b4b9-3d00845184d7',
  nzAccount: 'f11683b5-ae02-4390-a53a-85ed2819b89c',
  auBsb: '5124ca28-a7b2-422d-94c7-087b406397f1',
  auAccount: 'd48ec1ad-fcd6-487b-858b-b364b9c3dd98',
  shippingArea: '6c9075e6-80c9-4393-bd6a-abda72544b4b'
};
const SHIPS_FROM_OPTION = {
  'New Zealand': '1140771b-7f50-4951-90ab-24c391c884a5',
  'Australia': 'af8c3f66-de70-4f02-bdca-faa5180d942b'
};
const BANK_COUNTRY_OPTION = {
  'New Zealand': 'a4c5d224-029d-4dcc-91fa-79b148fb1399',
  'Australia': 'f7b70017-4ac4-4a14-93c0-96a5530f739f'
};
const SHIPPING_AREA_OPTION = {
  'NZ + AU': '24cce3f6-946f-4c7c-a35c-aaac5439feae',
  'NZ only': '0b0b55b5-c929-4bee-99db-b40c705af791',
  'AU only': '501d4ea6-bb9b-47a5-ad0e-ce7118be5178'
};
const MADE_READY_OPTION = {
  'Made to Order': '349bb0be-728d-441f-95ed-58733f4f1352',
  'Ready Made': 'df532abc-1959-4b58-9394-2f06daf7b23f',
  'Both': 'ee932fb4-6d93-42c6-90dd-d06eea9cec1f'
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
      `\n## Shipping\n\n` +
      row('Ships from', f.shipFrom) +
    row('Shipping area', f.shippingArea) +
    row('Price parity agreed', (f.parity === 'Yes' || f.parity === true) ? 'Yes' : '') +
      `\n## Payout\n\n` +
      row('Account holder', f.accountHolder) +
      row('Bank country', f.bankCountry) +
      row('NZ account', f.nzAccount) +
      row('AU BSB', f.auBsb) +
      row('AU account', f.auAccount) +
      `\n## Brand\n\n` +
      row('Tagline / bio', f.bio) +
      row('Production method & materials', f.production) +
      row('Made to order / ready made', f.madeReady) +
      row('Typical turnaround time', f.turnaround) +
      row('Currently sells on', f.storePlatform) +
      row('Store URL', f.storeUrl) +
      `\n## ZIGGY Certified — how they meet the five criteria\n\n` +
      row('Their answer', f.ziggyCriteria) +
      `\n---\n_Submitted via the ZIGGY brand onboarding form._`;

    const customFields = [
      { id: FIELD.contactDetails, value: [f.contactName, f.contactEmail, f.phone].filter(Boolean).join(' · ') },
      { id: FIELD.location, value: f.location },
      { id: FIELD.production, value: f.production },
      { id: FIELD.storePlatform, value: f.storePlatform || f.website },
      { id: FIELD.storeUrl, value: f.storeUrl },
      { id: FIELD.accountHolder, value: f.accountHolder },
      { id: FIELD.nzAccount, value: f.nzAccount },
      { id: FIELD.auBsb, value: f.auBsb },
      { id: FIELD.auAccount, value: f.auAccount },
    ];
    if (f.madeReady && MADE_READY_OPTION[f.madeReady]) {
      customFields.push({ id: FIELD.madeReady, value: MADE_READY_OPTION[f.madeReady] });
    }
    if (f.shipFrom && SHIPS_FROM_OPTION[f.shipFrom]) {
      customFields.push({ id: FIELD.shipsFrom, value: SHIPS_FROM_OPTION[f.shipFrom] });
    }
    if (f.shippingArea && SHIPPING_AREA_OPTION[f.shippingArea]) {
    customFields.push({ id: FIELD.shippingArea, value: SHIPPING_AREA_OPTION[f.shippingArea] });
  }
  if (f.bankCountry && BANK_COUNTRY_OPTION[f.bankCountry]) {
      customFields.push({ id: FIELD.bankCountry, value: BANK_COUNTRY_OPTION[f.bankCountry] });
    }

    const task = await createTask({
      name: f.brandName,
      markdown: md,
      status: 'to do',
      listId: BRANDS_LIST_ID,
      customFields,
      assignees: [222060393] // Anna — assigning emails her when a brand onboards
    });

    // Raise the matching onboarding checklist task so the brand does not sit
  // in Brands with nothing driving the next steps. Non-fatal if it fails.
  try {
    const area = f.shippingArea || 'NZ + AU';
    const steps =
      `Onboarding checklist for **${f.brandName}**.\n\n` +
      `**Shipping area:** ${area}\n` +
      `**Ships from:** ${f.shipFrom || '—'}\n\n` +
      `- [ ] Send the Seller Agreement and confirm the commission rate\n` +
      `- [ ] Record the commission rate and the shipping band (Standard if a typical single item ships under 1kg, Heavy if over) on the Brands task and in Schedule A\n` +
      `- [ ] Create the brand's shipping profile in Shopify (\$10 domestic / \$25 cross-Tasman for a Standard brand, or $20 domestic / $35 cross-Tasman for a Heavy brand. One profile named for the brand, both zones, rate name exactly Standard on each, and check the cross-border zone uses that country's own currency)\n` +
      (area !== 'NZ + AU'
        ? `- [ ] Exclude this brand from the other market's catalog in Shopify Markets\n`
        : '') +
      `- [ ] Set up their Puppet Vendors login\n` +
      `- [ ] Confirm payout details with Wise\n` +
      `- [ ] Spot-check price parity against their own site\n\n` +
      `[Brand record](${task.url})`;
    await createTask({
      name: `Onboard ${f.brandName}`,
      markdown: steps,
      status: 'to do',
      listId: ONBOARDING_LIST_ID,
      assignees: [222060393]
    });
  } catch (e) { /* non-fatal */ }

  if (logo.length) {
      try { await attachPhotos(task.id, logo, 'LOGO-'); } catch (e) { /* non-fatal */ }
    }

    // Email Anna directly when a brand onboards. ClickUp does not notify her about
    // tasks the portal creates under her own account, so this is the reliable alert.
    try {
      await sendEmail({
        to: process.env.ADMIN_EMAIL || 'anna@ziggysociety.com',
        subject: `New brand onboarding: ${f.brandName}`,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#2f3427;max-width:520px;margin:0 auto">
<h2 style="color:#3a4a2a">New brand onboarding</h2>
<p><strong>${f.brandName}</strong></p>
<p>Contact: ${f.contactName || ''} &middot; ${f.contactEmail}</p>
<p><a href="${task.url}" style="color:#3a4a2a">Open in ClickUp</a></p>
</div>`
      });
    } catch (e) { /* non-fatal - never block a submission on the notify email */ }

    res.status(200).json({ ok: true, taskUrl: task.url });
  } catch (e) {
    res.status(500).send('Something went wrong: ' + e.message);
  }
};
