// Minimal Shopify Admin GraphQL helper — creates a DRAFT product.
//
// PATCHED (overnight fixes):
//   * Now enables inventory tracking + sets the submitted stock quantity
//     (fixes "Inventory not tracked" / dropped qty).
//   * Now uploads the full-details form's own base64 photos to Shopify via
//     staged uploads (fixes empty Media on full-form submissions).
//   * createDraftProduct now accepts `stock` and `photos` ([{name,dataUrl}]).
//
// TEST AGAINST YOUR LIVE STORE ON A PREVIEW DEPLOY BEFORE MERGING TO main.
// Targets SHOPIFY_API_VERSION (default 2026-07). If a mutation is rejected,
// it's almost always an API-version mismatch — set the env var to your version.

function cfg() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;         // e.g. zybd80-tz.myshopify.com
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const staticToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || '2026-07';
  return { domain, clientId, clientSecret, staticToken, version };
}

function isConfigured() {
  const { domain, clientId, clientSecret, staticToken } = cfg();
  return Boolean(domain && (staticToken || (clientId && clientSecret)));
}

let _tokenCache = { value: null, expiresAt: 0 };
async function getAccessToken() {
  const { domain, clientId, clientSecret, staticToken } = cfg();
  if (staticToken) return staticToken;
  if (_tokenCache.value && Date.now() < _tokenCache.expiresAt) return _tokenCache.value;

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Shopify token request failed: ' + JSON.stringify(data));
  const ttl = Math.max(60, (data.expires_in || 86399) - 300);
  _tokenCache = { value: data.access_token, expiresAt: Date.now() + ttl * 1000 };
  return _tokenCache.value;
}

async function gql(query, variables) {
  const { domain, version } = cfg();
  const token = await getAccessToken();
  const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  if (data.errors) throw new Error('Shopify GraphQL error: ' + JSON.stringify(data.errors));
  return data.data;
}

function parsePrice(raw) {
  if (!raw) return null;
  const m = String(raw).replace(',', '').match(/[\d.]+/);
  return m ? m[0] : null;
}

function parseQty(raw) {
  if (raw === 0) return 0;
  if (!raw) return null;
  const m = String(raw).match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

// --- NEW: primary location (needed to set inventory quantity) ---------------
let _locationCache = null;
async function getPrimaryLocationId() {
  if (_locationCache) return _locationCache;
  const data = await gql(`query { locations(first: 1, includeInactive: false) { nodes { id } } }`);
  const node = data && data.locations && data.locations.nodes && data.locations.nodes[0];
  _locationCache = node ? node.id : null;
  return _locationCache;
}

// --- NEW: upload base64 data-URL photos to Shopify via staged uploads --------
// photos: [{ name, dataUrl }] where dataUrl = "data:image/jpeg;base64,...."
async function uploadDataUrlImages(productId, photos) {
  const list = (photos || []).filter(p => p && p.dataUrl && /^data:/.test(p.dataUrl)).slice(0, 10);
  if (!list.length) return;

  // 1) Ask Shopify for staged upload targets.
  const inputs = list.map((p, i) => {
    const mime = (p.dataUrl.match(/^data:([^;]+);/) || [])[1] || 'image/jpeg';
    const ext = mime.split('/')[1] || 'jpg';
    return { filename: (p.name || `photo-${i + 1}.${ext}`), mimeType: mime, resource: 'IMAGE', httpMethod: 'POST' };
  });
  const staged = await gql(
    `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
       stagedUploadsCreate(input: $input) {
         stagedTargets { url resourceUrl parameters { name value } }
         userErrors { field message }
       }
     }`,
    { input: inputs }
  );
  const targets = (staged.stagedUploadsCreate && staged.stagedUploadsCreate.stagedTargets) || [];

  // 2) POST each image's bytes to its staged target.
  const resourceUrls = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const b64 = list[i].dataUrl.split(',')[1] || '';
    const bytes = Buffer.from(b64, 'base64');
    const form = new FormData();
    for (const param of (t.parameters || [])) form.append(param.name, param.value);
    const mime = (list[i].dataUrl.match(/^data:([^;]+);/) || [])[1] || 'image/jpeg';
    form.append('file', new Blob([bytes], { type: mime }), inputs[i].filename);
    try {
      const up = await fetch(t.url, { method: 'POST', body: form });
      if (up.ok || up.status === 201 || up.status === 204) resourceUrls.push(t.resourceUrl);
    } catch (e) { /* skip a failed image, keep the rest */ }
  }

  // 3) Attach the uploaded images to the product.
  if (resourceUrls.length) {
    const media = resourceUrls.map(src => ({ originalSource: src, mediaContentType: 'IMAGE' }));
    await gql(
      `mutation addMedia($productId: ID!, $media: [CreateMediaInput!]!) {
         productCreateMedia(productId: $productId, media: $media) {
           mediaUserErrors { field message }
         }
       }`,
      { productId, media }
    );
  }
}

// --- NEW: enable tracking + set quantity on a variant's inventory item -------
async function setInventory(inventoryItemId, quantity) {
  if (!inventoryItemId) return;
  // a) turn tracking on
  await gql(
    `mutation($id: ID!, $input: InventoryItemUpdateInput!) {
       inventoryItemUpdate(id: $id, input: $input) { userErrors { field message } }
     }`,
    { id: inventoryItemId, input: { tracked: true } }
  );
  // b) set the available quantity at the primary location
  const qty = parseQty(quantity);
  if (qty === null) return;
  const locationId = await getPrimaryLocationId();
  if (!locationId) return;
  await gql(
    `mutation($input: InventorySetQuantitiesInput!) {
       inventorySetQuantities(input: $input) { userErrors { field message } }
     }`,
    { input: {
        name: 'available',
        reason: 'correction',
        ignoreCompareQuantity: true,
        quantities: [{ inventoryItemId, locationId, quantity: qty }]
      } }
  );
}

