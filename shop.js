/* ================================================================
   SIMPLY STYLISH THRIFT STORE — shop.js
   ================================================================ */

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSDFNTENnTQYHsKFMie3oWgbB7fKObYJeMHJdkYcXvTdGe54bCb3Ydx9Ss_RQkS0Gd3Bi0K78qzKm9n/pub?gid=0&single=true&output=csv";
const PER_PAGE = 24;
const CATEGORY_EMOJIS = {
  Tops:"👕", Bottoms:"👖", Dresses:"👗",
  Outerwear:"🧥", Shoes:"👟", Accessories:"👜"
};

let allItems = [], filtered = [], currentFilter = "All", currentSearch = "", currentPage = 1;
let qvCurrentItem = null;
const CART_KEY = "ss_cart";
const ORDERS_KEY = "ss_orders";

/** Shop owner WhatsApp (public). Never use NOTIFY_COMMISSION / internal lines as customer contacts. */
const SHOP_ORDER_MSISDN = "254723526004";
const SHOP_ORDERS_PHONE_LABEL = "0723 526 004";

/** Till / Paybill displayed at checkout (Lipa na M-Pesa → Pay Bill). */
const MPESA_PAYBILL = "522533";
const MPESA_PAYBILL_ACCOUNT = "8109810";

/**
 * Ledger-only line — must match server NOTIFY_COMMISSION default. Block if typed as customer's own number by mistake.
 */
const INTERNAL_LEDGER_MSISDN = "254797123659";

/** Stable id for cart lines (sheet has no SKU). */
function lineIdForItem(item) {
  const n = (item.name || "").trim();
  const s = (item.size || "").trim();
  return `${n}|||${s}`;
}

function priceFromItem(item) {
  const n = item.price_numeric;
  return typeof n === "number" && !isNaN(n) ? n : 0;
}


/* ================================================================
   BOOT
   ================================================================ */
document.addEventListener("DOMContentLoaded", () => {
  buildModal();
  buildCartDrawer();
  loadSheet();
});


/* ================================================================
   QUICK VIEW MODAL
   Injected once into the page on load.
   Opens when a card is clicked, closes on ✕ / overlay / Escape.
   ================================================================ */
function buildModal() {
  const overlay = document.createElement("div");
  overlay.id = "qvOverlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" id="qvModal">
      <button class="modal-close" id="qvClose">✕</button>
      <div class="modal-img"  id="qvImg"></div>
      <div class="modal-body">
        <p  class="modal-category" id="qvCat"></p>
        <h2 class="modal-name"     id="qvName"></h2>
        <div class="modal-divider"></div>
        <p  class="modal-price"    id="qvPrice"></p>
        <span class="modal-size"   id="qvSize"></span>
        <p  class="modal-desc"     id="qvDesc"></p>
        <button type="button" class="btn btn-primary modal-add-cart" id="qvAddCart">Add to bag</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById("qvClose").addEventListener("click", closeModal);
  document.getElementById("qvAddCart").addEventListener("click", e => {
    e.stopPropagation();
    if (qvCurrentItem) {
      addToCart(qvCurrentItem);
      closeModal();
      openCart();
    }
  });
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
}

function openModal(item) {
  qvCurrentItem = item;
  const emoji = CATEGORY_EMOJIS[item.category] || "🛍";

  document.getElementById("qvCat").textContent   = item.category   || "";
  document.getElementById("qvName").textContent  = item.name       || "";
  document.getElementById("qvPrice").textContent = item.price      || "";
  document.getElementById("qvDesc").textContent  = item.description|| "";

  const sizeEl = document.getElementById("qvSize");
  sizeEl.textContent    = item.size ? "Size: " + item.size : "";
  sizeEl.style.display  = item.size ? "inline-block" : "none";

  const imgEl = document.getElementById("qvImg");
  imgEl.innerHTML = item.image_url
    ? `<img src="${item.image_url}" alt="${item.name}">`
    : `<div class="modal-emoji">${emoji}</div>`;

  document.getElementById("qvOverlay").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  document.getElementById("qvOverlay").classList.remove("open");
  document.body.style.overflow = "";
}


