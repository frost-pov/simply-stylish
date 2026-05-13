// POST JSON order — appends to Netlify Blobs. View privately via orders.html
// with Bearer ADMIN_ORDERS_TOKEN (same value in Netlify env). No subscriptions or
// third-party messengers required.
//
// Optional: GOOGLE_APPS_SCRIPT_ORDER_URL → POST JSON to your own Apps Script / Sheet.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BLOB_STORE = "ss-orders";
const ORDERS_KEY = "orders.json";

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
