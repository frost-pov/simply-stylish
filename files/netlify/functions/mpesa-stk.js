// STK Push — requires Daraja env vars (sandbox or production).
// MPESA_SHORTCODE must match your live Paybill/Till (e.g. same number shown at checkout Pay Bill).

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BLOB_STORE = "ss-orders";
const MAP_KEY = "mpesa-map.json";

async function loadMap() {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore(BLOB_STORE);
  try {
    const raw = await store.get(MAP_KEY, { type: "json" });
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

async function saveMap(map) {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore(BLOB_STORE);
  await store.set(MAP_KEY, JSON.stringify(map));
}

function normalizePhone254(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 9) d = "254" + d.slice(1);
  if (d.startsWith("7") && d.length === 9) d = "254" + d;
  return d;
}

async function getAccessToken(baseUrl) {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  const res = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(data.errorMessage || data.error_description || JSON.stringify(data));
  }
  return data.access_token;
}

function stkResponseOk(data) {
  const code = data.ResponseCode ?? data.responseCode;
  return code === "0" || code === 0;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "{}" };
  }

  if (!process.env.MPESA_CONSUMER_KEY || !process.env.MPESA_SHORTCODE || !process.env.MPESA_PASSKEY) {
    return {
      statusCode: 503,
      headers: cors,
      body: JSON.stringify({ ok: false, code: "MPESA_NOT_CONFIGURED" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: "invalid_json" }) };
  }

  const orderId = body.orderId;
  const amount = Number(body.amount);
  const phone254 = normalizePhone254(body.phone);

  if (!orderId || !phone254 || phone254.length < 12 || amount < 1) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "invalid_order_phone_or_amount" }),
    };
  }

  const baseUrl = (process.env.MPESA_BASE_URL || "https://sandbox.safaricom.co.ke").replace(/\/$/, "");
  const shortcode = String(process.env.MPESA_SHORTCODE).trim();
  const passkey = process.env.MPESA_PASSKEY;
  const siteUrl = (process.env.URL || process.env.DEPLOY_PRIME_URL || "").replace(/\/$/, "");
  const cbUrl =
    (process.env.MPESA_CALLBACK_URL || "").trim() ||
    (siteUrl ? `${siteUrl}/.netlify/functions/mpesa-callback` : "");

  if (!cbUrl) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "missing_callback_url_set_URL_or_MPESA_CALLBACK_URL" }),
    };
  }

  const timestamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0].replace("T", "");
  const pwd = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
  const amt = Math.round(amount);
  const shortNum = parseInt(shortcode, 10);

  try {
    const token = await getAccessToken(baseUrl);
    const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: shortNum,
        Password: pwd,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: String(amt),
        PartyA: parseInt(phone254, 10),
        PartyB: shortNum,
        PhoneNumber: parseInt(phone254, 10),
        CallBackURL: cbUrl,
        AccountReference: String(orderId).slice(0, 12),
        TransactionDesc: "SimplyStylish",
      }),
    });

    const stkData = await stkRes.json();

    if (!stkResponseOk(stkData)) {
      const msg = stkData.ResponseDescription || stkData.errorMessage || stkData.error || "stk_failed";
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ ok: false, error: msg, raw: stkData }),
      };
    }

    const checkoutId = stkData.CheckoutRequestID || stkData.checkoutRequestId;
    if (!checkoutId) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ ok: false, error: "no_checkout_id", raw: stkData }),
      };
    }

    const map = await loadMap();
    map[checkoutId] = orderId;
    await saveMap(map);

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        checkoutRequestId: checkoutId,
        customerMessage: stkData.CustomerMessage || stkData.ResponseDescription || "",
      }),
    };
  } catch (e) {
    console.error("mpesa-stk", e);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ ok: false, error: e.message || "stk_error" }),
    };
  }
};