/* ================================================================
   CART & CHECKOUT
   Cart: localStorage (ss_cart). Orders POST to Netlify; customer finishes on WhatsApp
   with Paybill details (no Daraja STK from the browser).
   ================================================================ */
function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function getCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCart(lines) {
  try { localStorage.setItem(CART_KEY, JSON.stringify(lines)); } catch {}
  updateCartBadge();
}

function updateCartBadge() {
  const lines = getCart();
  const n = lines.reduce((sum, L) => sum + (L.qty || 0), 0);
  const badge = document.getElementById("cartBadge");
  if (!badge) return;
  badge.textContent = n > 99 ? "99+" : String(n);
  badge.hidden = n === 0;
}

function cartSubtotal(lines) {
  return lines.reduce((sum, L) => sum + (L.price_numeric || 0) * (L.qty || 0), 0);
}

function snapItemToCartLine(item) {
  return {
    lineId: lineIdForItem(item),
    name: item.name || "Item",
    price: item.price || "",
    price_numeric: priceFromItem(item),
    image_url: item.image_url || "",
    category: item.category || "",
    size: item.size || "",
    qty: 1,
  };
}

function addToCart(item) {
  const lines = getCart();
  const lineId = lineIdForItem(item);
  const idx = lines.findIndex(L => L.lineId === lineId);
  if (idx >= 0) lines[idx].qty = (lines[idx].qty || 0) + 1;
  else lines.push(snapItemToCartLine(item));
  saveCart(lines);
  renderCartBody();
}

function setLineQty(lineId, qty) {
  const q = Math.max(0, Math.min(99, parseInt(qty, 10) || 0));
  let lines = getCart().map(L => ({ ...L }));
  const idx = lines.findIndex(L => L.lineId === lineId);
  if (idx < 0) return;
  if (q === 0) lines.splice(idx, 1);
  else lines[idx].qty = q;
  saveCart(lines);
  renderCartBody();
}

function removeLine(lineId) {
  setLineQty(lineId, 0);
}

function resetCheckoutSuccessUI() {
  const main = document.getElementById("checkoutFlowMain");
  const succ = document.getElementById("checkoutFlowSuccess");
  const form = document.getElementById("checkoutForm");
  const wa = document.getElementById("successWhatsApp");
  if (main) main.hidden = false;
  if (succ) succ.hidden = true;
  if (form) form.reset();
  if (wa) {
    wa.hidden = true;
    wa.href = "#";
  }
}

function openCart() {
  resetCheckoutSuccessUI();
  showCartView();
  const el = document.getElementById("cartOverlay");
  if (el) {
    el.classList.add("open");
    document.body.style.overflow = "hidden";
  }
}

function closeCart() {
  const el = document.getElementById("cartOverlay");
  if (el) {
    el.classList.remove("open");
    document.body.style.overflow = "";
  }
}

function showCartView() {
  const cartEl = document.getElementById("cartDrawerCart");
  const coEl = document.getElementById("cartDrawerCheckout");
  if (cartEl) cartEl.hidden = false;
  if (coEl) coEl.hidden = true;
}

function showCheckoutView() {
  const cartEl = document.getElementById("cartDrawerCart");
  const coEl = document.getElementById("cartDrawerCheckout");
  if (cartEl) cartEl.hidden = true;
  if (coEl) coEl.hidden = false;
}

