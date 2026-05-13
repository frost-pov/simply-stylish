// POST JSON order — appends to Netlify Blobs (merchant-visible via /api/orders-list).
// Optional: GOOGLE_APPS_SCRIPT_ORDER_URL duplicates rows to a Sheet.
//
// After save, optional stakeholder pings (never sent in the API response to browsers):
//   — NOTIFY_STORE_MSISDN / NOTIFY_COMMISSION_MSISDN override defaults (254… or 07…).
//   — AFRICASTALKING_USERNAME + AFRICASTALKING_API_KEY → SMS to store + ledger numbers.
//   — ORDER_NOTIFY_WEBHOOK (+ optional ORDER_NOTIFY_WEBHOOK_SECRET): e.g. Make.com → WhatsApp.
//   — CALLMEBOT_LEDGER_APIKEY → WhatsApp text to NOTIFY_COMMISSION (register 0797… once at callmebot.com).
// Ledger/internal copy is never returned to browsers; configure at least one channel or you will not receive records off-site.

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

/** Short SMS / internal summaries (neutral). */
function fulfillmentPhrase(order) {
  if ((order.fulfillment || "").toString() === "delivery") {
    return "Delivery — coordinate address.";
  }
  return "Pickup Star Mall B8.";
}

/** Customer voice — matches storefront WhatsApp prefill (`shop.js`). */
function fulfillmentCustomerDm(order) {
  if ((order.fulfillment || "").toString() === "delivery") {
    return "I'd like delivery — I'll share address / directions in this chat if you reply.";
  }
  return "I'll pick up from Star Mall B8.";
}

/** Same wording as storefront WhatsApp draft (server-side mirror). */
function professionalMarkdownOrder(order) {
  const kes = "KSh";
  const total = Number(order.amount || 0).toLocaleString("en-KE");
  const code = ((order.mpesaConfirmationCode || "") + "").trim().toUpperCase() || "—";
  const ref = order.id || "—";
  const itemLines = (order.lines || [])
    .map((l) => {
      const sub = ((l.price_numeric || 0) * (l.qty || 0)).toLocaleString("en-KE");
      const sz = l.size ? ` (${l.size})` : "";
      return `• ${l.name || "Item"}${sz}  ×${l.qty || 1}     ${kes} ${sub}`;
    })
    .join("\n");

  const parts = [
    "Hi Simply Stylish 👋 I've paid via M-Pesa Pay Bill and I'm sending my order details here.",
    "",
    `Checkout reference: ${ref}`,
    `My name: ${order.fullName || "—"}`,
    `Reach me on WhatsApp: ${order.phone || "—"}`,
    "",
  ];
  if (order.email && String(order.email).trim()) parts.push(`Email: ${String(order.email).trim()}`, "");

  parts.push(`How I'd like to receive it: ${fulfillmentCustomerDm(order)}`, "");
  parts.push("Items", itemLines || "• (no line detail)", "");
  parts.push(`Order total: ${kes} ${total}`, "");
  parts.push("M-Pesa Pay Bill details I used");
  parts.push("Paybill: 522533");
  parts.push("Account: 8109810");
  parts.push(`Amount: ${kes} ${total}`);
  parts.push(`M-Pesa confirmation code: ${code}`);
  parts.push("", "Notes:");
  parts.push(order.notes && String(order.notes).trim() ? String(order.notes).trim() : "(none)", "");
  parts.push(
    "Please confirm when you've matched this payment to my code. Happy to tweak pickup time or sizes if needed. Thanks!",
  );
  return parts.join("\n").trim();
}

function silentLedgerMarkdown(order) {
  return (
    "[Simply Stylish · internal ledger]\n" +
    "Duplicate of checkout (not visible on website). Same text customer sent to shop WhatsApp.\n\n" +
    professionalMarkdownOrder(order)
  );
}

/** Short copy for CallMeBot GET URL limits — still enough for records. */
function compactLedgerMessage(order) {
  const kes = "KSh";
  const total = Number(order.amount || 0).toLocaleString("en-KE");
  const code = ((order.mpesaConfirmationCode || "") + "").trim().toUpperCase() || "—";
  const itemLines = (order.lines || [])
    .slice(0, 12)
    .map((l) => {
      const sub = ((l.price_numeric || 0) * (l.qty || 0)).toLocaleString("en-KE");
      const sz = l.size ? ` (${l.size})` : "";
      return `${l.name || "Item"}${sz} ×${l.qty || 1} ${kes} ${sub}`;
    })
    .join("; ");
  const more = (order.lines || []).length > 12 ? ` …+${order.lines.length - 12} more` : "";
  const notes =
    order.notes && String(order.notes).trim() ? `\nNotes: ${String(order.notes).trim().slice(0, 180)}` : "";
  const email =
    order.email && String(order.email).trim() ? `\nEmail: ${String(order.email).trim()}` : "";
  const body =
    `[SS LEDGER]\n` +
    `Ref ${order.id}\n` +
    `${order.fullName || "—"} · ${order.phone || "—"}${email}\n` +
    `${fulfillmentPhrase(order)}\n` +
    `Total ${kes} ${total} · M-Pesa ${code}\n` +
    `${PAYBILL_DISPLAY}\n` +
    `Lines: ${itemLines}${more}${notes}`;
  return body.length <= 980 ? body : `${body.slice(0, 960)}…`;
}

