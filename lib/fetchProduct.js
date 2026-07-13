// Pulls product data from a vendor's own product page.
//
// Strategy (in order):
//   1) Shopify JSON  — <product-url>.json  (cleanest: title, body, all images,
//      price AND sku). Covers most small brands.
//   2) Generic fallback — fetch the page HTML and read schema.org "Product"
//      structured data (JSON-LD) and Open Graph tags. This works across
//      WooCommerce, Squarespace, BigCommerce, Wix, etc. It reliably gets
//      title, main image, description and price; sku when the store publishes
//      it. The vendor can always type/override the SKU on the form.
//
// If nothing can be read we return { ok:false } and the caller falls back to a
// manual task — nothing is ever lost.

function toUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    u.hash = '';
    u.search = '';
    u.pathname = u.pathname.replace(/\/+$/, '');
    return u;
  } catch (e) { return null; }
}

const HEADERS = { 'Accept': 'text/html,application/json', 'User-Agent': 'ZiggySociety-Submission/1.0' };

/* ---------- 1) Shopify ---------- */
async function tryShopify(u) {
  try {
    const res = await fetch(`${u.origin}${u.pathname}.json`, { headers: HEADERS });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') || '').includes('json')) return null;
    const data = await res.json();
    const p = data.product || data;
    if (!p || !p.title) return null;
    const images = Array.isArray(p.images) ? p.images.map(i => (typeof i === 'string' ? i : i.src)).filter(Boolean) : [];
    const variants = Array.isArray(p.variants) ? p.variants : [];
    const first = variants[0] || {};
    // Option names (e.g. Size, Colour) and each variant's details.
    const options = Array.isArray(p.options)
      ? p.options.map(o => (typeof o === 'string' ? o : (o && o.name))).filter(Boolean)
      : [];
    const variantsDetail = variants.map(v => ({
      title: v.title || [v.option1, v.option2, v.option3].filter(Boolean).join(' / '),
      sku: v.sku || '',
      price: v.price != null ? String(v.price) : ''
    }));
    return {
      ok: true, platform: 'shopify', source: `${u.origin}${u.pathname}.json`,
      title: p.title || '', descriptionHtml: p.body_html || '', vendor: p.vendor || '',
      productType: p.product_type || '', imageUrls: images,
      price: first.price != null ? String(first.price) : null,
      sku: first.sku || '', variantCount: variants.length,
      variantSkus: variants.map(v => v.sku).filter(Boolean),
      options, variantsDetail
    };
  } catch (e) { return null; }
}

/* ---------- 2) Generic (JSON-LD + Open Graph) ---------- */
function findProductNode(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const p = findProductNode(n); if (p) return p; } return null; }
  const t = node['@type'];
  const types = Array.isArray(t) ? t.map(String) : [String(t || '')];
  if (types.some(x => x.toLowerCase() === 'product')) return node;
  if (node['@graph']) return findProductNode(node['@graph']);
  return null;
}

function firstOffer(offers) {
  if (!offers) return {};
  if (Array.isArray(offers)) return offers[0] || {};
  return offers;
}

function metaContent(html, prop) {
  // matches <meta property="og:title" content="..."> in either attribute order
  const re = new RegExp('<meta[^>]+(?:property|name|itemprop)=["\']' + prop + '["\'][^>]*content=["\']([^"\']*)["\']', 'i');
  const m = html.match(re) || html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]+(?:property|name|itemprop)=["\']' + prop + '["\']', 'i'));
  return m ? m[1] : '';
}

async function tryGeneric(u) {
  try {
    const res = await fetch(`${u.origin}${u.pathname}`, { headers: HEADERS });
    if (!res.ok) return null;
    const html = await res.text();

    let title = '', descriptionHtml = '', price = null, sku = '', vendor = '';
    const imageUrls = [];

    // JSON-LD structured data
    const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const b of blocks) {
      const json = b.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
      try {
        const p = findProductNode(JSON.parse(json));
        if (p) {
          title = p.name || title;
          descriptionHtml = p.description || descriptionHtml;
          sku = p.sku || (p.mpn || '') || sku;
          if (p.brand) vendor = (typeof p.brand === 'string' ? p.brand : p.brand.name) || vendor;
          const img = p.image;
          if (img) (Array.isArray(img) ? img : [img]).forEach(x => { const s = typeof x === 'string' ? x : (x && x.url); if (s) imageUrls.push(s); });
          const offer = firstOffer(p.offers);
          price = (offer.price != null ? String(offer.price) : (offer.lowPrice != null ? String(offer.lowPrice) : price));
          if (!sku && offer.sku) sku = offer.sku;
          break;
        }
      } catch (e) { /* skip malformed block */ }
    }

    // Open Graph fallback for anything still missing
    if (!title) title = metaContent(html, 'og:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
    if (!descriptionHtml) descriptionHtml = metaContent(html, 'og:description');
    if (!imageUrls.length) { const og = metaContent(html, 'og:image'); if (og) imageUrls.push(og); }
    if (price == null) { const pr = metaContent(html, 'product:price:amount') || metaContent(html, 'og:price:amount'); if (pr) price = pr; }
    if (!sku) sku = metaContent(html, 'sku');

    if (!title) return null;
    return {
      ok: true, platform: 'generic', source: `${u.origin}${u.pathname}`,
      title, descriptionHtml, vendor, productType: '',
      imageUrls, price: price != null ? String(price) : null,
      sku: sku || '', variantCount: 1, variantSkus: sku ? [sku] : [],
      options: [], variantsDetail: []
    };
  } catch (e) { return null; }
}

// Returns a normalised product object, or { ok:false, reason }.
async function fetchProductFromUrl(rawUrl) {
  const u = toUrl(rawUrl);
  if (!u) return { ok: false, reason: 'invalid-url' };

  const shopify = await tryShopify(u);
  if (shopify) return shopify;

  const generic = await tryGeneric(u);
  if (generic) return generic;

  return { ok: false, reason: 'could-not-read' };
}

module.exports = { fetchProductFromUrl };