function renderCartBody() {
  const lines = getCart();
  const listEl = document.getElementById("cartLines");
  const subEl = document.getElementById("cartSubtotal");
  const emptyEl = document.getElementById("cartEmpty");
  if (!listEl || !subEl) return;

  const sub = cartSubtotal(lines);
  subEl.textContent = "KSh " + sub.toLocaleString(undefined, { maximumFractionDigits: 0 });

  if (emptyEl) emptyEl.hidden = lines.length > 0;

  const coBtn = document.getElementById("gotoCheckout");
  if (coBtn) coBtn.disabled = lines.length === 0;

  if (lines.length === 0) {
    listEl.innerHTML = "";
    return;
  }

  listEl.innerHTML = lines.map(L => `
    <div class="cart-line" data-line-id="${encodeURIComponent(L.lineId)}">
      <div class="cart-line-img">
        ${L.image_url
          ? `<img src="${escapeHtml(L.image_url)}" alt="">`
          : `<span>${CATEGORY_EMOJIS[L.category] || "🛍"}</span>`}
      </div>
      <div class="cart-line-info">
        <div class="cart-line-name">${escapeHtml(L.name)}</div>
        ${L.size ? `<div class="cart-line-meta">Size: ${escapeHtml(L.size)}</div>` : ""}
        <div class="cart-line-price">${escapeHtml(L.price)} · ×${L.qty}</div>
        <div class="cart-line-actions">
          <button type="button" class="qty-btn" data-act="dec" aria-label="Decrease quantity">−</button>
          <span class="qty-val">${L.qty}</span>
          <button type="button" class="qty-btn" data-act="inc" aria-label="Increase quantity">+</button>
          <button type="button" class="cart-remove" data-act="remove">Remove</button>
        </div>
      </div>
    </div>
  `).join("");

  listEl.querySelectorAll(".cart-line").forEach(row => {
    const id = decodeURIComponent(row.getAttribute("data-line-id") || "");
    row.querySelectorAll("button[data-act]").forEach(btn => {
      btn.addEventListener("click", () => {
        const act = btn.getAttribute("data-act");
        const line = getCart().find(x => x.lineId === id);
        const q = line ? line.qty : 0;
        if (act === "inc") setLineQty(id, q + 1);
        else if (act === "dec") setLineQty(id, q - 1);
        else if (act === "remove") removeLine(id);
      });
    });
  });
}

/**
 * Kenyan mobile digits for WhatsApp links / normalization.
 */
function normalizePhone254(phoneRaw) {
  let d = String(phoneRaw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 9) d = "254" + d.slice(1);
  if (d.startsWith("7") && d.length === 9) d = "254" + d;
  return d;
}

function fulfillmentHuman(value) {
  if (value === "delivery") return "Delivery — we'll contact you for delivery details.";
  return "Store pickup — Star Mall B8.";
}

/**
 * Polished WhatsApp draft to the shop owner only (commission copy is handled on the server, never surfaced here).
 */
