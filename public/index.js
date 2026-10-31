const marketSelect = document.querySelector("#market-select");
const sessionSelect = document.querySelector("#session-select");
const categoryFilter = document.querySelector("#category-filter");
const zoneFilter = document.querySelector("#zone-filter");
const searchInput = document.querySelector("#public-search");
const mapCanvas = document.querySelector("#map-canvas");
const shopList = document.querySelector("#shop-list");
const authDialog = document.querySelector("#auth-dialog");
const authForm = document.querySelector("#auth-form");
const authMessage = document.querySelector("#auth-message");
const statusTitle = document.querySelector("#status-title");
const pageMessage = document.querySelector("#page-message");
const state = { marketId: null, sessionId: null, mode: "login", shops: [], stalls: [], debounce: null };
const STATUS_LABEL = { pending: "รอตรวจสอบ", confirmed: "ยืนยันแล้ว", rejected: "ไม่อนุมัติ", cancelled: "ยกเลิกแล้ว" };

async function api(url, options = {}) {
  const secureOptions = withCsrf(options);
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(secureOptions.headers || {}) },
    ...secureOptions,
  });
  const result = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    const error = new Error(result.error?.message || "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
    error.status = response.status;
    error.code = result.error?.code;
    error.fields = result.error?.fields || {};
    throw error;
  }
  return result;
}

function setMessage(element, message = "") { element.textContent = message; }
function makeOption(value, label) { const option = document.createElement("option"); option.value = value; option.textContent = label; return option; }
function setOptions(select, items, placeholder, valueKey, labelKey, selected = "") {
  select.replaceChildren(makeOption("", placeholder));
  for (const item of items) select.append(makeOption(item[valueKey], item[labelKey]));
  select.value = selected;
}
function escapeText(value = "") { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function readCookie(name) {
  const part = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}

function withCsrf(options = {}) {
  const method = (options.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return options;
  const csrfToken = readCookie("takhlad_csrf");
  return { ...options, headers: { ...(options.headers || {}), ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) } };
}

async function checkHealth() {
  try {
    const result = await api("/api/health");
    statusTitle.textContent = result.status === "ok" ? "ระบบพร้อมใช้งาน" : "ระบบกำลังตรวจสอบ";
  } catch {
    statusTitle.textContent = "กำลังรอฐานข้อมูล";
  }
}

async function loadMarkets() {
  try {
    const result = await api("/api/markets");
    setOptions(marketSelect, result.items, result.items.length ? "เลือกตลาด" : "ยังไม่มีตลาดที่เปิดใช้งาน", "id", "name");
    if (result.items.length) {
      marketSelect.value = String(result.items[0].id);
      state.marketId = result.items[0].id;
      await loadSessions();
    }
  } catch (error) {
    marketSelect.replaceChildren(makeOption("", "โหลดตลาดไม่สำเร็จ"));
    setMessage(pageMessage, error.message);
  }
}

async function loadSessions() {
  state.sessionId = null;
  mapCanvas.innerHTML = '<div class="map-empty">เลือกรอบตลาดเพื่อดูตำแหน่งร้านค้า</div>';
  shopList.innerHTML = '<div class="list-empty">เลือกรอบตลาดเพื่อค้นหาร้านค้า</div>';
  document.querySelector("#shop-count").textContent = "เลือกรอบตลาด";
  document.querySelector("#count-badge").textContent = "0";
  if (!state.marketId) return;
  try {
    const result = await api(`/api/markets/${state.marketId}/sessions`);
    setOptions(sessionSelect, result.items, result.items.length ? "เลือกวัน / รอบตลาด" : "ยังไม่มีรอบตลาด", "id", "session_name");
    if (result.items.length) {
      sessionSelect.value = String(result.items[0].id);
      state.sessionId = result.items[0].id;
      await loadPublicMap();
    }
  } catch (error) {
    setOptions(sessionSelect, [], error.message, "id", "session_name");
  }
}

function updateFilterOptions(filters = { categories: [], zones: [] }) {
  const category = categoryFilter.value;
  const zone = zoneFilter.value;
  setOptions(categoryFilter, filters.categories.map((name) => ({ id: name, name })), "ทุกประเภทสินค้า", "id", "name", category);
  setOptions(zoneFilter, filters.zones.map((name) => ({ id: name, name })), "ทุกโซน", "id", "name", zone);
}

function renderMap(items) {
  state.stalls = items;
  if (!items.length) {
    mapCanvas.innerHTML = '<div class="map-empty">ไม่พบแผงที่ตรงกับเงื่อนไข ลองล้างตัวกรอง</div>';
    return;
  }
  mapCanvas.replaceChildren();
  items.forEach(({ stall, shop }, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `stall-marker${shop ? " occupied" : ""}`;
    button.style.left = `${stall.map_x == null ? 12 + (index % 5) * 18 : Math.max(7, Math.min(93, Number(stall.map_x) * 100))}%`;
    button.style.top = `${stall.map_y == null ? 18 + (Math.floor(index / 5) % 4) * 19 : Math.max(10, Math.min(90, Number(stall.map_y) * 100))}%`;
    button.setAttribute("aria-label", `${stall.stall_code}, ${shop ? `ร้าน ${shop.shop_name}` : "แผงว่าง"}`);
    button.innerHTML = `<strong>${escapeText(stall.stall_code)}</strong><small>${shop ? "มีร้านค้า" : "ว่าง"}</small>`;
    button.addEventListener("click", () => shop ? showShop(shop, stall) : setMessage(pageMessage, `แผง ${stall.stall_code} ยังว่าง กรุณาเข้าสู่ระบบร้านค้าเพื่อส่งคำขอจอง.`));
    mapCanvas.append(button);
  });
}

function renderShops(items) {
  state.shops = items;
  document.querySelector("#shop-count").textContent = `${items.length} ร้านในรอบนี้`;
  document.querySelector("#count-badge").textContent = String(items.length);
  if (!items.length) {
    shopList.innerHTML = '<div class="list-empty">ยังไม่พบร้านค้า ลองเปลี่ยนคำค้นหาหรือตัวกรอง</div>';
    return;
  }
  shopList.replaceChildren();
  items.forEach((shop) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "shop-row";
    button.innerHTML = `<span class="shop-avatar" aria-hidden="true">${escapeText(shop.shop_name.slice(0, 1))}</span><span><strong>${escapeText(shop.shop_name)}</strong><small>${escapeText(shop.category)} · ${escapeText(shop.zone || "ตลาดนัด")}</small></span><span class="shop-stall">${escapeText(shop.stall_code)}</span>`;
    button.addEventListener("click", () => showShop(shop));
    shopList.append(button);
  });
}

