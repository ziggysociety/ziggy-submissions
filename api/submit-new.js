// POST /api/submit-new
// New listing (full details): creates a Shopify DRAFT product (if configured)
// + a ClickUp task with all details and photos attached.
//
// PATCHED (overnight fixes): now passes `stock` and the uploaded `photos`
// through to createDraftProduct, so the Shopify draft has inventory tracked +
// quantity set and the vendor's photos attached to Media. (Only these two lines
// changed vs the original — marked with  // <-- FIX  below.)

const { createDraftProduct } = require('../lib/shopify');
const { createTask, attachPhotos } = require('../lib/clickup');
const { generateSku } = require('../lib/sku');
const { getBrandEmail } = require('../lib/brands');
const { createTodoistTask } = require('../lib/todoist');
const { sendEmail } = require('../lib/email');

function esc(s) { return String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }
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

    if (!f.brandName || !f.productName) {
      res.status(400).send('Missing required fields (brand name and product name).'); return;
    }

    const vendorEmail = await getBrandEmail(f.brandName);

    const retail = money(num(f.retailPrice));
    const shipping = money(num(f.shipping));
    const totalPrice = (retail + shipping).toFixed(2);
    const payout = (Number(totalPrice) * 0.85).toFixed(2);

    const skuProvided = Boolean(f.sku);
    const sku = f.sku || generateSku(f.brandName);
    const madeToOrder = /yes/i.test(f.madeToOrder || '');
    const turnaround = madeToOrder ? (f.turnaround || '') : '';

    let shopify = null;
    try {
      const descriptionHtml = [
        f.description ? `<p>${esc(f.description)}</p>` : '',
        '<ul>',
        f.materials ? `<li><strong>Materials/fabric:</strong> ${esc(f.materials)}</li>` : '',
        f.colours ? `<li><strong>Colours:</strong> ${esc(f.colours)}</li>` : '',
        f.ethics ? `<li><strong>Ethical/sustainability:</strong> ${esc(f.ethics)}</li>` : '',
        madeToOrder ? `<li><strong>Made to order</strong> — turnaround: ${esc(turnaround || 'TBC')}</li>` : '',
        '</ul>'
      ].join('');

      shopify = await createDraftProduct({
        title: f.productName,
        descriptionHtml,
        vendor: f.brandName,
        productType: f.productCategory,
        tags: ['ziggy-submission', f.brandName, f.productCategory, madeToOrder ? 'made-to-order' : '']
          .filter(Boolean),
        price: totalPrice,
        sku,
        stock: f.stock,   // <-- FIX: pass stock qty so Shopify tracks + sets inventory
        photos,           // <-- FIX: pass uploaded photos so they attach to Shopify Media
        variants,
        vendorEmail
      });
    } catch (e) {
      shopify = { error: e.message };
    }

    const md =
      row('Brand', f.brandName) +
      row('Category', f.productCategory) +
      row('Vendor email', vendorEmail || '_not found — has this brand onboarded?_') +
      '\n' +
      row('Description', f.description) +
      row('Materials/fabric', f.materials) +
      row('Colours', f.colours) +
      `**Pricing (NZD):** retail ${retail.toFixed(2)} + shipping ${shipping.toFixed(2)} = **${totalPrice}** (est. payout after 15%: ${payout})\n` +
      row('Stock qty', f.stock) +
      (variants.length
        ? `**Sizes / variants (each its own SKU):**\n` +
          variants.map(v => `- ${v.name} · SKU ${v.sku}`).join('\n') + '\n'
        : row('SKU', sku + (skuProvided ? '' : ' _(auto-generated)_'))) +
      row('Made to order', madeToOrder ? `Yes — turnaround: ${turnaround || 'TBC'}` : 'No') +
      row('Ethical/sustainability', f.ethics) +
      '\n' +
      row('Ships from', f.shipFrom) +
      row('Tracked shipping?', f.tracked) +
      '\n' +
      (shopify && shopify.adminUrl ? `**Shopify draft:** ${shopify.adminUrl}\n` : '') +
      (shopify && shopify.error ? `_Shopify draft not created: ${shopify.error}_\n` : '');

    const task = await createTask({
      name: `${f.productName} — ${f.brandName}`,
      markdown: md,
      status: 'Submitted',
      assignees: [222060393]
    });

    await attachPhotos(task.id, photos);
    await attachPhotos(task.id, lifestyle, 'LIFESTYLE-');

    try {
      await createTodoistTask({
        content: `Product Approval: ${f.brandName} - ${f.productName}`,
        description: task.url ? `ClickUp: ${task.url}` : undefined
      });
    } catch (e) { /* Todoist is a nice-to-have */ }

    try {
      await sendEmail({
        to: process.env.ADMIN_EMAIL || 'anna@ziggysociety.com',
        subject: `New product submission: ${f.productName} — ${f.brandName}`,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#2f3427;max-width:520px;margin:0 auto">
<h2 style="color:#3a4a2a">New product submission</h2>
<p><strong>${f.productName}</strong> — ${f.brandName}</p>
<p>Vendor email: ${vendorEmail || 'not found — has this brand onboarded?'}</p>
<p>Price (NZD): ${totalPrice}</p>
<p><a href="${task.url}" style="color:#3a4a2a">Open in ClickUp</a></p>
</div>`
      });
    } catch (e) { /* non-fatal */ }

    res.status(200).json({ ok: true, taskUrl: task.url, shopify });
  } catch (err) {
    res.status(500).send(err.message || 'Server error');
  }
};
