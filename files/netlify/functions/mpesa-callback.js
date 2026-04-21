// Safaricom calls this URL after the customer completes or cancels STK on the phone.

const BLOB_STORE = "ss-orders";
const ORDERS_KEY = "orders.json";
const MAP_KEY = "mpesa-map.json";

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

async function loadMap() {
  const store = await blobStore();
  try {
    const raw = await store.get(MAP_KEY, { type: "json" });
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

async function saveMap(map) {
  const store = await blobStore();
  await store.set(MAP_KEY, JSON.stringify(map));
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ResultCode: 0, ResultDesc: "accepted" }),
    };
  }

  const cb = payload.Body && payload.Body.stkCallback;
  if (!cb) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ResultCode: 0, ResultDesc: "accepted" }),
    };
  }

  const checkoutId = cb.CheckoutRequestID;
  const resultCode = Number(cb.ResultCode);
  const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
  const find = (name) => {
    const it = items.find((x) => x.Name === name);
    return it ? it.Value : null;
  };
  const receipt = find("MpesaReceiptNumber");

  try {
    const map = await loadMap();
    const orderId = checkoutId ? map[checkoutId] : null;

    if (orderId) {
      const orders = await loadOrders();
      const idx = orders.findIndex((o) => o.id === orderId);
      if (idx >= 0) {
        orders[idx].paymentStatus = resultCode === 0 ? "paid" : "failed";
        orders[idx].mpesaReceiptNumber = receipt || null;
        orders[idx].checkoutRequestId = checkoutId;
        await saveOrders(orders);
      }
      if (checkoutId && map[checkoutId]) {
        delete map[checkoutId];
        await saveMap(map);
      }
    }
  } catch (e) {
    console.error("mpesa-callback", e);
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }),
  };
};
