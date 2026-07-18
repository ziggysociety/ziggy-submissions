// POST /api/submit-existing
// Quick submission (brand already has a website): we AUTO-FETCH the product
// data from the pasted link (title/images/description), create a Shopify DRAFT,
// and create a ClickUp task. Price = retail (NZD) + shipping (NZD), entered by
// the vendor. Vendor email is pulled from their onboarding record by brand name.

const { createDraftProduct } = require('../lib/shopify');
const { createTask, attachPhotos } = require('../lib/clickup');
const { fetchProductFromUrl } = require('../lib/fetchProduct');
const { generateSku } = require('../lib/sku');
const { getBrandEmail } = require('../lib/brands');
const { createTodoistTask } = require('../lib/todoist');

function row(label, val) { return val ? `**${label}:** ${val}\n` : ''; }
function num(v) { const m = String(v || '').replace(',', '').match(/[\d.]+/); return m ? parseFloat(m[0]) : NaN; }
function money(v) { return isNaN(v) ? 0 : v; }

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const f = body.fields || {};
    const photos = body.photos || [];
    const lifestyle = body.lifestyle || [];
    const variants = Array.isArray(body.variants) ? body.variants : [];

    if (!f.brandName || !f.productLink) {
      res.status(400).send('Missing required fields (brand name and product link).'); return;
    }

    const vendorEmail = await getBrandEmail(f.brandName);

    // 1) Try to pull the listing straight from the vendor's site.
    const fetched = await fetchProductFromUrl(f.productLink);

    // SKU: the vendor copies their exact store SKU (required) so stock syncs.
    // For multi-size products each size carries its own SKU (see variants).
    const sku = f.sku || (fetched.ok && fetched.sku) || generateSku(f.brandName);

    const madeToOrder = /yes/i.test(f.madeToOrder || '');
    const turnaround = madeToOrder ? (f.turnaround || '') : '';

    // Price = retail + shipping (NZD), entered by the vendor (avoids AUD/NZD mix).
    const retail = money(num(f.retailPrice));
    const shipping = money(num(f.shipping));
    const totalPrice = (retail + shipping).toFixed(2);
    const payout = (Number(totalPrice) * 0.85).toFixed(2);

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
        price: totalPrice,
        sku,
        variants,
        imageUrls: fetched.ok ? fetched.imageUrls : [],
        vendorEmail
      });
    } catch (e) {
      shopify = { error: e.message };
    }

    // 3) ClickUp task (source of truth for the review pipeline).
    const md =
      row('Brand', f.brandName) +
      row('Vendor email', vendorEmail || '_not found — has this brand onboarded?_') +
      row('Product link', f.productLink) +
      (variants.length
        ? `**Sizes (each its own store SKU):**\n` +
          variants.map(v => `- ${v.name} · SKU ${v.sku}`).join('\n') + '\n'
        : row('SKU', sku + (f.sku ? ' _(vendor store SKU)_' : ' _(auto)_'))) +
      `**Pricing (NZD):** retail ${retail.toFixed(2)} + shipping ${shipping.toFixed(2)} = **${totalPrice}** (est. payout after 15%: ${payout})\n` +
      row('Made to order', madeToOrder ? `Yes — turnaround: ${turnaround || 'TBC'}` : 'No') +
      row('Ships from', f.shipFrom) +
      row('Tracked shipping?', f.tracked) +
      '\n' +
      (fetched.ok
        ? row('Auto-fetch', `✓ Pulled "${fetched.title}"` +
            (fetched.imageUrls.length ? ` · ${fetched.imageUrls.length} image(s)` : ''))
        : row('Auto-fetch', `✗ Could not read the link (${fetched.reason}). Build the listing manually.`)) +
      (fetched.ok && fetched.variantCount > 1 && !variants.length
        ? `\n_⚠ This link looks like it has multiple sizes but none were entered. Check the vendor added every size + SKU below._\n`
        : '') +
      (shopify && shopify.adminUrl ? `**Shopify draft:** ${shopify.adminUrl}\n` : '') +
      (shopify && shopify.error ? `_Shopify draft not created: ${shopify.error}_\n` : '');

    const task = await createTask({
      name: `${(fetched.ok && fetched.title) || f.brandName} — ${f.brandName} (website)`,
      markdown: md,
      status: 'Submitted',
      assignees: [222060393]   // Anna — assigning emails her on every submission
    });

    await attachPhotos(task.id, photos);
    await attachPhotos(task.id, lifestyle, 'LIFESTYLE-');

    // Add a "Product Approval" task to Todoist (non-fatal if it fails).
    const productName = (fetched.ok && fetched.title) || `${f.brandName} product`;
    try {
      await createTodoistTask({
        content: `Product Approval: ${f.brandName} - ${productName}`,
        description: task.url ? `ClickUp: ${task.url}` : undefined
      });
    } catch (e) { /* keep going — Todoist is a nice-to-have */ }

    res.status(200).json({ ok: true, taskUrl: task.url, shopify, fetched: fetched.ok });
  } catch (err) {
    res.status(500).send(err.message || 'Server error');
  }
};