function buildProfessionalOrderDraft(order) {
  const kes = "KSh";
  const total = Number(order.amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const code = ((order.mpesaConfirmationCode || "") + "").trim().toUpperCase() || "—";
  const ref = order.id || "—";

  const itemLines = (order.lines || [])
    .map((L) => {
      const sub = ((L.price_numeric || 0) * (L.qty || 0)).toLocaleString(undefined, {
        maximumFractionDigits: 0,
      });
      const sz = L.size ? ` (${L.size})` : "";
      return `• ${L.name || "Item"}${sz}  ×${L.qty || 1}     ${kes} ${sub}`;
    })
    .join("\n");

  const parts = [
    "Hello — thank you for ordering with Simply Stylish Thrift.",
    "",
    `Order reference: ${ref}`,
    `Name: ${order.fullName}`,
    `Mobile / WhatsApp: ${order.phone}`,
    "",
  ];
  if (order.email && String(order.email).trim())
    parts.push(`Email: ${String(order.email).trim()}`, "");

  parts.push(`Fulfillment: ${fulfillmentHuman(order.fulfillment)}`, "");
  parts.push("Items", itemLines || "• (See admin if lines were truncated)", "");
  parts.push(`Order total: ${kes} ${total}`, "");
  parts.push("Payment — M-Pesa Pay Bill");
  parts.push(`Paybill: ${MPESA_PAYBILL}`);
  parts.push(`Account: ${MPESA_PAYBILL_ACCOUNT}`);
  parts.push(`Amount: ${kes} ${total}`);
  parts.push(`M-Pesa confirmation code: ${code}`);
  parts.push("", "Customer notes:");

  if (order.notes && String(order.notes).trim()) parts.push(`${String(order.notes).trim()}`, "");
  else parts.push("(none)", "");

  parts.push(
    "We're glad to confirm against this SMS code. Reply on this chat if you'd like pickup time or sizing tweaks.",
    "",
    "Warm regards,",
    "Simply Stylish · Star Mall B8",
  );

  return parts.join("\n").trim();
}

function buildOwnerWhatsAppUrl(order) {
  const draft = buildProfessionalOrderDraft(order);
  const safeText = draft.length <= 1580 ? draft : draft.slice(0, 1570) + "…";

  const num = normalizePhone254(SHOP_ORDER_MSISDN);
  const base = num ? `https://wa.me/${num}` : "";
  let url = `${base}?text=${encodeURIComponent(safeText)}`;

  const maxLen = 2000;
  if (url.length > maxLen && base) {
    const total = Number(order.amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
    const code = ((order.mpesaConfirmationCode || "") + "").trim().toUpperCase();
    const short = [
      "Simply Stylish Thrift · order summary",
      `Ref: ${order.id}`,
      `${order.fullName} · ${order.phone}`,
      `Fulfillment: ${fulfillmentHuman(order.fulfillment)}`,
      `Total KSh ${total}`,
      `M-Pesa code: ${code}`,
      `Paybill ${MPESA_PAYBILL} · Acc ${MPESA_PAYBILL_ACCOUNT}`,
      "Tap send — full details reached you if URL length allows.",
    ].join("\n");
    url = `${base}?text=${encodeURIComponent(short)}`;
  }

  return url;
}
async function postOrderToServer(order) {
  try {
    const res = await fetch("/api/orders-create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || "save_failed" };
    return { ok: !!data.ok, orderId: data.orderId };
  } catch (e) {
    console.warn("postOrderToServer", e);
    return { ok: false, error: "network" };
  }
}


function appendOrder(order) {
  try {
    const prev = JSON.parse(localStorage.getItem(ORDERS_KEY) || "[]");
    const arr = Array.isArray(prev) ? prev : [];
    arr.unshift(order);
    localStorage.setItem(ORDERS_KEY, JSON.stringify(arr.slice(0, 50)));
  } catch {}
}

function buildCartDrawer() {
  const wrap = document.createElement("div");
  wrap.id = "cartOverlay";
  wrap.className = "cart-overlay";
  wrap.innerHTML = `
    <aside class="cart-drawer" id="cartDrawer" aria-label="Shopping bag">
      <div class="cart-head">
        <h2 class="cart-title">Your bag</h2>
        <button type="button" class="cart-close" id="cartClose" aria-label="Close">✕</button>
      </div>
      <div class="cart-panel" id="cartDrawerCart">
        <div class="cart-empty" id="cartEmpty">
          <p>Your bag is empty.</p>
          <a href="#shop" class="btn btn-outline cart-browse">Browse the shop</a>
        </div>
        <div class="cart-lines" id="cartLines"></div>
        <div class="cart-footer">
          <div class="cart-subtotal-row">
            <span>Subtotal</span>
            <strong id="cartSubtotal">KSh 0</strong>
          </div>
          <p class="cart-note">Pickup at Star Mall or delivery cleared on WhatsApp. Questions? <a class="cart-note-phone" href="https://wa.me/${SHOP_ORDER_MSISDN}" target="_blank" rel="noopener noreferrer">${SHOP_ORDERS_PHONE_LABEL}</a></p>
          <button type="button" class="btn btn-primary cart-checkout-btn" id="gotoCheckout" disabled>Checkout</button>
        </div>
      </div>
      <div class="cart-panel cart-checkout" id="cartDrawerCheckout" hidden>
        <div id="checkoutFlowMain">
          <button type="button" class="cart-back" id="checkoutBack">← Back to bag</button>
          <p class="section-label checkout-label-top">Almost there</p>
          <h3 class="checkout-heading">Details &amp; payment</h3>
          <aside class="checkout-shop-line" aria-label="Shop WhatsApp">
            <strong>Shop WhatsApp</strong>
            <a class="checkout-shop-phone" href="https://wa.me/${SHOP_ORDER_MSISDN}" target="_blank" rel="noopener noreferrer">${SHOP_ORDERS_PHONE_LABEL}</a>
            <span class="checkout-shop-meta">When you confirm your order we open WhatsApp here with your items, pickup or delivery choice, and Paybill details—all in one message for the shop owner.</span>
          </aside>
          <section class="checkout-paybill" aria-label="M-Pesa paybill details">
            <h4 class="checkout-paybill-title">M-Pesa Pay Bill</h4>
            <dl class="checkout-paybill-rows">
              <div class="checkout-paybill-row"><dt>Paybill</dt><dd><span class="checkout-paybill-num">${MPESA_PAYBILL}</span></dd></div>
              <div class="checkout-paybill-row"><dt>Account</dt><dd><span class="checkout-paybill-num">${MPESA_PAYBILL_ACCOUNT}</span></dd></div>
            </dl>
            <p class="checkout-paybill-hint">On your phone: Lipa na M-Pesa → Pay Bill, then use the total in the summary below. The same Paybill line is included in the WhatsApp message we open for you.</p>
          </section>
          <form class="checkout-form" id="checkoutForm">
            <label class="form-field">
              <span>Full name</span>
              <input type="text" name="fullName" required autocomplete="name" placeholder="Your name"/>
            </label>
            <label class="form-field">
              <span>WhatsApp / mobile number</span>
              <input type="tel" name="phone" required autocomplete="tel" placeholder="07XX XXX XXX"/>
              <small class="form-hint">We use this to reach you about pickup or delivery. Use the number you use on WhatsApp if you can.</small>
            </label>
            <label class="form-field">
              <span>Email <em class="optional">(optional)</em></span>
              <input type="email" name="email" autocomplete="email" placeholder="you@example.com"/>
            </label>
            <label class="form-field">
              <span>How do you want to receive?</span>
              <select name="fulfillment">
                <option value="pickup">Store pickup (Star Mall B8)</option>
                <option value="delivery">Delivery (we’ll contact you)</option>
              </select>
            </label>
            <label class="form-field">
              <span>Notes</span>
              <textarea name="notes" rows="3" placeholder="Preferred pickup time, delivery area, etc."></textarea>
            </label>
            <div class="checkout-summary" id="checkoutSummary"></div>
            <label class="form-field">
              <span>M-Pesa confirmation code</span>
              <input
                type="text"
                name="mpesaConfirmationCode"
                required
                maxlength="32"
                autocomplete="one-time-code"
                class="checkout-mpesa-code"
                placeholder="From your M-Pesa SMS after Pay Bill"
              />
              <small class="form-hint">Paste the confirmation code from the M-Pesa message you get right after paying (so we can verify your payment).</small>
            </label>
            <button type="submit" class="btn btn-primary checkout-submit" id="placeOrderBtn">Place order &amp; open WhatsApp</button>
            <p class="checkout-whatsapp-note" id="whatsappHint">Pay with M-Pesa Pay Bill (above), paste your confirmation code from the M-Pesa SMS, then submit. We open WhatsApp with everything included—send that message so we can verify and prep your order.</p>
          </form>
        </div>
        <div class="checkout-success" id="checkoutFlowSuccess" hidden>
          <div class="checkout-success-icon">✓</div>
          <h3>Order placed</h3>
          <p>Your reference: <strong id="successOrderId"></strong></p>
          <p class="checkout-success-body" id="successMsg"></p>
          <a class="btn btn-primary checkout-success-wa" id="successWhatsApp" href="#" target="_blank" rel="noopener noreferrer" hidden>Open WhatsApp with this order</a>
          <button type="button" class="btn btn-primary checkout-success-done" id="cartDone">Done</button>
        </div>
      </div>
    </aside>`;
  document.body.appendChild(wrap);

  document.getElementById("cartBtn").addEventListener("click", () => openCart());
  document.getElementById("cartClose").addEventListener("click", () => closeCart());
  wrap.addEventListener("click", e => { if (e.target === wrap) closeCart(); });
  document.getElementById("gotoCheckout").addEventListener("click", () => {
    if (getCart().length === 0) return;
    resetCheckoutSuccessUI();
    renderCheckoutSummary();
    showCheckoutView();
  });
  document.getElementById("checkoutBack").addEventListener("click", () => showCartView());
  document.getElementById("checkoutForm").addEventListener("submit", submitCheckout);
  document.getElementById("cartDone").addEventListener("click", () => {
    resetCheckoutSuccessUI();
    closeCart();
  });

  wrap.querySelector(".cart-browse")?.addEventListener("click", () => closeCart());

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && wrap.classList.contains("open")) closeCart();
  });

  updateCartBadge();
  renderCartBody();
}

