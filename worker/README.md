# Budget Passbook — AI Proxy Worker

This is the backend that lets your app's AI features (auto-categorize,
insights, chat) work for every user without them needing their own
Anthropic API key. It holds *your* key secretly and enforces a daily
limit per device so no one can run up unlimited spend on your account.

## 1. Install Wrangler (Cloudflare's CLI)

```bash
npm install -g wrangler
```

## 2. Log in to Cloudflare (free account is fine)

```bash
wrangler login
```

## 3. Create the KV namespace (used for rate limiting)

```bash
cd worker
wrangler kv namespace create RATE_LIMIT_KV
```

This prints an `id`. Copy it into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

## 4. Add your Anthropic API key as a secret

Get a key at https://console.anthropic.com/settings/keys if you don't
have one, then:

```bash
wrangler secret put ANTHROPIC_API_KEY
```

Paste the key when prompted. It's encrypted at rest by Cloudflare and
never appears in your code or GitHub repo.

## 5. Deploy

```bash
wrangler deploy
```

This prints a URL like:

```
https://budget-passbook-ai.yourname.workers.dev
```

## 6. Point the app at your Worker

In `index.html`, find this line near the top of the `<script>` block:

```js
const WORKER_URL = "https://budget-passbook-ai.YOUR-SUBDOMAIN.workers.dev";
```

Replace it with the URL from step 5, then re-deploy `index.html` to
GitHub Pages (or wherever you host it) as usual.

## 7. (Recommended) Lock down CORS

By default `wrangler.toml` allows requests from any origin (`"*"`),
which is fine for testing. Once you know your final hosted URL
(e.g. `https://yourusername.github.io`), set it in `wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGIN = "https://yourusername.github.io"
```

Then `wrangler deploy` again. This stops other websites from using
your Worker (and your API budget) without permission.

## Adjusting the daily free limit

Open `worker.js` and change:

```js
const RATE_LIMIT_PER_DAY = 20;
```

to whatever you're comfortable subsidizing per user per day.

## Cost estimate

Cloudflare Workers: free tier covers 100,000 requests/day — plenty for
a personal or early-stage app. Your only real cost is Anthropic API
usage, roughly ₹1–3 per active user per month at moderate use with the
current model choices (Haiku for quick categorization, Sonnet for
insights and chat). Keep an eye on usage at
https://console.anthropic.com/settings/usage.
