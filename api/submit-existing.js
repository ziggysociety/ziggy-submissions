// POST /api/submit-existing
// Quick submission (brand already has a website): creates a ClickUp task with
// the product link + photos so you can build the listing from their site.

const { createTask, attachPhotos } = require('../lib/clickup');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const f = body.fields || {};
    const photos = body.photos || [];

    if (!f.brandName || !f.productLink) {
      res.status(400).send('Missing required fields.'); return;
    }

    const md =
      `**Brand:** ${f.brandName}\n` +
      `**Product link:** ${f.productLink}\n\n` +
      `_Build listing from the seller's website. Photos attached below._\n`;

    const task = await createTask({
      name: `${f.brandName} — (from website)`,
      markdown: md,
      status: 'Submitted'
    });

    await attachPhotos(task.id, photos);

    res.status(200).json({ ok: true, taskUrl: task.url });
  } catch (err) {
    res.status(500).send(err.message || 'Server error');
  }
};