function renderCheckoutSummary() {
  const lines = getCart();
  const sub = cartSubtotal(lines);
  const el = document.getElementById("checkoutSummary");
  if (!el) return;
  el.innerHTML = lines.map(L => `
    <div class="checkout-line">${escapeHtml(L.name)} × ${L.qty} · <strong>KSh ${(L.price_numeric * L.qty).toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
  `).join("") + `<div class="checkout-total">Total <strong>KSh ${sub.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>`;

  const btn = document.getElementById("gotoCheckout");
  if (btn) btn.disabled = lines.length === 0;
}

async function submitCheckout(e) {
  e.preventDefault();
  const lines = getCart();
  if (lines.length === 0) return;

  const form = e.target;
  const btn = document.getElementById("placeOrderBtn");
  const prevText = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Processing…";
  }

  const fd = new FormData(form);
  const fullName = (fd.get("fullName") || "").toString().trim();
  const phone = (fd.get("phone") || "").toString().trim();
  const email = (fd.get("email") || "").toString().trim();
  const fulfillment = (fd.get("fulfillment") || "pickup").toString();
  const notes = (fd.get("notes") || "").toString().trim();
  const mpesaConfirmationCode = (fd.get("mpesaConfirmationCode") || "").toString().trim().toUpperCase().replace(/\s+/g, "");
  const amount = cartSubtotal(lines);
  const id = "SS-" + Date.now().toString(36).toUpperCase();

  const cust254 = normalizePhone254(phone);
  if (!cust254 || cust254.length < 12) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevText;
    }
    alert("Please enter a valid Kenyan mobile number so we can reach you about pickup or delivery.");
    return;
  }
  if (cust254 === INTERNAL_LEDGER_MSISDN) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevText;
    }
    alert(
      "That number is used for Simply Stylish internal records only.\nPlease enter your personal mobile — the WhatsApp draft still goes straight to our shop.",
    );
    return;
  }

  const order = {
    id,
    createdAt: new Date().toISOString(),
    fullName,
    phone,
    email,
    fulfillment,
    notes,
    mpesaConfirmationCode,
    amount,
    lines: lines.map(L => ({
      name: L.name,
      qty: L.qty,
      price_numeric: L.price_numeric,
      size: L.size,
    })),
  };

  appendOrder(order);

  const waUrl = buildOwnerWhatsAppUrl(order);
  const saved = await postOrderToServer(order);

  saveCart([]);
  renderCartBody();
  form.reset();

  if (btn) {
    btn.disabled = false;
    btn.textContent = prevText;
  }

  const main = document.getElementById("checkoutFlowMain");
  const succ = document.getElementById("checkoutFlowSuccess");
  const sid = document.getElementById("successOrderId");
  const smsg = document.getElementById("successMsg");
  const waBtn = document.getElementById("successWhatsApp");
  if (waBtn) {
    waBtn.href = waUrl;
    waBtn.hidden = !waUrl;
  }
  if (main) main.hidden = true;
  if (succ) succ.hidden = false;
  if (sid) sid.textContent = id;

  let msg =
    "We tried to open WhatsApp with your order, pickup/delivery choice, items, total, and Paybill details ready to send. Tap Send in WhatsApp so the shop sees it.";
  if (!saved.ok) {
    msg =
      "We could not reach the server to store this order on our side—check your connection. Your bag was cleared here. Use the button below to open WhatsApp and send the draft so the shop still gets the details.";
  }
  if (smsg) smsg.textContent = msg;

  if (waUrl) {
    window.open(waUrl, "_blank", "noopener,noreferrer");
  }
}


