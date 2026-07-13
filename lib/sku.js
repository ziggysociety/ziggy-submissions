// Generates a ZIGGY SKU when a vendor doesn't have one of their own.
// Format: ZS-<up to 4 brand letters>-<5 random chars>  e.g. ZS-WILL-7K2QP
function generateSku(brand) {
  const b = String(brand || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'ZG';
  const r = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `ZS-${b}-${r}`;
}
module.exports = { generateSku };
