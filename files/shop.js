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


/* ================================================================
   BOOT
   ================================================================ */
document.addEventListener("DOMContentLoaded", () => {
  buildModal();
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
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById("qvClose").addEventListener("click", closeModal);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
}

function openModal(item) {
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
      if (h === "price" && v && !isNaN(v)) v = "KSh " + parseFloat(v).toLocaleString();
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
  const safeName  = item.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  return `
    <div class="item-card" style="animation-delay:${index * 0.06}s">
      <div class="item-img">
        ${imgHTML}
        <span class="item-cat-tag">${item.category || ""}</span>
        ${featuredBadge}
        <div class="quick-view-hint">Tap to view</div>
        <button class="like-btn ${likedCls}"
          onclick="event.stopPropagation(); toggleLike('${safeName}', this)">
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