/* ================================================================
   LIKE SYSTEM
   Stored in localStorage as:
     { "Item Name": { count: Number, likedByMe: Boolean } }
   When user accounts are added, swap the localStorage calls
   for API calls — the structure is already ready.
   ================================================================ */
function getLikes() {
  try { return JSON.parse(localStorage.getItem("ss_likes") || "{}"); }
  catch { return {}; }
}

function saveLikes(data) {
  try { localStorage.setItem("ss_likes", JSON.stringify(data)); }
  catch {}
}

function toggleLike(itemName, btn) {
  // Stop the card click from firing the modal
  const likes = getLikes();
  if (!likes[itemName]) likes[itemName] = { count: 0, likedByMe: false };

  if (likes[itemName].likedByMe) {
    likes[itemName].count    = Math.max(0, likes[itemName].count - 1);
    likes[itemName].likedByMe = false;
    btn.classList.remove("liked");
  } else {
    likes[itemName].count    += 1;
    likes[itemName].likedByMe = true;
    btn.classList.add("liked");
  }

  btn.querySelector(".like-count").textContent = likes[itemName].count || "";
  saveLikes(likes);
}


/* ================================================================
   FETCH & PARSE GOOGLE SHEET CSV
   ================================================================ */
async function loadSheet() {
  showStatus("⏳", "Loading inventory…", "Fetching your items…");
  try {
    const res     = await fetch(SHEET_URL);
    const csvText = await res.text();
    const rows    = parseCSV(csvText);

    allItems = rows.filter(row => {
      const v = (row.available || "").toLowerCase().trim();
      return v === "yes" || v === "true";
    });

    applyFilters();
  } catch (err) {
    showStatus("⚠️", "Couldn't load inventory", "Please refresh and try again.");
    console.error("loadSheet error:", err);
  }
}

