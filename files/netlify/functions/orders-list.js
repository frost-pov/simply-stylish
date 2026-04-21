// GET — list orders (Bearer ADMIN_ORDERS_TOKEN). Use orders.html to view.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const BLOB_STORE = "ss-orders";
const ORDERS_KEY = "orders.json";

async function loadOrders() {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore(BLOB_STORE);
  try {
    const raw = await store.get(ORDERS_KEY, { type: "json" });
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: cors, body: "{}" };
  }

  const auth = event.headers.authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const expected = process.env.ADMIN_ORDERS_TOKEN;

  if (!expected || token !== expected) {
    return {
      statusCode: 401,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "unauthorized" }),
    };
  }

  try {
    const orders = await loadOrders();
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true, orders }),
    };
  } catch (e) {
    console.error("orders-list", e);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "read_failed" }),
    };
  }
};
