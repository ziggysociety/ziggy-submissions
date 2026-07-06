/* ZIGGY submission portal — front-end logic
   - previews + lightly compresses photos (keeps them sharp, keeps payloads sane)
   - posts everything as JSON to the form's data-endpoint
   - redirects to the thank-you page on success                            */

(function () {
  const form = document.getElementById('ziggy-form');
  if (!form) return;

  const endpoint   = form.getAttribute('data-endpoint');
  const fileInput  = document.getElementById('photos');
  const dropzone   = document.getElementById('dropzone');
  const dzText     = document.getElementById('dropzone-text');
  const thumbsEl   = document.getElementById('thumbs');
  const statusEl   = document.getElementById('status');
  const submitBtn  = document.getElementById('submitBtn');

  // Each item: { name, dataUrl }
  let photos = [];

  const MAX_DIM = 1800;      // longest edge in px — plenty for review + most listings
  const QUALITY = 0.85;      // JPEG quality
  const MAX_PHOTOS = 8;

  /* ---- photo handling ---- */
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

  async function addFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    for (const f of files) {
      if (photos.length >= MAX_PHOTOS) break;
      try {
        const dataUrl = await compress(f);
        photos.push({ name: f.name, dataUrl });
      } catch (e) { /* skip unreadable file */ }
    }
    renderThumbs();
  }

  function renderThumbs() {
    thumbsEl.innerHTML = '';
    photos.forEach((p, i) => {
      const d = document.createElement('div');
      d.className = 'thumb';
      d.innerHTML = '<img src="' + p.dataUrl + '" alt=""><button type="button" aria-label="Remove">&times;</button>';
      d.querySelector('button').onclick = () => { photos.splice(i, 1); renderThumbs(); };
      thumbsEl.appendChild(d);
    });
    if (dzText) dzText.textContent = photos.length
      ? (photos.length + ' photo' + (photos.length > 1 ? 's' : '') + ' added — tap to add more')
      : 'Tap to add photos, or drag them here';
  }

  if (fileInput) {
    fileInput.addEventListener('change', e => addFiles(e.target.files));
    ['dragover', 'dragenter'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); }));
    dropzone.addEventListener('drop', e => { e.preventDefault(); addFiles(e.dataTransfer.files); });
  }

  /* ---- submit ---- */
  function setStatus(msg, isErr) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (isErr ? ' err' : '');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('');

    // native required-field check
    if (!form.checkValidity()) { form.reportValidity(); return; }

    // photos required on the quick form
    if (form.dataset.endpoint.indexOf('existing') !== -1 && photos.length === 0) {
      setStatus('Please add at least one photo.', true); return;
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
        body: JSON.stringify({ fields, photos })
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