function parseCSV(text) {
  const lines   = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, "").toLowerCase());

  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = [];
    let inQ = false, cur = "";
    for (const ch of line) {
      if (ch === '"')            { inQ = !inQ; }
      else if (ch === "," && !inQ) { vals.push(cur.trim()); cur = ""; }
      else                       { cur += ch; }
    }
    vals.push(cur.trim());

    const row = {};
    headers.forEach((h, i) => {
      let v = (vals[i] || "").replace(/"/g, "").trim();
      if (h === "category") v = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
      if (h === "price") {
        const rawStr = String(v).replace(/[^\d.-]/g, "");
        const num = parseFloat(rawStr);
        row.price_numeric = isNaN(num) ? 0 : num;
        if (!isNaN(num) && rawStr !== "") v = "KSh " + num.toLocaleString();
      }
      row[h] = v;
    });
    return row;
  });
}


/* ================================================================
   FILTER & SEARCH
   ================================================================ */
function setFilter(category) {
  currentFilter = category;
  currentPage   = 1;
  document.querySelectorAll(".filter-btn").forEach(b =>
    b.classList.toggle("active", b.textContent === category)
  );
  applyFilters();
}

function handleSearch() {
  currentSearch = document.getElementById("searchInput").value.toLowerCase();
  currentPage   = 1;
  applyFilters();
}

function applyFilters() {
  filtered = allItems.filter(item => {
    const mc = currentFilter === "All" || item.category === currentFilter;
    const ms = !currentSearch ||
      (item.name        || "").toLowerCase().includes(currentSearch) ||
      (item.description || "").toLowerCase().includes(currentSearch) ||
      (item.size        || "").toLowerCase().includes(currentSearch) ||
      (item.category    || "").toLowerCase().includes(currentSearch);
    return mc && ms;
  });
  renderPage();
}


/* ================================================================
   RENDER ITEM GRID
   ================================================================ */
