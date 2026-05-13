// POST JSON order — appends to Netlify Blobs (merchant-visible via /api/orders-list).
// Optional: GOOGLE_APPS_SCRIPT_ORDER_URL duplicates rows to a Sheet.
//
// After save, optional stakeholder pings (never sent in the API response to browsers):
//   — NOTIFY_STORE_MSISDN / NOTIFY_COMMISSION_MSISDN override defaults (254… or 07…).
//   — AFRICASTALKING_USERNAME + AFRICASTALKING_API_KEY sends SMS to both.
//   — ORDER_NOTIFY_WEBHOOK (+ optional ORDER_NOTIFY_WEBHOOK_SECRET): e.g. Make.com → WhatsApp.
// Internal/commission recipient must never be rendered on the site; only this function uses it.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BLOB_STORE = "ss-orders";
const ORDERS_KEY = "orders.json";

const DEFAULT_STORE_MSISDN = "254723526004";
const DEFAULT_COMMISSION_MSISDN = "254797123659";

/** Match checkout display (manual Pay Bill). */
const PAYBILL_DISPLAY = "Paybill 522533 · Acc 8109810";

async function blobStore() {
  const { getStore } = await import("@netlify/blobs");
  return getStore(BLOB_STORE);
}

async function loadOrders() {
  const store = await blobStore();
  try {
    const raw = await store.get(ORDERS_KEY, { type: "json" });
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function saveOrders(orders) {
  const store = await blobStore();
  await store.set(ORDERS_KEY, JSON.stringify(orders.slice(0, 300)));
}

function normalizeMsisdn254(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 9) d = "254" + d.slice(1);
  if (d.startsWith("7") && d.length === 9) d = "254" + d;
  if (d.startsWith("254")) return d.length >= 12 ? d : "";
  return "";
}

function summarizeLines(order) {
  const lines = Array.isArray(order.lines) ? order.lines : [];
  return lines
    .slice(0, 6)
    .map((l) => `${l.name || "Item"} ×${l.qty || 0}`)
    .join(", ");
}

function buildShopSms(order) {
  const who = order.fullName || "Customer";
  const tel = order.phone || "—";
  const amt = Number(order.amount || 0).toLocaleString("en-KE");
  const where = order.fulfillment === "delivery" ? "Delivery" : "Pickup";
  const items = summarizeLines(order);
  return `Simply Stylish: NEW ORDER ${order.id}. ${who} ${tel}. ${where}. KSh ${amt}. Customer uses WhatsApp checkout + ${PAYBILL_DISPLAY}. ${items}`.slice(
    0,
    470,
  );
}

function buildCommissionSms(order) {
  const amt = Number(order.amount || 0).toLocaleString("en-KE");
  const tel = order.phone || "—";
  return `SS internal: order ${order.id} KSh ${amt}. Cust ${tel}. (Shop gets customer WhatsApp draft; this is your silent copy.)`.slice(
    0,
    470,
  );
}

function waMeLink(msisdn, text, maxChars = 950) {
  const t = text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
  let u = `https://wa.me/${msisdn}?text=${encodeURIComponent(t)}`;
  if (u.length > 2000) u = `https://wa.me/${msisdn}?text=${encodeURIComponent(t.slice(0, 400) + "…")}`;
  return u;
}

async function postOrderNotifyWebhook(order, storeMsisdn, commissionMsisdn, shopMsg, commissionMsg) {
  const url = (process.env.ORDER_NOTIFY_WEBHOOK || "").trim();
  if (!url) return;
  const secret = (process.env.ORDER_NOTIFY_WEBHOOK_SECRET || "").trim();
  try {
    const headers = { "Content-Type": "application/json" };
    if (secret) headers["X-Webhook-Secret"] = secret;

    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        event: "order_created",
        order,
        notifications: {
          store: {
            msisdn: storeMsisdn,
            message: shopMsg,
            whatsappDeepLink: waMeLink(storeMsisdn, shopMsg),
          },
          commission: {
            msisdn: commissionMsisdn,
            message: commissionMsg,
            internalOnly: true,
            whatsappDeepLink: waMeLink(commissionMsisdn, commissionMsg),
          },
        },
      }),
    });
  } catch (e) {
    console.error("order_notify_webhook", e);
  }
}

async function sendAfricaTalkingSms(to254, message) {
  const username = (process.env.AFRICASTALKING_USERNAME || "").trim();
  const apiKey = (process.env.AFRICASTALKING_API_KEY || "").trim();
  if (!username || !apiKey) return;
  const params = new URLSearchParams({ username, to: `+${to254}`, message });
  const from = (process.env.AFRICASTALKING_SENDER_ID || "").trim();
  if (from) params.append("from", from);
  try {
    const res = await fetch("https://api.africastalking.com/version1/messaging", {
      method: "POST",
      headers: {
        apiKey,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) console.error("africastalking_sms", res.status, text.slice(0, 200));
  } catch (e) {
    console.error("africastalking_sms", e);
  }
}

async function notifyOrderStakeholders(order) {
  const storeMsisdn =
    normalizeMsisdn254(process.env.NOTIFY_STORE_MSISDN) || DEFAULT_STORE_MSISDN;
  const commissionMsisdn =
    normalizeMsisdn254(process.env.NOTIFY_COMMISSION_MSISDN) || DEFAULT_COMMISSION_MSISDN;

  const shopMsg = buildShopSms(order);
  const commissionMsg = buildCommissionSms(order);

  await postOrderNotifyWebhook(order, storeMsisdn, commissionMsisdn, shopMsg, commissionMsg);

  await sendAfricaTalkingSms(storeMsisdn, shopMsg);
  await sendAfricaTalkingSms(commissionMsisdn, commissionMsg);
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "{}" };
  }

  let order;
  try {
    order = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: "invalid_json" }) };
  }

  if (!order.id || order.amount == null) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: "missing_id_or_amount" }) };
  }

  const row = {
    ...order,
    paymentStatus: "pending",
    mpesaReceiptNumber: null,
    checkoutRequestId: null,
  };

  try {
    const orders = await loadOrders();
    orders.unshift(row);
    await saveOrders(orders);
  } catch (e) {
    console.error("orders-create", e);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: "storage_failed" }) };
  }

  try {
    await notifyOrderStakeholders(row);
  } catch (e) {
    console.error("orders-create_notify", e);
  }

  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_ORDER_URL;
  if (scriptUrl) {
    try {
      await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
      });
    } catch (e) {
      console.error("apps_script", e);
    }
  }

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({ ok: true, orderId: order.id }),
  };
};
