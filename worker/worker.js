/**
 * Budget Passbook — Backend Worker
 *
 * Jobs:
 *   POST /ai                → proxies AI requests to Anthropic (holds your API key secretly)
 *   POST /verify-purchase   → checks a Play Billing purchase token against Google's
 *                             servers, so entitlement can't be faked on the phone
 *   POST /sync/pull         → returns this user's saved budget data, if any
 *   POST /sync/push         → saves this user's budget data, keyed to their Google account
 *
 * Deploy: see README.md in this folder.
 */

const RATE_LIMIT_PER_DAY = 20;           // free AI actions per device per day (trial/unsubscribed)
const MAX_TOKENS_CAP = 600;
const ALLOWED_MODELS = new Set([
  "claude-haiku-4-5-20251001",
  "claude-sonnet-5"
]);

const ENTITLED_STATES = new Set([
  "SUBSCRIPTION_STATE_ACTIVE",
  "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
]);

const MAX_SYNC_PAYLOAD_BYTES = 200 * 1024; // 200KB is generous for a JSON budget blob

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);

    if (request.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405, env);
    }

    if (url.pathname === "/verify-purchase") {
      return handleVerifyPurchase(request, env);
    }
    if (url.pathname === "/sync/pull") {
      return handleSyncPull(request, env);
    }
    if (url.pathname === "/sync/push") {
      return handleSyncPush(request, env);
    }

    // Default / "/ai" — existing AI proxy behaviour
    return handleAiProxy(request, env);
  }
};

// ============================================================
// AI proxy (unchanged behaviour, just moved into its own function)
// ============================================================
async function handleAiProxy(request, env) {
  const deviceId = request.headers.get("x-device-id");
  if (!deviceId || deviceId.length > 100) {
    return jsonResponse({ error: "missing_device_id" }, 400, env);
  }

  const today = new Date().toISOString().slice(0, 10);
  const rlKey = `rl:${deviceId}:${today}`;
  const countStr = await env.RATE_LIMIT_KV.get(rlKey);
  const count = countStr ? parseInt(countStr, 10) : 0;

  if (count >= RATE_LIMIT_PER_DAY) {
    return jsonResponse({ error: "rate_limited", limit: RATE_LIMIT_PER_DAY }, 429, env);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "bad_request" }, 400, env);
  }

  if (!ALLOWED_MODELS.has(body.model)) {
    return jsonResponse({ error: "invalid_model" }, 400, env);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonResponse({ error: "invalid_messages" }, 400, env);
  }

  // Only the web_search tool is allowed through (used by the Plan It feature).
  // This stops a modified client from requesting arbitrary/expensive tool use.
  if (body.tools) {
    const allowedToolTypes = new Set(["web_search_20250305"]);
    const allTypesOk = body.tools.every(t => allowedToolTypes.has(t.type));
    if (!allTypesOk) {
      return jsonResponse({ error: "invalid_tools" }, 400, env);
    }
  }

  body.max_tokens = Math.min(Number(body.max_tokens) || 300, MAX_TOKENS_CAP);

  let anthropicRes;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    return jsonResponse({ error: "upstream_network_error" }, 502, env);
  }

  if (anthropicRes.ok) {
    await env.RATE_LIMIT_KV.put(rlKey, String(count + 1), { expirationTtl: 60 * 60 * 26 });
  }

  const data = await anthropicRes.text();
  return new Response(data, {
    status: anthropicRes.status,
    headers: { ...corsHeaders(env), "content-type": "application/json" }
  });
}

