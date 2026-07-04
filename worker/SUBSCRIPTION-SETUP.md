# Setting Up ₹50/month Subscriptions — Step by Step

Do this **after** you've already got your app live on Play Store (even in
Internal Testing) using the PWABuilder `.aab`, and **after** you've deployed
the updated Worker and `index.html` from this batch of files.

You cannot test real purchases until your app is uploaded to at least
Internal Testing on Play Console — Play Billing does not work in a browser.

---

## Part A — Create the subscription in Play Console

1. Go to **Play Console → your app → Monetize → Subscriptions**
2. Click **Create subscription**
3. Product ID: `premium_monthly` (must match exactly — this is already set in `index.html` and `worker.js`)
4. Name: `Budget Passbook Premium`
5. Add a base plan:
   - Billing period: **Monthly**
   - Price: **₹50**
   - Renewal type: **Auto-renewing**
6. Save and **activate** the subscription

---

## Part B — Create a Google Cloud service account (so your Worker can check purchases)

This lets your Cloudflare Worker ask Google "is this purchase real and still active?" without exposing anything to users.

1. Go to **console.cloud.google.com**
2. If you don't have a project linked to your Play Console yet, Play Console will have already created one automatically — check under **Play Console → Setup → API access**
3. On that **API access** page, click **Choose a project** (or it'll show your linked project) → click **Create new service account** (this takes you to Google Cloud Console)
4. In Google Cloud Console:
   - Click **Create Service Account**
   - Name it: `budget-passbook-billing`
   - Click **Create and Continue**, then **Done** (no roles needed here — permissions are granted in Play Console instead)
5. Click on the service account you just created → **Keys** tab → **Add Key → Create new key** → choose **JSON** → **Create**
6. A `.json` file downloads to your computer. **Keep this safe — it's a secret credential.**
7. Go back to **Play Console → Setup → API access**, find your new service account in the list, click **Grant access**
8. Give it these permissions:
   - **View financial data**
   - **View app information** (read-only)
9. Save

---

## Part C — Give the Worker your service account key

1. Open the downloaded `.json` file in a text editor
2. Select all, copy everything
3. In your terminal, inside the `worker` folder:
   ```bash
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
   ```
4. Paste the entire JSON content when prompted, press Enter

Also make sure your Anthropic key secret is still set (from earlier):
```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Then redeploy:
```bash
npx wrangler deploy
```

---

## Part D — Switch to Bubblewrap (needed to enable Play Billing)

PWABuilder's simple packaging doesn't expose the Play Billing toggle, so we switch to Bubblewrap — Google's own CLI tool. Same idea as before, just a different tool.

### Install Bubblewrap
```bash
npm install -g @bubblewrap/cli
```
(If you hit the same permissions error as with wrangler, use `npx @bubblewrap/cli <command>` instead of installing globally — same fix as before.)

### Initialize the project
```bash
bubblewrap init --manifest https://yourusername.github.io/budget-passbook/manifest.json
```
It'll ask several questions — for **Application ID**, use something like:
```
com.yourname.budgetpassbook
```
**Copy this exact value into `PACKAGE_NAME` in your `index.html`** (find the line near the top of the `<script>` section) and re-upload `index.html` to GitHub.

### ⚠️ Critical: reuse your EXISTING signing key

When Bubblewrap asks about the signing key, **do not let it generate a new one**. You already have a signing key from PWABuilder — Play Store requires every update to be signed with the *same* key, or it will reject the upload entirely as a "different app."

When prompted, point Bubblewrap at your existing keystore file (the one you saved from PWABuilder) instead of creating a new one.

### Enable Play Billing

Open the file `twa-manifest.json` that Bubblewrap created, and add:
```json
"features": {
  "playBilling": {
    "enabled": true
  }
},
"alphaDependencies": {
  "enabled": true
}
```

### Build
```bash
bubblewrap build
```
This produces a new `.aab` file, signed with your existing key.

---

## Part E — Upload and test

1. Go to **Play Console → Testing → Internal testing → Create release**
2. Upload the new `.aab` from Bubblewrap
3. Save, review, roll out to internal testing
4. **Add yourself as a license tester**: Play Console → Setup → License testing → add your Google account email. This lets you make real purchases that Google automatically refunds, so testing doesn't cost you money.
5. Install the app fresh from your internal testing link on your phone
6. Wait past the 3-day trial (or temporarily lower `TRIAL_DAYS` to `0` in `index.html` just for testing, then set it back to `3` before going live)
7. Tap **Subscribe** — you should see Google's real payment sheet open
8. Complete the test purchase, confirm the AI features unlock

---

## Adjusting things later

- **Change the price**: Play Console → Monetize → Subscriptions → edit the base plan
- **Change the trial length**: edit `TRIAL_DAYS` in `index.html`
- **Change free daily AI limit for trial users**: edit `RATE_LIMIT_PER_DAY` in `worker.js`

## If something's wrong

Test the verification endpoint directly, same way we tested the AI one earlier:
```bash
curl -X POST https://budget-passbook-ai.yourname.workers.dev/verify-purchase \
  -H "content-type: application/json" \
  -H "x-device-id: test123" \
  -d '{"purchaseToken":"fake","subscriptionId":"premium_monthly","packageName":"com.yourname.budgetpassbook"}'
```
A real error message back (not a crash) means the Worker and Google credentials are wired up correctly — it'll just say the fake token is invalid, which is expected.
