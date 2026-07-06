// POST /api/submit-new
// New listing (full details): creates a Shopify DRAFT product (if configured)
// + a ClickUp task with all details and photos attached.

const { createDraftProduct } = require('../lib/shopify');
const { createTask, attachPhotos } = require('../lib/clickup');

function esc(s) { return String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }
function row(label, val) { return val ? `**${label}:** ${val}\n` : ''; }

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const f = body.fields || {};
    const photos = body.photos || [];

    if (!f.brandName || !f.contactEmail || !f.productName) {
      res.status(400).send('Missing required fields.'); return;
    }

    // 1) Shopify draft product (optional — skipped if Shopify env not set)
    let shopify = null;
    try {
      const descriptionHtml = [
        f.description ? `<p>${esc(f.description)}</p>` : '',
        '<ul>',
        f.materials ? `<li><strong>Materials/fabric:</strong> ${esc(f.materials)}</li>` : '',
        f.colours   ? `<li><strong>Colours:</strong> ${esc(f.colours)}</li>` : '',
        f.sizes     ? `<li><strong>Sizes/variants:</strong> ${esc(f.sizes)}</li>` : '',
        f.ethics    ? `<li><strong>Ethical/sustainability:</strong> ${esc(f.ethics)}</li>` : '',
        '</ul>'
      ].join('');

      shopify = await createDraftProduct({
        title: f.productName,
        descriptionHtml,
        vendor: f.brandName,
        productType: f.productCategory,
        tags: ['ziggy-submission', f.brandName, f.productCategory].filter(Boolean),
        price: f.price
      });
    } catch (e) {
      // Don't fail the whole submission if Shopify errors — log it into the task.
      shopify = { error: e.message };
    }

    // 2) ClickUp task (source of truth for the review pipeline)
    const md =
      row('Brand', f.brandName) +
      row('Category', f.productCategory) +
      row('Contact', [f.contactName, f.contactEmail].filter(Boolean).join(' · ')) +
      '\n' +
      row('Description', f.description) +
      row('Materials/fabric', f.materials) +
      row('Colours', f.colours) +
      row('Sizes/variants', f.sizes) +
      row('Price RRP', f.price) +
      row('Stock qty', f.stock) +
      row('SKU', f.sku) +
      row('Ethical/sustainability', f.ethics) +
      '\n' +
      row('Has own photos?', f.hasPhotos) +
      row('Shipping notes (for shoot)', f.shippingNotes) +
      row('Ships from', f.shipFrom) +
      row('Dispatch time', f.dispatchTime) +
      row('Carrier', f.carrier) +
      '\n' +
      (shopify && shopify.adminUrl ? `**Shopify draft:** ${shopify.adminUrl}\n` : '') +
      (shopify && shopify.error ? `_Shopify draft not created: ${shopify.error}_\n` : '');

    const task = await createTask({
      name: `${f.productName} — ${f.brandName}`,
      markdown: md,
      status: 'Submitted'
    });

    await attachPhotos(task.id, photos);

    res.status(200).json({ ok: true, taskUrl: task.url, shopify });
  } catch (err) {
    res.status(500).send(err.message || 'Server error');
  }
};
