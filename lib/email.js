// Minimal transactional email sender via Resend (https://resend.com).
// Needs RESEND_API_KEY. Optional EMAIL_FROM (defaults to Resend's test sender,
// which works immediately without verifying a domain — swap to your own domain
// once you've verified it in Resend, e.g. "ZIGGY Society <hello@ziggysociety.com>").

const DEFAULT_FROM = 'ZIGGY Society <onboarding@resend.dev>';

async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  const from = process.env.EMAIL_FROM || DEFAULT_FROM;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Resend send failed: ' + JSON.stringify(data));
  return data;
}

// The "your listing is live" email body sent to a vendor.
function goLiveEmailHtml({ brand, productTitle, storeUrl }) {
  const name = brand || 'there';
  const title = productTitle || 'Your product';
  const shop = storeUrl || 'https://ziggysociety.com';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#2f3427;max-width:520px;margin:0 auto">
    <h2 style="color:#3a4a2a;margin-bottom:4px">Your listing is live 🎉</h2>
    <p>Hi ${name},</p>
    <p><strong>${title}</strong> is now live on ZIGGY Society and available to shoppers in New Zealand and Australia.</p>
    <p>We'll let you know as soon as an order comes in — you'll get the order details and can pop the tracking number in once it's shipped.</p>
    <p style="margin-top:24px">
      <a href="${shop}" style="background:#3a4a2a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Visit ZIGGY Society</a>
    </p>
    <p style="color:#6f7060;font-size:13px;margin-top:28px">With love,<br/>The ZIGGY Society team</p>
  </div>`;
}

module.exports = { sendEmail, goLiveEmailHtml };
