# Budget Passbook — Full Setup Guide
### GitHub Hosting → Connect AI → Google Sign-In

Do these three parts **in order**. Each one builds on the last, so don't skip ahead.

---

# PART 1: Host your app on GitHub

This puts your app on the internet with a real web address.

### Step 1 — Create a GitHub account (skip if you already have one)
1. Go to **github.com** → **Sign up**
2. Pick a username, verify your email

### Step 2 — Create a repository
1. Click **+** (top right) → **New repository**
2. Name it `budget-passbook`
3. Set it to **Public**
4. Click **Create repository**

### Step 3 — Upload your files
Upload these, all sitting loose in the main repo (not inside any folder):
- `index.html`
- `manifest.json`
- `sw.js`
- `privacy-policy.html`
- the whole `icons` folder (drag the folder itself so it keeps the `icons/` path)

To upload: **Add file → Upload files** → drag everything in → **Commit changes**

### Step 4 — Turn on GitHub Pages
1. Go to **Settings → Pages**
2. Branch: **main**, folder: **/ (root)**
3. Click **Save**
4. Wait 1-2 minutes

### Step 5 — Get your web address
Still on the Pages settings screen, copy the URL shown — it looks like:
```
https://yourusername.github.io/budget-passbook/
```

✅ **Check yourself:** open that link on your phone — the app should load.

---

# PART 2: Connect AI (Cloudflare Worker)

This is the helper server that makes the AI buttons (category suggestions,
insights, chat, quick add, Plan It) actually work.

### Step 1 — Get an Anthropic API key
1. Go to **console.anthropic.com** → sign up/log in
2. **Settings → API Keys → Create Key**
3. Copy it and save it somewhere — you can't view it again later
4. Add some credit under **Plans & Billing** (₹500 goes a long way)

### Step 2 — Make a free Cloudflare account
Go to **dash.cloudflare.com/sign-up**, verify your email.

### Step 3 — Set up your terminal
You don't need to permanently install anything — just put `npx` in front
of every command below, which downloads the tool fresh each time and
avoids permission errors:
```bash
npx wrangler login
```
This opens your browser — click **Allow**.

### Step 4 — Go to the worker folder
```bash
cd path/to/budget-passbook-subscription/worker
```
(Type `cd ` then drag the actual `worker` folder from Finder into the terminal window, then press Enter — this avoids typos.)

Confirm you're in the right place:
```bash
ls
```
You should see `worker.js`, `wrangler.toml`, and some `.md` files.

### Step 5 — Create the storage namespace
```bash
npx wrangler kv namespace create RATE_LIMIT_KV
```
This prints an `id`. Copy it.

Open `wrangler.toml` in a text editor:
```bash
open -e wrangler.toml
```
Find:
```
id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
```
Replace with your real id. Save.

*(If it says a namespace with that name already exists, run `npx wrangler kv namespace list` instead to find the id you already created.)*

### Step 6 — Give the Worker your Anthropic key
```bash
npx wrangler secret put ANTHROPIC_API_KEY
```
Paste your key when asked, press Enter.

### Step 7 — Deploy
```bash
npx wrangler deploy
```
The first time, it'll ask to register a `workers.dev` subdomain — type `yes`, then pick a short name (e.g. your username). It then prints your Worker's address:
```
https://budget-passbook-ai.yourname.workers.dev
```
**Copy this.**

### Step 8 — Connect the app to your Worker
1. Open `index.html`
2. Find near the top of the `<script>` section:
   ```js
   const WORKER_URL = "https://budget-passbook-ai.YOUR-SUBDOMAIN.workers.dev";
   ```
3. Replace with your real address from Step 7
4. Save, then re-upload `index.html` to GitHub (same Upload files process as before — it'll ask to replace the existing one, click yes)

### Step 9 — Test it
```bash
curl -X POST https://budget-passbook-ai.yourname.workers.dev/ai \
  -H "content-type: application/json" \
  -H "x-device-id: test123" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":50,"messages":[{"role":"user","content":"say hi"}]}'
```
You should get back a real reply from Claude, not an error.

✅ **Check yourself:** open your app, add an expense, watch for the "✨ Suggested category" chip.

---

# PART 3: Google Sign-In (cross-device sync)

This lets the same budget data show up when someone signs in on a
different phone, tablet, or computer.

### Step 1 — Create the OAuth consent screen
1. Go to **console.cloud.google.com**
2. Use the same project as before (or create one)
3. Go to **APIs & Services → OAuth consent screen**
4. User type: **External**
5. Fill in app name (`Budget Passbook`), your email as support contact
6. Scopes: leave the defaults (email, profile) — no changes needed
7. Under **Test users**, add your own Google account email (needed while the app isn't published yet)
8. Save

### Step 2 — Create the OAuth Client ID
1. Go to **APIs & Services → Credentials**
2. **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `Budget Passbook Web`
5. Under **Authorized JavaScript origins**, add your exact GitHub Pages domain (no trailing slash, no path after it):
   ```
   https://yourusername.github.io
   ```
6. Click **Create**
7. Copy the **Client ID** — looks like:
   ```
   123456789-abc123.apps.googleusercontent.com
   ```

### Step 3 — Put the Client ID in your app
1. Open `index.html`
2. Find:
   ```js
   const GOOGLE_CLIENT_ID = "REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
   ```
3. Paste your real Client ID in its place
4. Save, re-upload to GitHub

### Step 4 — Put the same Client ID in your Worker
1. Open `worker/wrangler.toml`
2. Find:
   ```toml
   GOOGLE_CLIENT_ID = "REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
   ```
3. Paste the same Client ID
4. Save, then redeploy:
   ```bash
   cd worker
   npx wrangler deploy
   ```

### Step 5 — Test it
1. Open your app's GitHub Pages link
2. You should see a black **"Sign in with Google"** button in the new **Sync** card
3. Sign in with the Google account you added as a test user in Part 3, Step 1
4. It should say "Signed in as you@gmail.com"
5. Add an expense, then open the same link in a private/incognito window and sign in with the same account — your data should appear there too

✅ **Check yourself:** sign in on two different browsers with the same Google account — same budget data on both.

---

## Quick troubleshooting index

| Symptom | Likely cause | Fix |
|---|---|---|
| App doesn't load on GitHub Pages | Just uploaded, needs a minute | Wait, hard refresh (Ctrl+Shift+R) |
| `manifest.json` 404s | File missing or in wrong folder | Re-upload to repo root, check exact spelling |
| AI buttons say "AI request failed" | Worker not deployed, or wrong `WORKER_URL` | Re-check Part 2, Steps 7-9 |
| "Could not reach sync server" | Old `worker.js` deployed, or `WORKER_URL` wrong | Redeploy Worker, double check the URL in `index.html` |
| Google Sign-In button doesn't appear | Wrong `GOOGLE_CLIENT_ID`, or origin mismatch | Check Part 3 Step 2's Authorized JavaScript origin matches exactly |
| Sign-in shows a Google warning screen | Consent screen still in Testing mode | Add your account under Test users, or Publish the app |

## Order matters if you're troubleshooting

Always verify in this order: **1) Is the file actually on GitHub? → 2) Does the Worker respond to `curl`? → 3) Does the app's code point to the right URLs?** Nine times out of ten, an error traces back to one of these three, tested in this order.
