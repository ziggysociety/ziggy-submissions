// Minimal Shopify Admin GraphQL helper — creates a DRAFT product.
//
// NOTE ON API VERSIONS: Shopify evolves this API. This uses the current
// productCreate(product: ProductCreateInput!) shape. If your store's API
// version rejects it, the fix is small — we can validate it against your
// live store once it's connected. Set SHOPIFY_API_VERSION to match your app.

function cfg() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;      // e.g. ziggy-society.myshopify.com
  const tokenV = process.env.SHOPIFY_ADMIN_API_TOKEN;   // custom app Admin API token
  const version = process.env.SHOPIFY_API_VERSION || '2025-07';
  return { domain, tokenV, version };
}

function isConfigured() {
  const { domain, tokenV } = cfg();
  return Boolean(domain && tokenV);
}

async function gql(query, variables) {
  const { domain, tokenV, version } = cfg();
  const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': tokenV, 'Content-Type': 'application/json' },
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

// Creates a draft product. Returns { id, adminUrl } or null if not configured.
// Accepts optional sku (set on the default variant) and imageUrls (external
// image URLs, e.g. pulled from a vendor's own product page).
async function createDraftProduct({ title, descriptionHtml, vendor, productType, tags, price, sku, imageUrls, variants }) {
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
  if (multi) {
    // One option ("Size") with a value per variant — Shopify auto-creates a
    // variant for each, then we set each variant's own SKU below.
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
           variants(first: 100) { nodes { id selectedOptions { name value } } }
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
    // Match each created variant (by its option value) to the vendor's SKU.
    const updates = [];
    for (const node of nodes) {
      const optVal = node.selectedOptions && node.selectedOptions[0] ? node.selectedOptions[0].value : null;
      const match = variants.find(v => (String(v.name || '').trim() || 'Variant') === optVal);
      if (!match) continue;
      const vin = { id: node.id };
      if (match.sku) vin.inventoryItem = { sku: String(match.sku) };
      const pp = parsePrice(match.price || price);
      if (pp) vin.price = pp;
      updates.push(vin);
    }
    if (updates.length) await bulkUpdate(updates);
  } else {
    const variantId = nodes[0] && nodes[0].id;
    const p = parsePrice(price);
    if (variantId && (p || sku)) {
      const variant = { id: variantId };
      if (p) variant.price = p;
      if (sku) variant.inventoryItem = { sku: String(sku) };
      await bulkUpdate([variant]);
    }
  }

  // Attach images pulled from the vendor's own listing (non-fatal if it fails —
  // some stores block hot-linking; the ClickUp task still has everything).
  if (imageUrls && imageUrls.length) {
    const media = imageUrls.slice(0, 10).map(src => ({ originalSource: src, mediaContentType: 'IMAGE' }));
    try {
      await gql(
        `mutation addMedia($productId: ID!, $media: [CreateMediaInput!]!) {
           productCreateMedia(productId: $productId, media: $media) {
             mediaUserErrors { field message }
           }
         }`,
        { productId: product.id, media }
      );
    } catch (e) { /* images are best-effort */ }
  }

  const { domain } = cfg();
  const storeHandle = domain.replace('.myshopify.com', '');
  const adminUrl = `https://admin.shopify.com/store/${storeHandle}/products/${product.legacyResourceId}`;
  return { id: product.id, adminUrl };
}

module.exports = { createDraftProduct, isConfigured };
