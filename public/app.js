/* ZIGGY submission portal — front-end logic
   - handles one or more upload zones (product photos + lifestyle/UGC)
   - previews + lightly compresses photos (keeps them sharp, keeps payloads sane)
   - posts everything as JSON to the form's data-endpoint
   - redirects to the thank-you page on success                            */

(function () {
  const form = document.getElementById('ziggy-form');
  if (!form) return;

  const endpoint  = form.getAttribute('data-endpoint');
  const statusEl  = document.getElementById('status');
  const submitBtn = document.getElementById('submitBtn');

  const MAX_DIM = 1800;      // longest edge in px — plenty for review + most listings
  const QUALITY = 0.85;      // JPEG quality
  const MAX_PHOTOS = 12;     // per zone

  /* ---- photo compression ---- */
  function compress(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => { img.src = reader.result; };
      reader.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (Math.max(width, height) > MAX_DIM) {
          const s = MAX_DIM / Math.max(width, height);
          width = Math.round(width * s);
          height = Math.round(height * s);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', QUALITY));
      };
      img.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* ---- wire up every upload zone (.upload[data-bucket]) ---- */
  const buckets = {};   // { bucketName: [ {name, dataUrl}, ... ] }

  document.querySelectorAll('.upload[data-bucket]').forEach(zone => {
    const bucket   = zone.getAttribute('data-bucket');
    const input    = zone.querySelector('input[type=file]');
    const dropzone = zone.querySelector('.dropzone');
    const dzText   = zone.querySelector('.dropzone-text');
    const thumbsEl = zone.querySelector('.thumbs');
    buckets[bucket] = [];

    async function addFiles(fileList) {
      const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
      for (const f of files) {
        if (buckets[bucket].length >= MAX_PHOTOS) break;
        try {
          const dataUrl = await compress(f);
          buckets[bucket].push({ name: f.name, dataUrl });
        } catch (e) { /* skip unreadable file */ }
      }
      render();
    }

    function render() {
      thumbsEl.innerHTML = '';
      buckets[bucket].forEach((p, i) => {
        const d = document.createElement('div');
        d.className = 'thumb';
        d.innerHTML = '<img src="' + p.dataUrl + '" alt=""><button type="button" aria-label="Remove">&times;</button>';
        d.querySelector('button').onclick = () => { buckets[bucket].splice(i, 1); render(); };
        thumbsEl.appendChild(d);
      });
      if (dzText) {
        const n = buckets[bucket].length;
        dzText.textContent = n
          ? (n + ' photo' + (n > 1 ? 's' : '') + ' added — tap to add more')
          : dzText.getAttribute('data-empty') || dzText.textContent;
      }
    }

    if (dzText && !dzText.getAttribute('data-empty')) dzText.setAttribute('data-empty', dzText.textContent);
    input.addEventListener('change', e => addFiles(e.target.files));
    ['dragover', 'dragenter'].forEach(ev => dropzone.addEventListener(ev, e => e.preventDefault()));
    dropzone.addEventListener('drop', e => { e.preventDefault(); addFiles(e.dataTransfer.files); });
  });

  /* ---- made-to-order → show/require turnaround ---- */
  const mto = document.getElementById('madeToOrder');
  const turnaroundField = document.getElementById('turnaroundField');
  const turnaround = document.getElementById('turnaround');
  function syncTurnaround() {
    if (!mto || !turnaroundField) return;
    const on = /yes/i.test(mto.value);
    turnaroundField.hidden = !on;
    if (turnaround) turnaround.required = on;
    if (!on && turnaround) turnaround.value = '';
  }
  if (mto) { mto.addEventListener('change', syncTurnaround); syncTurnaround(); }

  /* ---- SKU generate button ---- */
  const genSku = document.getElementById('genSku');
  const skuInput = document.getElementById('sku');
  if (genSku && skuInput) {
    genSku.addEventListener('click', () => {
      const brand = (form.querySelector('[name=brandName]') || {}).value || '';
      const b = brand.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'ZG';
      const r = Math.random().toString(36).slice(2, 7).toUpperCase();
      skuInput.value = `ZS-${b}-${r}`;
    });
  }

  /* ---- live price = retail + shipping (NZD), payout after 15% ---- */
  const retailEl = document.getElementById('retailPrice');
  const shippingEl = document.getElementById('shipping');
  const priceBox = document.getElementById('priceBox');
  const zPriceEl = document.getElementById('zPrice');
  const zPayoutEl = document.getElementById('zPayout');
  function toNum(v) { const m = String(v || '').replace(',', '').match(/[\d.]+/); return m ? parseFloat(m[0]) : NaN; }
  function calcPrice() {
    if (!retailEl || !shippingEl || !priceBox) return;
    const r = toNum(retailEl.value), s = toNum(shippingEl.value);
    if (isNaN(r) && isNaN(s)) { priceBox.hidden = true; return; }
    const total = (isNaN(r) ? 0 : r) + (isNaN(s) ? 0 : s);
    priceBox.hidden = false;
    if (zPriceEl) zPriceEl.textContent = total.toFixed(2);
    if (zPayoutEl) zPayoutEl.textContent = (total * 0.85).toFixed(2);
  }
  if (retailEl && shippingEl) {
    retailEl.addEventListener('input', calcPrice);
    shippingEl.addEventListener('input', calcPrice);
  }

  /* ---- variants (single vs multiple sizes) ---- */
  const hasVariants   = document.getElementById('hasVariants');
  const singleSkuField= document.getElementById('singleSkuField');
  const variantsField = document.getElementById('variantsField');
  const variantRows   = document.getElementById('variantRows');
  const addVariant    = document.getElementById('addVariant');
  const skuOriginallyRequired = skuInput ? skuInput.required : false;

  function syncVariants() {
    if (!hasVariants || !variantsField || !singleSkuField) return;
    const multi = /yes/i.test(hasVariants.value);
    variantsField.hidden = !multi;
    singleSkuField.hidden = multi;
    // Single SKU keeps its original required state, but never required when multi.
    if (skuInput) skuInput.required = !multi && skuOriginallyRequired;
  }
  function bindRemove(row) {
    const btn = row.querySelector('.var-remove');
    if (btn) btn.addEventListener('click', () => {
      if (variantRows.querySelectorAll('.varrow').length > 1) row.remove();
      else { row.querySelector('.v-name').value = ''; row.querySelector('.v-sku').value = ''; }
    });
  }
  if (hasVariants) {
    hasVariants.addEventListener('change', syncVariants);
    syncVariants();
    variantRows.querySelectorAll('.varrow').forEach(bindRemove);
    addVariant.addEventListener('click', () => {
      const row = variantRows.querySelector('.varrow').cloneNode(true);
      row.querySelector('.v-name').value = '';
      row.querySelector('.v-sku').value = '';
      variantRows.appendChild(row);
      bindRemove(row);
    });
  }
  function collectVariants() {
    if (!hasVariants || !/yes/i.test(hasVariants.value)) return [];
    return Array.from(variantRows.querySelectorAll('.varrow')).map(r => ({
      name: r.querySelector('.v-name').value.trim(),
      sku:  r.querySelector('.v-sku').value.trim()
    })).filter(v => v.name && v.sku);
  }

  /* ---- submit ---- */
  function setStatus(msg, isErr) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (isErr ? ' err' : '');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('');

    if (!form.checkValidity()) { form.reportValidity(); return; }

    // Product photos are required on both forms.
    if (buckets.photos && buckets.photos.length === 0) {
      setStatus('Please add at least one product photo.', true);
      return;
    }

    // If multiple variants selected, need at least one complete row.
    const variants = collectVariants();
    if (hasVariants && /yes/i.test(hasVariants.value) && variants.length === 0) {
      setStatus('Please add at least one size/variant with its SKU.', true);
      return;
    }

    const fields = {};
    new FormData(form).forEach((v, k) => { fields[k] = v; });

    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = 'Submitting…';
    setStatus('Uploading your product…');

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields,
          photos: buckets.photos || [],
          lifestyle: buckets.lifestyle || [],
          variants
        })
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || ('Request failed (' + res.status + ')'));
      }
      window.location.href = 'thank-you.html';
    } catch (err) {
      setStatus('Sorry — something went wrong. ' + (err.message || '') + ' Please try again or email us.', true);
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  });
})();
