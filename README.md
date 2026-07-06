# ZIGGY Society — Product Submission Portal

A small website with your branding where sellers submit products. It has a
landing page that asks whether the product is already on the seller's own
website, then routes them to one of two forms:

- **New listing** (full details) → creates a **Shopify draft product** *and* a **ClickUp task**.
- **Quick submission** (already on their site) → creates a **ClickUp task** with the link + photos so you can build the listing from their site.

Every submission lands in your ClickUp **Product Submissions** list at status
**Submitted**, so your Submitted → Photos OK → Needs Reshoot → Editing → Listed
pipeline keeps working. Shopify products come in as **drafts** — nothing goes
live until you review and publish it.

Nothing here is technical to run. Follow the steps below in order.

---

## What you'll need (all have free tiers)

1. A **Vercel** account (hosting) — https://vercel.com
2. Your **ClickUp** account (you already have this)
3. A **Shopify** store — *optional for now*; you can add it later.

---

## Folder overview

```
public/            ← the website (what sellers see)
  index.html         landing page (the two choices)
  new-listing.html   full form
  existing-listing.html  quick form
  thank-you.html
  styles.css         all the brand styling
  logo.svg           placeholder spiral — replace with your real logo
  app.js
api/               ← the backend (runs on Vercel, sellers never see it)
  submit-new.js
  submit-existing.js
lib/               ← helpers for Shopify + ClickUp
.env.example       ← the settings you'll paste into Vercel
```

---

## Step 1 — Put the project on Vercel

**Easiest path (no coding tools):**

1. Create a free account at https://github.com and a new **empty repository**
   (e.g. `ziggy-submissions`). On the repo page choose **"uploading an existing
   file"** and drag in *everything inside this folder*. Commit.
2. Go to https://vercel.com → **Add New → Project → Import** your GitHub repo.
3. Leave all build settings as their defaults and click **Deploy**.

Vercel gives you a live URL like `https://ziggy-submissions.vercel.app`. Open it
— you'll see your landing page. (The forms won't save anything yet; that's Step 2.)

*Prefer the command line? From this folder run `npx vercel` and follow the prompts.*

---

## Step 2 — Connect ClickUp (required)

**Get your ClickUp API token**

1. In ClickUp click your avatar (bottom-left) → **Settings** → **Apps**.
2. Under **API Token** click **Generate** and copy it (starts with `pk_`).

**Add it to Vercel**

1. In Vercel open your project → **Settings** → **Environment Variables**.
2. Add these two (values from `.env.example`):
   - `CLICKUP_API_TOKEN` = the `pk_…` token you just copied
   - `CLICKUP_LIST_ID` = `901615670122`  *(your Product Submissions list — already filled in)*
3. Click **Save**, then go to the **Deployments** tab → **⋯ → Redeploy** so the
   new settings take effect.

That's it — submissions now create ClickUp tasks with photos attached.

---

## Step 3 — Connect Shopify (optional, do when your store is ready)

**Create a custom app + token**

1. In Shopify admin: **Settings** → **Apps and sales channels** →
   **Develop apps** → **Create an app** (name it e.g. "Ziggy Submissions").
2. Open the app → **Configuration** → **Admin API integration** → **Configure**,
   and enable the scope **`write_products`** (this lets it create drafts). Save.
3. **Install app**, then copy the **Admin API access token** (starts with `shpat_`).
   *You only see it once — copy it now.*

**Add it to Vercel** (same Environment Variables screen as Step 2):

- `SHOPIFY_STORE_DOMAIN` = `your-store.myshopify.com`
- `SHOPIFY_ADMIN_API_TOKEN` = the `shpat_…` token
- `SHOPIFY_API_VERSION` = `2025-07`  *(leave as-is unless Shopify asks for another)*

Redeploy. Now the **New listing** form also creates a Shopify draft product.

> If Shopify ever rejects the product-creation call because of an API-version
> change, it's a one-line fix — send me the error and I'll adjust it. Until then,
> the ClickUp task is always created regardless, so no submission is ever lost.

---

## Step 4 — Test it

1. Open your Vercel URL, choose **"I need you to list it for me"**, fill it in
   with a test product, add a photo, and submit.
2. Check your ClickUp **Product Submissions** list — a new task should appear at
   **Submitted** with the details and photo attached.
3. If Shopify is connected, check **Products** in Shopify admin for a new **draft**.

---

## Make it fully on-brand

- **Logo:** replace `public/logo.svg` with your real logo (keep the filename, or
  update the `<img src>` in the HTML). A square PNG or SVG works.
- **Fonts:** headings use Poppins (bold), body uses Times New Roman — set in
  `--font-head` / `--font-body` at the top of `styles.css` if you ever change them.
- **Colours:** already set to your palette in `styles.css` (`--ink`, `--olive`,
  `--sage`, `--paper`).
- **Custom domain:** in Vercel → **Settings → Domains** you can point something
  like `submit.ziggysociety.com` at it.

---

## Good to know

- **Photos:** the form gently compresses photos in the browser (longest edge
  ~1800px) so they upload reliably and stay sharp for review. For a small number
  of photos this is well within limits. If you want to collect full-resolution
  originals at scale, the next version can add direct-to-storage uploads
  (Vercel Blob) — ask me and I'll wire it in.
- **Tracking by brand/category:** every task carries the brand and category in
  its body, and Shopify drafts are tagged with the brand + category. To group
  your ClickUp board by category, group by the existing **Product category**
  field. I can also auto-fill that ClickUp field on each task as a follow-up.
- **Costs:** Vercel, ClickUp and a Shopify custom app all work on their free/
  existing tiers for this.