function showShop(shop, stall) {
  const dialog = document.querySelector("#shop-dialog");
  const detail = document.querySelector("#shop-detail");
  detail.innerHTML = `<div class="detail-content"><span class="shop-avatar">${escapeText(shop.shop_name.slice(0, 1))}</span><h2>${escapeText(shop.shop_name)}</h2><p>${escapeText(shop.category)}${stall?.zone || shop.zone ? ` · ${escapeText(stall?.zone || shop.zone)}` : ""}${stall?.stall_code || shop.stall_code ? ` · แผง ${escapeText(stall?.stall_code || shop.stall_code)}` : ""}</p><p>${escapeText(shop.description || "ร้านค้าชุมชน ยินดีต้อนรับ")}</p>${shop.public_contact ? `<p>ติดต่อร้าน: ${escapeText(shop.public_contact)}</p>` : ""}</div>`;
  dialog.showModal();
}

async function loadPublicMap() {
  state.marketId = Number(marketSelect.value) || state.marketId;
  state.sessionId = Number(sessionSelect.value) || state.sessionId;
  if (!state.marketId || !state.sessionId) return;
  const params = new URLSearchParams();
  if (searchInput.value.trim()) params.set("q", searchInput.value.trim());
  if (categoryFilter.value) params.set("category", categoryFilter.value);
  if (zoneFilter.value) params.set("zone", zoneFilter.value);
  try {
    const [map, shops] = await Promise.all([
      api(`/api/markets/${state.marketId}/sessions/${state.sessionId}/map?${params}`),
      api(`/api/markets/${state.marketId}/sessions/${state.sessionId}/shops?${params}`),
    ]);
    state.mapFilters = map.filters;
    document.querySelector("#session-caption").textContent = `${map.market.name} · ${map.session.session_name}`;
    updateFilterOptions(map.filters);
    renderMap(map.items);
    renderShops(shops.items);
    setMessage(pageMessage);
  } catch (error) {
    mapCanvas.innerHTML = `<div class="map-empty">${escapeText(error.message)}</div>`;
    renderShops([]);
    setMessage(pageMessage, "โหลดข้อมูลตลาดไม่สำเร็จ กรุณาลองใหม่");
  }
}