// ============================================================
// Purchase verification — checks with Google, caches briefly
// ============================================================
async function handleVerifyPurchase(request, env) {
  const deviceId = request.headers.get("x-device-id");
  if (!deviceId || deviceId.length > 100) {
    return jsonResponse({ error: "missing_device_id" }, 400, env);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "bad_request" }, 400, env);
  }

  const { purchaseToken, subscriptionId, packageName } = body;
  if (!purchaseToken || !subscriptionId || !packageName) {
    return jsonResponse({ error: "missing_fields" }, 400, env);
  }

  // Basic sanity limit so this endpoint can't be hammered either
  const today = new Date().toISOString().slice(0, 10);
  const vlKey = `vf:${deviceId}:${today}`;
  const vCountStr = await env.RATE_LIMIT_KV.get(vlKey);
  const vCount = vCountStr ? parseInt(vCountStr, 10) : 0;
  if (vCount >= 100) {
    return jsonResponse({ error: "rate_limited" }, 429, env);
  }
  await env.RATE_LIMIT_KV.put(vlKey, String(vCount + 1), { expirationTtl: 60 * 60 * 26 });

  try {
    const accessToken = await getGoogleAccessToken(env);
    const apiUrl =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/` +
      `${encodeURIComponent(purchaseToken)}`;

    const res = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();

    if (!res.ok) {
      return jsonResponse(
        { entitled: false, error: (data.error && data.error.message) || "verify_failed" },
        200,
        env
      );
    }

    const state = data.subscriptionState;
    const entitled = ENTITLED_STATES.has(state);
    const lineItem = (data.lineItems && data.lineItems[0]) || {};

    return jsonResponse(
      {
        entitled,
        state,
        expiryTime: lineItem.expiryTime || null,
        productId: (lineItem.productId) || subscriptionId
      },
      200,
      env
    );
  } catch (e) {
    return jsonResponse({ entitled: false, error: "verification_error" }, 500, env);
  }
}

// ---- Google OAuth2 (service account JWT flow) ----
// Caches the access token in KV for ~50 minutes since tokens are valid 1 hour,
// so we're not re-signing a JWT on every single verification call.
async function getGoogleAccessToken(env) {
  const cached = await env.RATE_LIMIT_KV.get("google:access_token");
  if (cached) return cached;

  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const encHeader = base64url(JSON.stringify(header));
  const encClaim = base64url(JSON.stringify(claim));
  const signingInput = `${encHeader}.${encClaim}`;

  const key = await importPrivateKey(sa.private_key);
  const signatureBuf = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64urlFromBuffer(signatureBuf)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body:
      `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}` +
      `&assertion=${encodeURIComponent(jwt)}`
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error("Failed to get Google access token: " + JSON.stringify(tokenData));
  }

  await env.RATE_LIMIT_KV.put("google:access_token", tokenData.access_token, {
    expirationTtl: 50 * 60
  });

  return tokenData.access_token;
}

async function importPrivateKey(pem) {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(pemContents);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function base64url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64urlFromBuffer(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ============================================================
// Cross-device sync (Google Sign-In)
// ============================================================

// Verifies an ID token by asking Google directly — simpler and more reliable
// than manually checking JWT signatures ourselves, at the cost of one extra
// network call per sync. Fine for this app's traffic level.
async function verifyGoogleIdToken(env, idToken) {
  if (!idToken) return null;
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (data.aud !== env.GOOGLE_CLIENT_ID) return null; // token wasn't issued for this app
  if (!data.sub) return null;
  return data; // includes sub, email, name, exp, etc.
}

async function handleSyncPull(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "bad_request" }, 400, env);
  }

  const claims = await verifyGoogleIdToken(env, body.idToken);
  if (!claims) return jsonResponse({ error: "invalid_token" }, 401, env);

  const raw = await env.RATE_LIMIT_KV.get(`userdata:${claims.sub}`);
  return jsonResponse(
    { data: raw ? JSON.parse(raw) : null, email: claims.email },
    200,
    env
  );
}

async function handleSyncPush(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "bad_request" }, 400, env);
  }

  const claims = await verifyGoogleIdToken(env, body.idToken);
  if (!claims) return jsonResponse({ error: "invalid_token" }, 401, env);

  const serialized = JSON.stringify(body.data || {});
  if (serialized.length > MAX_SYNC_PAYLOAD_BYTES) {
    return jsonResponse({ error: "payload_too_large" }, 413, env);
  }

  // Light rate limiting so this can't be hammered either
  const today = new Date().toISOString().slice(0, 10);
  const slKey = `sync:${claims.sub}:${today}`;
  const sCountStr = await env.RATE_LIMIT_KV.get(slKey);
  const sCount = sCountStr ? parseInt(sCountStr, 10) : 0;
  if (sCount >= 500) {
    return jsonResponse({ error: "rate_limited" }, 429, env);
  }
  await env.RATE_LIMIT_KV.put(slKey, String(sCount + 1), { expirationTtl: 60 * 60 * 26 });

  await env.RATE_LIMIT_KV.put(`userdata:${claims.sub}`, serialized);
  return jsonResponse({ ok: true }, 200, env);
}

// ============================================================
// Shared helpers
// ============================================================
function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-device-id"
  };
}

function jsonResponse(obj, status, env) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(env), "content-type": "application/json" }
  });
}
