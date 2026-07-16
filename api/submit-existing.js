// POST /api/submit-existing
// Quick submission (brand already has a website): we AUTO-FETCH the product
// data from the pasted link, create a Shopify DRAFT pre-populated with it,
// and create a ClickUp task for the review pipeline.

const { createDraftProduct } = require('../lib/shopify');
const { createTask, attachPhotos } = require('../lib/clickup');
const { fetchProductFromUrl } = require('../lib/fetchProduct');
const { generateSku } = require('../lib/sku');

function row(label, val) { return val ? `**${label}:** ${val}\n` : ''; }

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const f = body.fields || {};
    const photos = body.photos || [];
    const lifestyle = body.lifestyle || [];
    const manualVariants = Array.isArray(body.variants) ? body.variants : [];

    if (!f.brandName || !f.productLink) {
      res.status(400).send('Missing required fields.'); return;
    }

    // 1) Try to pull the listing straight from the vendor's site.
    const fetched = await fetchProductFromUrl(f.productLink);

    // SKU: prefer what the vendor typed, then what we pulled, else generate one.
    const sku = f.sku || (fetched.ok && fetched.sku) || generateSku(f.brandName);

    const madeToOrder = /yes/i.test(f.madeToOrder || '');
    const turnaround = madeToOrder ? (f.turnaround || '') : '';

    // Variants: use the vendor's manual rows if given, else fall back to what we
    // pulled from their listing.
    let variants = manualVariants;
    if (!variants.length && fetched.ok && fetched.variantCount > 1) {
      variants = fetched.variantsDetail.map(v => ({ name: v.title, sku: v.sku, price: v.price }));
    }
    variants = variants.filter(v => v && v.name && v.sku);

    // 2) Shopify draft, pre-populated from the fetched data where possible.
    let shopify = null;
    try {
      let descriptionHtml = fetched.ok ? fetched.descriptionHtml : '';
      descriptionHtml += `<p><em>Imported from <a href="${f.productLink}">${f.productLink}</a></em></p>`;
      if (madeToOrder) descriptionHtml += `<p><strong>Made to order.</strong> Turnaround: ${turnaround || 'TBC'}.</p>`;

      shopify = await createDraftProduct({
        title: (fetched.ok && fetched.title) || `${f.brandName} product`,
        descriptionHtml,
        vendor: f.brandName,
        productType: fetched.ok ? fetched.productType : undefined,
        tags: ['ziggy-submission', f.brandName, madeToOrder ? 'made-to-order' : '']
          .filter(Boolean),
        price: fetched.ok ? fetched.price : undefined,
        sku,
        imageUrls: fetched.ok ? fetched.imageUrls : [],
        variants,
        vendorEmail: f.contactEmail
      });
    } catch (e) {
      shopify = { error: e.message };
    }

    // 3) ClickUp task (source of truth for the review pipeline).
    const md =
      row('Brand', f.brandName) +
      row('Contact', [f.contactName, f.contactEmail].filter(Boolean).join(' · ')) +
      row('Product link', f.productLink) +
      row('SKU', sku + (f.sku ? '' : ' _(auto-generated)_')) +
      row('Made to order', madeToOrder ? `Yes — turnaround: ${turnaround || 'TBC'}` : 'No') +
      '\n' +
      row('Ships from', f.shipFrom) +
      row('Ships to', f.shipsTo) +
      row('Dispatch time', f.dispatchTime) +
      row('Typical postage cost', f.postageCost) +
      row('Tracked shipping?', f.tracked) +
      '\n' +
      (fetched.ok
        ? row('Auto-fetch', `✓ Pulled "${fetched.title}"` +
            (fetched.imageUrls.length ? ` · ${fetched.imageUrls.length} image(s)` : ''))
        : row('Auto-fetch', `✗ Could not read the link (${fetched.reason}). Build the listing manually.`)) +
      (fetched.ok && fetched.variantCount > 1
        ? `**Variants (${fetched.options.join(', ') || 'options'}) — build these on the draft with their own SKUs so stock syncs per variant:**\n` +
          fetched.variantsDetail.map(v => `- ${v.title || '(variant)'}${v.sku ? ` · SKU ${v.sku}` : ' · SKU missing'}${v.price ? ` · ${v.price}` : ''}`).join('\n') + '\n'
        : '') +
      (shopify && shopify.adminUrl ? `**Shopify draft:** ${shopify.adminUrl}\n` : '') +
      (shopify && shopify.error ? `_Shopify draft not created: ${shopify.error}_\n` : '');

    const task = await createTask({
      name: `${(fetched.ok && fetched.title) || f.brandName} — ${f.brandName} (website)`,
      markdown: md,
      status: 'Submitted'
    });

    await attachPhotos(task.id, photos);
    await attachPhotos(task.id, lifestyle, 'LIFESTYLE-');

    res.status(200).json({ ok: true, taskUrl: task.url, shopify, fetched: fetched.ok });
  } catch (err) {
    res.status(500).send(err.message || 'Server error');
  }
};