function openAuth(mode = "login") {
  setAuthMode(mode);
  authMessage.textContent = "";
  authDialog.showModal();
}

function setAuthMode(mode) {
  state.mode = mode;
  const registering = mode === "register";
  document.querySelectorAll(".auth-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.authMode === mode));
  document.querySelector("#register-fields").hidden = !registering;
  document.querySelector("#auth-title").textContent = registering ? "เข้าร่วมเป็นร้านค้า" : "ยินดีต้อนรับกลับ";
  document.querySelector("#auth-description").textContent = registering ? "กรอกข้อมูลร้านเบื้องต้นเพื่อเริ่มต้นใช้งาน" : "เข้าสู่ระบบเพื่อจัดการข้อมูลร้านและการจองแผง";
  document.querySelector("#auth-submit").textContent = registering ? "สมัครร้านค้า" : "เข้าสู่ระบบ";
  authForm.elements.password.autocomplete = registering ? "new-password" : "current-password";
  authForm.elements.password.minLength = registering ? 10 : 1;
  authMessage.textContent = "";
}

async function submitAuth(event) {
  event.preventDefault();
  const form = new FormData(authForm);
  const body = Object.fromEntries(form.entries());
  const registering = state.mode === "register";
  const endpoint = registering ? "/api/shop/register" : "/api/shop/login";
  const submit = document.querySelector("#auth-submit");
  submit.disabled = true;
  submit.textContent = "กำลังดำเนินการ…";
  authMessage.textContent = "";
  try {
    await api(endpoint, { method: "POST", body: JSON.stringify(body) });
    authDialog.close();
    authForm.reset();
    await showShopDashboard();
  } catch (error) {
    authMessage.textContent = error.message;
    if (error.fields) authMessage.textContent += ` (${Object.values(error.fields).join(" · ")})`;
  } finally {
    submit.disabled = false;
    submit.textContent = registering ? "สมัครร้านค้า" : "เข้าสู่ระบบ";
  }
}

async function showShopDashboard() {
  try {
    const { shop } = await api("/api/shop/me");
    const dialog = document.querySelector("#shop-dialog");
    const detail = document.querySelector("#shop-detail");
    detail.innerHTML = `<div class="detail-content"><p class="eyebrow">SHOP SPACE</p><h2>สวัสดี ${escapeText(shop.shop_name)}</h2><p>จัดการข้อมูลร้านและติดตามคำขอจองของคุณ</p><div class="auth-tabs"><button class="auth-tab active" data-dashboard="bookings">รายการจอง</button><button class="auth-tab" data-dashboard="profile">ข้อมูลร้าน</button></div><div id="dashboard-content"><p>กำลังโหลดรายการจอง…</p></div><button class="button button-outline" data-action="logout">ออกจากระบบ</button></div>`;
    detail.querySelectorAll("[data-dashboard]").forEach((tab) => tab.addEventListener("click", () => {
      detail.querySelectorAll("[data-dashboard]").forEach((item) => item.classList.toggle("active", item === tab));
    }));
    detail.querySelector('[data-dashboard="bookings"]').addEventListener("click", () => loadBookings(detail, shop));
    detail.querySelector('[data-dashboard="profile"]').addEventListener("click", () => renderProfile(detail, shop));
    detail.querySelector('[data-action="logout"]').addEventListener("click", logoutShop);
    await loadBookings(detail, shop);
    dialog.showModal();
    document.querySelector(".header-login").textContent = shop.shop_name;
  } catch {
    openAuth("login");
  }
}

async function loadBookings(container, shop) {
  const target = container.querySelector("#dashboard-content");
  try {
    const result = await api("/api/shop/bookings");
    if (!result.items.length) { target.innerHTML = '<div class="list-empty">ยังไม่มีรายการจอง เลือกตลาดและรอบเพื่อหาแผงที่เหมาะกับร้าน</div>'; return; }
    target.innerHTML = result.items.map((booking) => `<article class="booking-card"><strong>${escapeText(booking.stall.stall_code)} · ${escapeText(booking.session.session_name)}</strong><p>${escapeText(booking.session.market_name)} · ${escapeText(booking.stall.zone || "ตลาด")} · ฿${escapeText(booking.stall.price)}</p><span class="count-badge">${STATUS_LABEL[booking.status] || booking.status}</span>${booking.status === "pending" ? `<button class="button button-outline cancel-booking" data-booking-id="${booking.id}">ยกเลิกคำขอ</button>` : ""}</article>`).join("");
    target.querySelectorAll(".cancel-booking").forEach((button) => button.addEventListener("click", async () => {
      try { await api(`/api/shop/bookings/${button.dataset.bookingId}/cancel`, { method: "POST" }); await loadBookings(container, shop); }
      catch (error) { target.insertAdjacentHTML("afterbegin", `<p class="form-message">${escapeText(error.message)}</p>`); }
    }));
  } catch (error) { target.innerHTML = `<p class="form-message">${escapeText(error.message)}</p>`; }
}

function renderProfile(container, shop) {
  const target = container.querySelector("#dashboard-content");
  target.innerHTML = `<form id="profile-form"><label>ชื่อผู้ติดต่อ<input name="contact_name" value="${escapeText(shop.contact_name || "")}" maxlength="120"></label><label>ชื่อร้าน<input name="shop_name" value="${escapeText(shop.shop_name || "")}" maxlength="160"></label><label>ประเภทสินค้า<input name="category" value="${escapeText(shop.category || "")}" maxlength="100"></label><label>คำอธิบายร้าน<input name="description" value="${escapeText(shop.description || "")}" maxlength="2000"></label><label>ช่องทางติดต่อสาธารณะ (ไม่บังคับ)<input name="public_contact" value="${escapeText(shop.public_contact || "")}" maxlength="160"></label><p class="form-message" id="profile-message"></p><button class="button button-primary" type="submit">บันทึกข้อมูล</button></form>`;
  target.querySelector("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    for (const key of ["description", "public_contact"]) if (!body[key]) body[key] = null;
    try {
      const result = await api("/api/shop/me", { method: "PATCH", body: JSON.stringify(body) });
      Object.assign(shop, result.shop);
      target.querySelector("#profile-message").textContent = "บันทึกข้อมูลเรียบร้อย";
    } catch (error) { target.querySelector("#profile-message").textContent = error.message; }
  });
}

async function logoutShop() {
  try { await api("/api/shop/logout", { method: "POST" }); }
  finally {
    document.querySelector("#shop-dialog").close();
    document.querySelector(".header-login").textContent = "เข้าสู่ระบบร้านค้า";
  }
}

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "open-auth") openAuth("login");
  if (action === "clear-filters") {
    searchInput.value = "";
    categoryFilter.value = "";
    zoneFilter.value = "";
    if (state.mapFilters) updateFilterOptions(state.mapFilters);
    loadPublicMap();
  }
});
document.querySelectorAll(".auth-tab").forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode)));
authForm.addEventListener("submit", submitAuth);
marketSelect.addEventListener("change", async () => { state.marketId = Number(marketSelect.value) || null; await loadSessions(); });
sessionSelect.addEventListener("change", () => { state.sessionId = Number(sessionSelect.value) || null; loadPublicMap(); });
categoryFilter.addEventListener("change", loadPublicMap);
zoneFilter.addEventListener("change", loadPublicMap);
searchInput.addEventListener("input", () => { clearTimeout(state.debounce); state.debounce = setTimeout(loadPublicMap, 250); });

checkHealth();
loadMarkets();
