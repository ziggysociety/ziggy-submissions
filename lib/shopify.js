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
async function createDraftProduct({ title, descriptionHtml, vendor, productType, tags, price }) {
  if (!isConfigured()) return null;

  const created = await gql(
    `mutation createDraft($product: ProductCreateInput!) {
       productCreate(product: $product) {
         product { id legacyResourceId title variants(first: 1) { nodes { id } } }
         userErrors { field message }
       }
     }`,
    {
      product: {
        title: title || 'Untitled product',
        descriptionHtml: descriptionHtml || '',
        vendor: vendor || undefined,
        productType: productType || undefined,
        tags: tags && tags.length ? tags : undefined,
        status: 'DRAFT'
      }
    }
  );

  const errs = created.productCreate.userErrors;
  if (errs && errs.length) throw new Error('Shopify productCreate: ' + JSON.stringify(errs));

  const product = created.productCreate.product;
  const variantId = product.variants.nodes[0] && product.variants.nodes[0].id;

  // Set price on the auto-created default variant, if we have one.
  const p = parsePrice(price);
  if (p && variantId) {
    await gql(
      `mutation setPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
         productVariantsBulkUpdate(productId: $productId, variants: $variants) {
           userErrors { field message }
         }
       }`,
      { productId: product.id, variants: [{ id: variantId, price: p }] }
    );
  }

  const { domain } = cfg();
  const storeHandle = domain.replace('.myshopify.com', '');
  const adminUrl = `https://admin.shopify.com/store/${storeHandle}/products/${product.legacyResourceId}`;
  return { id: product.id, adminUrl };
}

module.exports = { createDraftProduct, isConfigured };