// Creates a draft product. Returns { id, adminUrl } or null if not configured.
// NEW params: `stock` (single-variant qty) and `photos` ([{name,dataUrl}] from
// the full-details form). `imageUrls` (external URLs) still used by the fast path.
async function createDraftProduct({ title, descriptionHtml, vendor, productType, tags, price, sku, imageUrls, photos, stock, variants, vendorEmail }) {
  if (!isConfigured()) return null;

  const multi = Array.isArray(variants) && variants.length > 0;

  const productInput = {
    title: title || 'Untitled product',
    descriptionHtml: descriptionHtml || '',
    vendor: vendor || undefined,
    productType: productType || undefined,
    tags: tags && tags.length ? tags : undefined,
    status: 'DRAFT'
  };
  if (vendorEmail) {
    productInput.metafields = [{
      namespace: 'custom',
      key: 'vendor_email',
      type: 'single_line_text_field',
      value: String(vendorEmail)
    }];
  }
  if (multi) {
    productInput.productOptions = [{
      name: 'Size',
      values: variants.map(v => ({ name: (String(v.name || '').trim() || 'Variant') }))
    }];
  }

  const created = await gql(
    `mutation createDraft($product: ProductCreateInput!) {
       productCreate(product: $product) {
         product {
           id legacyResourceId title
           variants(first: 100) { nodes { id inventoryItem { id } selectedOptions { name value } } }
         }
         userErrors { field message }
       }
     }`,
    { product: productInput }
  );

  const errs = created.productCreate.userErrors;
  if (errs && errs.length) throw new Error('Shopify productCreate: ' + JSON.stringify(errs));

  const product = created.productCreate.product;
  const nodes = (product.variants && product.variants.nodes) || [];

  const bulkUpdate = (updates) => gql(
    `mutation setVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
       productVariantsBulkUpdate(productId: $productId, variants: $variants) {
         userErrors { field message }
       }
     }`,
    { productId: product.id, variants: updates }
  );

  if (multi) {
    const updates = [];
    for (const node of nodes) {
      const optVal = node.selectedOptions && node.selectedOptions[0] ? node.selectedOptions[0].value : null;
      const match = variants.find(v => (String(v.name || '').trim() || 'Variant') === optVal);
      if (!match) continue;
      const vin = { id: node.id };
      if (match.sku) vin.inventoryItem = { sku: String(match.sku), tracked: true };
      const pp = parsePrice(match.price || price);
      if (pp) vin.price = pp;
      updates.push(vin);
    }
    if (updates.length) await bulkUpdate(updates);
    // Per-size quantities aren't collected on the form, so tracking is enabled
    // above and quantities are left for manual entry (or a later stock-sync run).
  } else {
    const node = nodes[0];
    const variantId = node && node.id;
    const p = parsePrice(price);
    if (variantId && (p || sku)) {
      const variant = { id: variantId };
      if (p) variant.price = p;
      if (sku) variant.inventoryItem = { sku: String(sku), tracked: true };
      await bulkUpdate([variant]);
    }
    // NEW: enable tracking + set the submitted quantity on the default variant.
    const invItemId = node && node.inventoryItem && node.inventoryItem.id;
    try { await setInventory(invItemId, stock); } catch (e) { /* non-fatal */ }
  }

  // Attach images: external URLs (fast path) AND/OR uploaded base64 photos (full form).
  if (imageUrls && imageUrls.length) {
    const media = imageUrls.slice(0, 10).map(src => ({ originalSource: src, mediaContentType: 'IMAGE' }));
    try {
      await gql(
        `mutation addMedia($productId: ID!, $media: [CreateMediaInput!]!) {
           productCreateMedia(productId: $productId, media: $media) { mediaUserErrors { field message } }
         }`,
        { productId: product.id, media }
      );
    } catch (e) { /* best-effort */ }
  }
  try { await uploadDataUrlImages(product.id, photos); } catch (e) { /* best-effort */ }

  const { domain } = cfg();
  const storeHandle = domain.replace('.myshopify.com', '');
  const adminUrl = `https://admin.shopify.com/store/${storeHandle}/products/${product.legacyResourceId}`;
  return { id: product.id, adminUrl };
}

// --- Go-live email support (unchanged) -------------------------------------
async function getProductGoLiveInfo(productGid) {
  const data = await gql(
    `query($id: ID!) {
       product(id: $id) {
         id title status tags vendor
         vendorEmail: metafield(namespace: "custom", key: "vendor_email") { value }
         goLive: metafield(namespace: "custom", key: "golive_emailed") { value }
       }
     }`,
    { id: productGid }
  );
  const p = data && data.product;
  if (!p) return null;
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    tags: p.tags || [],
    vendor: p.vendor || '',
    vendorEmail: p.vendorEmail && p.vendorEmail.value ? p.vendorEmail.value : null,
    goLiveEmailed: !!(p.goLive && p.goLive.value === 'true')
  };
}

async function setGoLiveEmailed(productGid) {
  await gql(
    `mutation($mf: [MetafieldsSetInput!]!) {
       metafieldsSet(metafields: $mf) { userErrors { field message } }
     }`,
    { mf: [{
      ownerId: productGid,
      namespace: 'custom',
      key: 'golive_emailed',
      type: 'single_line_text_field',
      value: 'true'
    }] }
  );
}

module.exports = { createDraftProduct, isConfigured, getProductGoLiveInfo, setGoLiveEmailed };