function smsShopBrief(order) {
  const who = order.fullName || "Customer";
  const tel = order.phone || "—";
  const amt = Number(order.amount || 0).toLocaleString("en-KE");
  const code = (order.mpesaConfirmationCode || "—").toString();
  const where = (order.fulfillment || "").toString() === "delivery" ? "Delivery" : "Pickup";
  const items = summarizeLines(order);
  return `SS order ${order.id}: ${who} ${tel}. ${where}. KSh ${amt}. Code ${code}. ${PAYBILL_DISPLAY}. ${items}`.slice(
    0,
    470,
  );
}

function smsCommissionBrief(order) {
  const amt = Number(order.amount || 0).toLocaleString("en-KE");
  const code = (order.mpesaConfirmationCode || "—").toString();
  const tel = order.phone || "—";
  return `SS INTERNAL ${order.id} KSh ${amt} code:${code} cust:${tel} ${fulfillmentPhrase(order)}`.slice(0, 470);
}

function waMeLink(msisdn, text, maxChars = 950) {
  const t = text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
  let u = `https://wa.me/${msisdn}?text=${encodeURIComponent(t)}`;
  if (u.length > 2000) u = `https://wa.me/${msisdn}?text=${encodeURIComponent(t.slice(0, 400) + "…")}`;
  return u;
}

async function postOrderNotifyWebhook(order, storeMsisdn, commissionMsisdn) {
  const url = (process.env.ORDER_NOTIFY_WEBHOOK || "").trim();
  if (!url) return;
  const secret = (process.env.ORDER_NOTIFY_WEBHOOK_SECRET || "").trim();

  const shopSms = smsShopBrief(order);
  const shopDraft = professionalMarkdownOrder(order);
  const commissionSms = smsCommissionBrief(order);
  const commissionSilent = silentLedgerMarkdown(order);

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
            message: shopSms,
            smsSummary: shopSms,
            whatsappMerchantDraftMarkdown: shopDraft,
            whatsappDeepLink: waMeLink(storeMsisdn, shopDraft),
          },
          commission: {
            msisdn: commissionMsisdn,
            internalOnly: true,
            message: commissionSms,
            smsSummary: commissionSms,
            silentLedgerDraftMarkdown: commissionSilent,
            whatsappDeepLink: waMeLink(commissionMsisdn, commissionSilent),
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

async function sendLedgerWhatsAppCallMeBot(msisdn254, order) {
  const apikey = (process.env.CALLMEBOT_LEDGER_APIKEY || "").trim();
  if (!apikey || !msisdn254) return;

  let text = silentLedgerMarkdown(order);
  if (text.length > 900) text = compactLedgerMessage(order);

  const phone = `+${msisdn254}`;
  const u = new URL("https://api.callmebot.com/whatsapp.php");
  u.searchParams.set("phone", phone);
  u.searchParams.set("apikey", apikey);
  u.searchParams.set("text", text);

  if (u.toString().length > 3600) {
    u.searchParams.set("text", compactLedgerMessage(order));
  }

  try {
    const res = await fetch(u.toString(), { method: "GET" });
    const body = await res.text().catch(() => "");
    if (!res.ok) console.error("callmebot_ledger", res.status, body.slice(0, 200));
  } catch (e) {
    console.error("callmebot_ledger", e);
  }
}

async function notifyOrderStakeholders(order) {
  const storeMsisdn =
    normalizeMsisdn254(process.env.NOTIFY_STORE_MSISDN) || DEFAULT_STORE_MSISDN;
  const commissionMsisdn =
    normalizeMsisdn254(process.env.NOTIFY_COMMISSION_MSISDN) || DEFAULT_COMMISSION_MSISDN;

  const shopSms = smsShopBrief(order);
  const commissionSms = smsCommissionBrief(order);

  await postOrderNotifyWebhook(order, storeMsisdn, commissionMsisdn);

  await sendAfricaTalkingSms(storeMsisdn, shopSms);
  await sendAfricaTalkingSms(commissionMsisdn, commissionSms);
  await sendLedgerWhatsAppCallMeBot(commissionMsisdn, order);

  const hasAt =
    !!(process.env.AFRICASTALKING_USERNAME || "").trim() &&
    !!(process.env.AFRICASTALKING_API_KEY || "").trim();
  const hasHook = !!(process.env.ORDER_NOTIFY_WEBHOOK || "").trim();
  const hasCb = !!(process.env.CALLMEBOT_LEDGER_APIKEY || "").trim();
  if (!hasAt && !hasHook && !hasCb) {
    console.warn(
      "orders-create: no outbound notify channel (set CALLMEBOT_LEDGER_APIKEY, AFRICASTALKING_*, or ORDER_NOTIFY_WEBHOOK). Ledger MSISDN will not receive copies.",
    );
  }
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
