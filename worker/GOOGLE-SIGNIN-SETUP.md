# Setting Up Google Sign-In — Step by Step

This connects the "Sign in with Google" button in the app to a real Google
OAuth Client ID, and tells your Worker how to verify sign-ins are genuine.

---

## Part A — Create an OAuth Client ID

1. Go to **console.cloud.google.com**
2. If you don't already have a project (you may from the subscription setup earlier), select or create one
3. Go to **APIs & Services → OAuth consent screen**
   - User type: **External**
   - Fill in app name (`Budget Passbook`), your email, and a support email
   - Scopes: the defaults (email, profile) are enough — no need to add more
   - Add your own Google account under **Test users** if the app is still in "Testing" mode (this lets you sign in yourself before publishing the consent screen)
   - Save
4. Go to **APIs & Services → Credentials**
5. Click **Create Credentials → OAuth client ID**
6. Application type: **Web application**
7. Name: `Budget Passbook Web`
8. Under **Authorized JavaScript origins**, add your exact hosted URL (no trailing slash, no path):
   ```
   https://yourusername.github.io
   ```
9. Click **Create**
10. Copy the **Client ID** shown — it looks like:
    ```
    123456789-abc123def456.apps.googleusercontent.com
    ```

---

## Part B — Put the Client ID in your app

1. Open `index.html`
2. Find this line near the top of the `<script>` section:
   ```js
   const GOOGLE_CLIENT_ID = "REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
   ```
3. Replace it with your real Client ID from Part A
4. Save, and upload this updated `index.html` to GitHub

---

## Part C — Put the same Client ID in your Worker

The Worker needs to know your Client ID too, so it can confirm sign-in
tokens were actually issued for *your* app and not someone else's.

1. Open `worker/wrangler.toml`
2. Find this line:
   ```toml
   GOOGLE_CLIENT_ID = "REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
   ```
3. Replace with the same Client ID
4. Save, then redeploy:
   ```bash
   cd worker
   npx wrangler deploy
   ```

---

## Part D — Test it

1. Open your app's GitHub Pages URL
2. You should see a black "Sign in with Google" pill button in the new **Sync** card
3. Sign in with your Google account
4. It should show "Signed in as you@gmail.com"
5. Add an expense, then open the same URL in a different browser (or incognito window) and sign in with the same account — your data should appear there too

---

## How the conflict screen works

If you sign in on a second device that already has its own budget data
(not just the empty defaults), the app will ask which version to keep —
the cloud copy or the one already on that device. This only happens when
both sides have real data that differs; otherwise it merges automatically
in the sensible direction (empty device silently adopts cloud data, empty
cloud silently receives the device's data).

## Publishing the consent screen (before going live to real users)

While your OAuth consent screen is in "Testing" mode, only the test users
you added in Part A can sign in — anyone else sees a warning. Before your
Play Store release goes public:

1. Go back to **OAuth consent screen**
2. Click **Publish App**
3. For sensitive/restricted scopes Google may require verification — the
   basic `email` and `profile` scopes used here typically don't require
   this, but Google will tell you if something more is needed

## If sign-in fails silently

Open your browser's developer console (F12) while testing — Google Identity
Services logs the actual reason there (e.g. "origin not authorized"), which
usually means the Authorized JavaScript origin in Part A doesn't exactly
match your hosted URL.