function renderPage() {
  const grid    = document.getElementById("itemsGrid");
  const countEl = document.getElementById("resultsCount");
  const total   = filtered.length;
  const totalPages = Math.ceil(total / PER_PAGE);

  if (currentPage > totalPages) currentPage = 1;

  if (total === 0) {
    grid.innerHTML    = `<div class="shop-status"><div class="big-icon">🔍</div><strong>No items found</strong><p>Try a different search or filter.</p></div>`;
    countEl.textContent = "";
    renderPagination(0);
    return;
  }

  const start     = (currentPage - 1) * PER_PAGE;
  const pageItems = filtered.slice(start, start + PER_PAGE);

  countEl.textContent = `Showing ${start + 1}–${Math.min(start + PER_PAGE, total)} of ${total} item${total !== 1 ? "s" : ""}`;
  grid.innerHTML      = pageItems.map((item, i) => buildCard(item, i)).join("");

  // Attach click → modal on the card, but NOT on the like button
  grid.querySelectorAll(".item-card").forEach((card, i) => {
    card.addEventListener("click", () => openModal(pageItems[i]));
  });
  grid.querySelectorAll(".card-add-cart").forEach((btn, i) => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      addToCart(pageItems[i]);
    });
  });

  renderPagination(totalPages);
}

function buildCard(item, index) {
  const emoji = CATEGORY_EMOJIS[item.category] || "🛍";

  const imgHTML = item.image_url
    ? `<img src="${item.image_url}" alt="${item.name}" loading="lazy" onerror="this.style.display='none'">`
    : `<span style="font-size:3.5rem">${emoji}</span>`;

  const sizeBadge     = item.size ? `<span class="item-size">${item.size}</span>` : "";
  const featuredBadge = (item.featured || "").toLowerCase() === "yes"
    ? `<span class="featured-badge">★ Featured</span>` : "";

  const likes     = getLikes();
  const ld        = likes[item.name] || { count: 0, likedByMe: false };
  const likedCls  = ld.likedByMe ? "liked" : "";
  const likeCount = ld.count || "";

  return `
    <div class="item-card" style="animation-delay:${index * 0.06}s">
      <div class="item-img">
        ${imgHTML}
        <span class="item-cat-tag">${item.category || ""}</span>
        ${featuredBadge}
        <div class="quick-view-hint">Tap to view</div>
        <button type="button" class="card-add-cart" title="Add to bag">＋ Bag</button>
        <button class="like-btn ${likedCls}"
          onclick="event.stopPropagation(); toggleLike(${JSON.stringify(item.name || "")}, this)">
          <span class="heart">♥</span>
          <span class="like-count">${likeCount}</span>
        </button>
      </div>
      <div class="item-info">
        <div class="item-name">${item.name || "Item"}</div>
        <div class="item-desc">${item.description || ""}</div>
        <div class="item-footer">
          <span class="item-price">${item.price || ""}</span>
          ${sizeBadge}
        </div>
      </div>
    </div>`;
}


/* ================================================================
   PAGINATION
   ================================================================ */
function renderPagination(total) {
  const el = document.getElementById("pagination");
  if (total <= 1) { el.innerHTML = ""; return; }

  let html = `<button class="page-btn" onclick="goPage(${currentPage - 1})" ${currentPage === 1 ? "disabled" : ""}>‹</button>`;

  for (let i = 1; i <= total; i++) {
    const near = Math.abs(i - currentPage) <= 1;
    const edge = i === 1 || i === total;
    if (!near && !edge) {
      if (i === 2 || i === total - 1) html += `<span style="padding:0 4px;color:var(--tan)">…</span>`;
      continue;
    }
    html += `<button class="page-btn ${i === currentPage ? "active" : ""}" onclick="goPage(${i})">${i}</button>`;
  }

  html += `<button class="page-btn" onclick="goPage(${currentPage + 1})" ${currentPage === total ? "disabled" : ""}>›</button>`;
  el.innerHTML = html;
}

function goPage(n) {
  currentPage = n;
  document.getElementById("shop").scrollIntoView({ behavior: "smooth", block: "start" });
  applyFilters();
}


/* ================================================================
   HELPERS
   ================================================================ */
function showStatus(icon, title, body) {
  document.getElementById("itemsGrid").innerHTML  = `<div class="shop-status"><div class="big-icon">${icon}</div><strong>${title}</strong><p>${body}</p></div>`;
  document.getElementById("resultsCount").textContent = "";
  document.getElementById("pagination").innerHTML     = "";
}
