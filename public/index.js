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
    ...secureOptions,
    headers: { "Content-Type": "application/json", ...(secureOptions.headers || {}) },
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
    renderTakMarkets(result.items.filter((market) => market.province === "ตาก"));
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

function renderTakMarkets(markets) {
  const map = document.querySelector("#tak-market-map");
  const list = document.querySelector("#tak-market-list");
  map.querySelectorAll(".market-pin").forEach((pin) => pin.remove());
  document.querySelector("#tak-market-total").textContent = String(markets.length);
  if (!markets.length) {
    list.innerHTML = '<p class="list-empty">ยังไม่มีตลาดที่ระบุจังหวัดตากพร้อมพิกัด</p>';
    const empty = map.querySelector(".map-pin-empty") || document.createElement("div");
    empty.className = "map-pin-empty";
    empty.textContent = "ยังไม่มีหมุดตลาด";
    map.append(empty);
    return;
  }
  map.querySelector(".map-pin-empty")?.remove();
  list.replaceChildren();
  markets.forEach((market, index) => {
    const latitude = market.latitude == null ? NaN : Number(market.latitude);
    const longitude = market.longitude == null ? NaN : Number(market.longitude);
    const x = Number.isFinite(longitude) ? Math.max(16, Math.min(84, 50 + (longitude - 99.1) * 22)) : 50 + (index % 3 - 1) * 12;
    const y = Number.isFinite(latitude) ? Math.max(18, Math.min(78, 52 - (latitude - 16.8) * 25)) : 48 + (index % 2) * 16;
    const pin = document.createElement("button");
    pin.className = "market-pin";
    pin.type = "button";
    pin.style.left = `${x}%`;
    pin.style.top = `${y}%`;
    pin.setAttribute("aria-label", `เลือก${market.name}`);
    pin.innerHTML = `<span>●</span><small>${escapeText(market.name)}</small>`;
    pin.addEventListener("click", () => { marketSelect.value = String(market.id); marketSelect.dispatchEvent(new Event("change")); document.querySelector("#map").scrollIntoView({ behavior: "smooth" }); });
    map.append(pin);
    const card = document.createElement("button");
    card.className = "tak-market-row";
    card.type = "button";
    card.innerHTML = `<span class="tak-market-number">0${index + 1}</span><span><strong>${escapeText(market.name)}</strong><small>${escapeText(market.address || "จังหวัดตาก")}</small></span><span class="tak-market-arrow">↗</span>`;
    card.addEventListener("click", () => { marketSelect.value = String(market.id); marketSelect.dispatchEvent(new Event("change")); document.querySelector("#map").scrollIntoView({ behavior: "smooth" }); });
    list.append(card);
  });
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
    detail.innerHTML = `<div class="detail-content"><p class="eyebrow">SHOP SPACE</p><h2>สวัสดี ${escapeText(shop.shop_name)}</h2><p>จัดการข้อมูลร้านและติดตามคำขอจองของคุณ</p><div class="auth-tabs dashboard-tabs"><button class="auth-tab active" data-dashboard="bookings">รายการจอง</button><button class="auth-tab" data-dashboard="stalls">จองแผง</button><button class="auth-tab" data-dashboard="profile">ข้อมูลร้าน</button></div><div id="dashboard-content"><p>กำลังโหลดรายการจอง…</p></div><button class="button button-outline" data-action="logout">ออกจากระบบ</button></div>`;
    detail.querySelectorAll("[data-dashboard]").forEach((tab) => tab.addEventListener("click", () => {
      detail.querySelectorAll("[data-dashboard]").forEach((item) => item.classList.toggle("active", item === tab));
    }));
    detail.querySelector('[data-dashboard="bookings"]').addEventListener("click", () => loadBookings(detail, shop));
    detail.querySelector('[data-dashboard="stalls"]').addEventListener("click", () => loadStallBrowser(detail));
    detail.querySelector('[data-dashboard="profile"]').addEventListener("click", () => renderProfile(detail, shop));
    detail.querySelector('[data-action="logout"]').addEventListener("click", logoutShop);
    await loadBookings(detail, shop);
    dialog.showModal();
    document.querySelector(".header-login").textContent = shop.shop_name;
  } catch {
    openAuth("login");
  }
}

async function loadStallBrowser(container) {
  const target = container.querySelector("#dashboard-content");
  target.innerHTML = '<section class="stall-browser"><div class="stall-browser-intro"><p class="eyebrow">FIND YOUR SPOT</p><h3>เลือกแผงสำหรับร้านคุณ</h3><p>คำขอจองจะส่งให้ตลาดตรวจสอบก่อนยืนยัน</p></div><div class="stall-browser-filters"><label>ตลาด<select id="booking-market"><option value="">กำลังโหลดตลาด...</option></select></label><label>รอบตลาด<select id="booking-session"><option value="">เลือกรอบตลาด</option></select></label></div><div id="booking-stalls" class="booking-stalls" aria-live="polite"><p class="list-empty">กำลังโหลดตลาดทดลอง…</p></div><p id="booking-message" class="profile-message" role="status" aria-live="polite"></p></section>';
  const marketPicker = target.querySelector("#booking-market");
  const sessionPicker = target.querySelector("#booking-session");
  try {
    const result = await api("/api/markets");
    setOptions(marketPicker, result.items, result.items.length ? "เลือกตลาด" : "ยังไม่มีตลาด", "id", "name");
    if (!result.items.length) {
      target.querySelector("#booking-stalls").innerHTML = '<p class="list-empty">ยังไม่มีตลาดให้จอง กรุณาติดต่อผู้ดูแลระบบ</p>';
      return;
    }
    const sampleMarket = result.items.find((market) => market.name === "ตลาดชุมชนตัวอย่าง");
    marketPicker.value = String((sampleMarket || result.items[0]).id);
    marketPicker.addEventListener("change", () => loadBookingSessions(target));
    sessionPicker.addEventListener("change", () => loadBookingStalls(target));
    await loadBookingSessions(target);
  } catch (error) {
    target.querySelector("#booking-stalls").innerHTML = `<p class="form-message">${escapeText(error.message)}</p>`;
  }
}

async function loadBookingSessions(container) {
  const marketId = container.querySelector("#booking-market").value;
  const sessionPicker = container.querySelector("#booking-session");
  const stallList = container.querySelector("#booking-stalls");
  stallList.innerHTML = '<p class="list-empty">กำลังโหลดรอบตลาด…</p>';
  setOptions(sessionPicker, [], "กำลังโหลดรอบตลาด…", "id", "session_name");
  if (!marketId) return;
  try {
    const result = await api(`/api/markets/${marketId}/sessions`);
    const openSessions = result.items.filter((session) => session.status === "open");
    setOptions(sessionPicker, openSessions, openSessions.length ? "เลือกรอบที่เปิดจอง" : "ไม่มีรอบที่เปิดจอง", "id", "session_name");
    if (!openSessions.length) {
      stallList.innerHTML = '<p class="list-empty">ตอนนี้ไม่มีรอบตลาดที่เปิดรับคำขอจอง</p>';
      return;
    }
    sessionPicker.value = String(openSessions[0].id);
    await loadBookingStalls(container);
  } catch (error) {
    stallList.innerHTML = `<p class="form-message">${escapeText(error.message)}</p>`;
  }
}

async function loadBookingStalls(container) {
  const marketId = container.querySelector("#booking-market").value;
  const sessionId = container.querySelector("#booking-session").value;
  const stallList = container.querySelector("#booking-stalls");
  if (!marketId || !sessionId) return;
  stallList.innerHTML = '<p class="list-empty">กำลังโหลดแผง…</p>';
  try {
    const result = await api(`/api/shop/markets/${marketId}/sessions/${sessionId}/stalls?limit=100`);
    const available = result.items.filter((stall) => stall.availability === "available");
    if (!available.length) {
      stallList.innerHTML = '<p class="list-empty">ไม่มีแผงว่างในรอบนี้ ลองเลือกรอบอื่น</p>';
      return;
    }
    stallList.innerHTML = available.map((stall) => `<article class="booking-stall-card"><div class="booking-stall-code"><strong>${escapeText(stall.stall_code)}</strong><span>ว่าง</span></div><div class="booking-stall-info"><strong>${escapeText(stall.zone || "ไม่ระบุโซน")}</strong><small>${escapeText(stall.size_description || "ไม่ระบุขนาด")}</small></div><div class="booking-stall-price">฿${escapeText(stall.price)}<small>ต่อรอบ</small></div><button class="button button-primary booking-request" data-stall-id="${stall.id}">ขอจองแผง</button></article>`).join("");
    stallList.querySelectorAll(".booking-request").forEach((button) => button.addEventListener("click", async () => {
      const message = container.querySelector("#booking-message");
      button.disabled = true;
      button.textContent = "กำลังส่งคำขอ…";
      message.textContent = "";
      try {
        await api("/api/shop/bookings", { method: "POST", body: JSON.stringify({ session_id: Number(sessionId), stall_id: Number(button.dataset.stallId) }) });
        message.textContent = `ส่งคำขอจองแผง ${button.closest(".booking-stall-card").querySelector(".booking-stall-code strong").textContent} แล้ว รอการยืนยันจากตลาด`;
        message.classList.remove("is-error");
        message.classList.add("is-success");
        await loadBookingStalls(container);
      } catch (error) {
        message.textContent = error.message;
        message.classList.remove("is-success");
        message.classList.add("is-error");
        button.disabled = false;
        button.textContent = "ขอจองแผง";
      }
    }));
  } catch (error) {
    stallList.innerHTML = `<p class="form-message">${escapeText(error.message)}</p>`;
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
  const initial = escapeText((shop.shop_name || "ร").slice(0, 1));
  target.innerHTML = `<section class="profile-editor" aria-labelledby="profile-title">
    <header class="profile-hero">
      <span class="profile-avatar" aria-hidden="true">${initial}</span>
      <div class="profile-identity"><p class="eyebrow">หน้าร้านของคุณ</p><h3 id="profile-title">${escapeText(shop.shop_name)}</h3><span class="profile-category">${escapeText(shop.category)}</span></div>
      <span class="profile-lockup">โปรไฟล์ร้านค้า</span>
    </header>
    <div class="profile-notice"><span aria-hidden="true">◎</span><p><strong>ข้อมูลร้านที่แสดงบนผังตลาด</strong><br>ชื่อร้าน ประเภทสินค้า คำอธิบาย และช่องทางติดต่อสาธารณะจะช่วยให้ลูกค้ารู้จักร้านของคุณ</p></div>
    <form id="profile-form" class="profile-form">
      <div class="profile-section-title"><span>01</span><div><h4>ข้อมูลพื้นฐาน</h4><p>ข้อมูลสำหรับติดต่อและแสดงชื่อร้าน</p></div></div>
      <div class="profile-fields">
        <label>ชื่อผู้ติดต่อ <em>จำเป็น</em><input name="contact_name" value="${escapeText(shop.contact_name || "")}" maxlength="120" autocomplete="name" required></label>
        <label>เบอร์โทรศัพท์บัญชี<input value="${escapeText(shop.phone || "")}" readonly aria-describedby="phone-help"><small id="phone-help">ใช้เข้าสู่ระบบ และแก้ไขไม่ได้</small></label>
        <label>ชื่อร้าน <em>จำเป็น</em><input name="shop_name" value="${escapeText(shop.shop_name || "")}" maxlength="160" required></label>
        <label>ประเภทสินค้า <em>จำเป็น</em><input name="category" value="${escapeText(shop.category || "")}" maxlength="100" placeholder="เช่น อาหาร เครื่องดื่ม งานฝีมือ" required></label>
      </div>
      <div class="profile-section-title profile-section-spaced"><span>02</span><div><h4>แนะนำร้านให้ลูกค้ารู้จัก</h4><p>เพิ่มรายละเอียดและช่องทางติดต่อที่ต้องการเผยแพร่</p></div></div>
      <label class="profile-wide-field">คำอธิบายร้าน <small>ไม่เกิน 2,000 ตัวอักษร</small><textarea name="description" maxlength="2000" rows="4" placeholder="เล่าให้ลูกค้าฟังว่ามีอะไรน่าสนใจในร้าน">${escapeText(shop.description || "")}</textarea></label>
      <label class="profile-wide-field">ช่องทางติดต่อสาธารณะ <small>ไม่บังคับ · ลูกค้าจะเห็นข้อมูลนี้</small><input name="public_contact" value="${escapeText(shop.public_contact || "")}" maxlength="160" placeholder="เช่น LINE, Facebook หรือเบอร์ติดต่อร้าน"></label>
      <div class="profile-save-row"><p class="profile-message" id="profile-message" role="status" aria-live="polite">การเปลี่ยนแปลงจะแสดงหลังบันทึก</p><button class="button button-primary" type="submit"><span aria-hidden="true">✓</span> บันทึกข้อมูลร้าน</button></div>
    </form>
  </section>`;
  target.querySelector("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = Object.fromEntries(form.entries());
    for (const key of ["description", "public_contact"]) if (!body[key]) body[key] = null;
    const submit = formElement.querySelector('button[type="submit"]');
    const message = target.querySelector("#profile-message");
    submit.disabled = true;
    submit.innerHTML = '<span aria-hidden="true">…</span> กำลังบันทึก';
    message.textContent = "กำลังบันทึกข้อมูลร้านของคุณ…";
    message.classList.remove("is-error", "is-success");
    try {
      const result = await api("/api/shop/me", { method: "PATCH", body: JSON.stringify(body) });
      Object.assign(shop, result.shop);
      target.querySelector(".profile-identity h3").textContent = shop.shop_name;
      target.querySelector(".profile-category").textContent = shop.category;
      target.querySelector(".profile-avatar").textContent = (shop.shop_name || "ร").slice(0, 1);
      message.textContent = "บันทึกเรียบร้อยแล้ว ข้อมูลร้านของคุณเป็นปัจจุบัน";
      message.classList.add("is-success");
    } catch (error) {
      message.textContent = error.fields ? `${error.message}: ${Object.values(error.fields).join(" · ")}` : error.message;
      message.classList.add("is-error");
    } finally {
      submit.disabled = false;
      submit.innerHTML = '<span aria-hidden="true">✓</span> บันทึกข้อมูลร้าน';
    }
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

const adminDefinitions = {
  markets: { title: "ตลาด", subtitle: "เพิ่มตลาดในจังหวัดตากและกำหนดตำแหน่งหมุด", fields: [["name", "ชื่อตลาด", "text", true], ["description", "รายละเอียด", "textarea"], ["address", "ที่อยู่", "text"], ["province", "จังหวัด", "text", true], ["latitude", "ละติจูด", "number"], ["longitude", "ลองจิจูด", "number"], ["is_active", "เปิดใช้งาน", "boolean"]], columns: [["id", "ID"], ["name", "ชื่อตลาด"], ["province", "จังหวัด"], ["address", "ที่อยู่"], ["is_active", "สถานะ"]] },
  sessions: { title: "รอบตลาด", subtitle: "กำหนดเวลาจัดงานและช่วงเปิดรับจอง", fields: [["market_id", "รหัสตลาด", "number", true], ["session_name", "ชื่อรอบ", "text", true], ["starts_at", "เริ่มงาน", "datetime-local", true], ["ends_at", "จบงาน", "datetime-local", true], ["booking_opens_at", "เปิดจอง", "datetime-local"], ["booking_closes_at", "ปิดจอง", "datetime-local"], ["status", "สถานะ", "enum", ["draft", "open", "closed", "completed", "cancelled"]]], columns: [["id", "ID"], ["market_id", "ตลาด ID"], ["session_name", "ชื่อรอบ"], ["starts_at", "เริ่ม"], ["ends_at", "จบ"], ["status", "สถานะ"]] },
  stalls: { title: "แผงค้า", subtitle: "จัดการตำแหน่ง ราคา และสถานะแผง", fields: [["market_id", "รหัสตลาด", "number", true], ["stall_code", "รหัสแผง", "text", true], ["zone", "โซน", "text"], ["size_description", "ขนาด", "text"], ["price", "ราคา", "number", true], ["map_x", "ตำแหน่ง X (0-1)", "number"], ["map_y", "ตำแหน่ง Y (0-1)", "number"], ["is_active", "เปิดใช้งาน", "boolean"]], columns: [["id", "ID"], ["market_id", "ตลาด"], ["stall_code", "รหัสแผง"], ["zone", "โซน"], ["price", "ราคา"], ["is_active", "สถานะ"]] },
  shops: { title: "ร้านค้า", subtitle: "ดูแลบัญชีร้านค้าและข้อมูลที่เผยแพร่", fields: [["contact_name", "ชื่อผู้ติดต่อ", "text", true], ["shop_name", "ชื่อร้าน", "text", true], ["category", "ประเภท", "text", true], ["description", "รายละเอียด", "textarea"], ["public_contact", "ช่องทางติดต่อสาธารณะ", "text"], ["is_active", "เปิดใช้งาน", "boolean"]], columns: [["id", "ID"], ["phone", "โทรศัพท์"], ["shop_name", "ชื่อร้าน"], ["category", "ประเภท"], ["is_active", "สถานะ"]], createExtra: [["phone", "เบอร์โทรศัพท์เข้าสู่ระบบ", "tel", true], ["password", "รหัสผ่านชั่วคราว (12+ ตัว)", "password", true]], editExtra: [["password", "ตั้งรหัสผ่านใหม่ (ไม่บังคับ, 12+ ตัว)", "password", false]] },
  bookings: { title: "คำขอจอง", subtitle: "คำขอใหม่อยู่ด้านบน อนุมัติหรือปฏิเสธได้ทันที", fields: [["status", "สถานะ", "enum", ["pending", "confirmed", "rejected", "cancelled"]], ["decision_note", "หมายเหตุผู้ดูแล", "textarea"]], columns: [["id", "ID"], ["shop_name", "ร้านค้า"], ["market_name", "ตลาด"], ["session_name", "รอบ"], ["stall_code", "แผง"], ["price", "ราคา"], ["status", "สถานะ"], ["created_at", "วันที่ส่ง"]] },
};
const adminState = { entity: "bookings", items: [], overview: null, refreshTimer: null };
function adminRequest(url, options = {}) { return api(url, options); }
function adminInput(field, label, type, required, value = "") {
  const escaped = escapeText(value == null ? "" : value);
  if (type === "textarea") return `<label class="wide">${label}<textarea name="${field}" ${required ? "required" : ""}>${escaped}</textarea></label>`;
  if (type === "boolean") return `<label>${label}<select name="${field}"><option value="1" ${String(value) !== "0" ? "selected" : ""}>เปิด</option><option value="0" ${String(value) === "0" ? "selected" : ""}>ปิด</option></select></label>`;
  if (type === "enum") return `<label>${label}<select name="${field}">${required.map((option) => `<option value="${option}" ${value === option ? "selected" : ""}>${option}</option>`).join("")}</select></label>`;
  const clean = type === "datetime-local" && value ? String(value).replace(" ", "T").slice(0, 16) : escaped;
  return `<label>${label}<input name="${field}" type="${type}" value="${clean}" ${required === true ? "required" : ""} ${type === "number" ? "step=\"any\"" : ""}></label>`;
}
function renderAdminTable() {
  const definition = adminDefinitions[adminState.entity];
  document.querySelector("#admin-title").textContent = definition.title;
  document.querySelector("#admin-subtitle").textContent = definition.subtitle;
  document.querySelector("#admin-create").hidden = adminState.entity === "bookings";
  document.querySelector("#admin-nav").innerHTML = Object.entries(adminDefinitions).map(([key, item]) => `<button class="admin-nav-item ${key === adminState.entity ? "active" : ""}" data-admin-entity="${key}">${item.title}</button>`).join("");
  document.querySelectorAll("[data-admin-entity]").forEach((button) => button.addEventListener("click", () => loadAdminEntity(button.dataset.adminEntity)));
  document.querySelector("#admin-metrics").innerHTML = adminState.overview ? [["markets", "ตลาด"], ["sessions", "รอบตลาด"], ["stalls", "แผง"], ["shops", "ร้านค้า"], ["bookings", "การจอง"], ["pending", "รอตรวจ"]].map(([key, label]) => `<article class="admin-metric"><span>${label}</span><strong>${adminState.overview[key]}</strong></article>`).join("") : "";
  const columns = definition.columns;
  const rows = adminState.items.map((item) => `<tr class="${item.status === "pending" ? "booking-pending-row" : ""}">${columns.map(([key]) => `<td>${key === "is_active" ? (item[key] ? "เปิด" : "ปิด") : key === "status" ? `<span class="booking-status status-${escapeText(item[key])}">${escapeText(STATUS_LABEL[item[key]] || item[key])}</span>` : key === "price" ? `฿${escapeText(item[key])}` : escapeText(item[key] ?? "—")}</td>`).join("")}<td><div class="admin-row-actions">${adminState.entity === "bookings" && item.status === "pending" ? `<button class="booking-approve" data-decision-id="${item.id}" data-status="confirmed">อนุมัติ</button><button class="booking-reject" data-decision-id="${item.id}" data-status="rejected">ปฏิเสธ</button>` : adminState.entity === "bookings" ? "จัดการแล้ว" : `<button data-edit-id="${item.id}">แก้ไข</button><button data-delete-id="${item.id}">ปิด/ยกเลิก</button>`}</div></td></tr>`).join("");
  document.querySelector("#admin-table-wrap").innerHTML = `<table class="admin-table"><thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join("")}<th>จัดการ</th></tr></thead><tbody>${rows || `<tr><td colspan="${columns.length + 1}" class="list-empty">ยังไม่มีข้อมูลในหมวดนี้</td></tr>`}</tbody></table>`;
  document.querySelectorAll("[data-edit-id]").forEach((button) => button.addEventListener("click", () => editAdminItem(Number(button.dataset.editId))));
  document.querySelectorAll("[data-decision-id]").forEach((button) => button.addEventListener("click", () => decideAdminBooking(button)));
  document.querySelectorAll("[data-delete-id]").forEach((button) => button.addEventListener("click", () => deleteAdminItem(Number(button.dataset.deleteId))));
}
async function loadAdminEntity(entity = "markets") {
  adminState.entity = entity;
  const message = document.querySelector("#admin-work-message");
  message.textContent = "กำลังโหลดข้อมูล...";
  try {
    const [data, overview] = await Promise.all([adminRequest(`/api/admin/data/${entity}`), adminRequest("/api/admin/overview")]);
    adminState.items = data.items;
    adminState.overview = overview;
    message.textContent = "";
    renderAdminTable();
  } catch (error) { message.textContent = error.message; }
}
function openAdminEditor(item = null) {
  const entity = adminState.entity;
  const definition = adminDefinitions[entity];
  const fields = item ? [...definition.fields, ...(definition.editExtra || [])] : [...definition.fields, ...(definition.createExtra || [])];
  const content = document.querySelector("#admin-editor-content");
  content.innerHTML = `<h2>${item ? "แก้ไข" : "เพิ่ม"}${definition.title}</h2><form id="admin-form" class="admin-form"><div class="admin-form-grid">${fields.map(([key, label, type, required]) => adminInput(key, label, type, required, item?.[key])).join("")}</div><p class="profile-message" id="admin-editor-message"></p><div class="admin-form-actions"><button type="button" class="button button-outline" id="admin-editor-cancel">ยกเลิก</button><button class="button button-primary">บันทึก</button></div></form>`;
  const dialog = document.querySelector("#admin-editor");
  dialog.showModal();
  content.querySelector("#admin-editor-cancel").onclick = () => dialog.close();
  content.querySelector("#admin-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    for (const [key, , type] of fields) {
      if (type === "number" || type === "boolean") form[key] = form[key] === "" ? null : Number(form[key]);
      if (type === "datetime-local") form[key] = form[key] ? form[key].replace("T", " ") + (form[key].length === 16 ? ":00" : "") : null;
      if (form[key] === "") form[key] = null;
    }
    try {
      const url = `/api/admin/data/${entity}${item ? `/${item.id}` : ""}`;
      await adminRequest(url, { method: item ? "PATCH" : "POST", body: JSON.stringify(form) });
      dialog.close();
      await loadAdminEntity(entity);
    } catch (error) { content.querySelector("#admin-editor-message").textContent = error.message; }
  };
}
async function decideAdminBooking(button) {
  const status = button.dataset.status;
  const note = prompt(status === "confirmed" ? "หมายเหตุถึงร้านค้า (ไม่บังคับ)" : "เหตุผลที่ไม่อนุมัติ (ไม่บังคับ)") || "";
  if (!confirm(status === "confirmed" ? "ยืนยันอนุมัติคำขอจองนี้หรือไม่?" : "ยืนยันไม่อนุมัติคำขอจองนี้หรือไม่?")) return;
  button.disabled = true;
  try {
    await adminRequest(`/api/admin/bookings/${button.dataset.decisionId}/decision`, { method: "POST", body: JSON.stringify({ status, decision_note: note }) });
    await loadAdminEntity("bookings");
  } catch (error) { document.querySelector("#admin-work-message").textContent = error.message; button.disabled = false; }
}
function editAdminItem(id) { const item = adminState.items.find((row) => Number(row.id) === id); if (item) openAdminEditor(item); }
async function deleteAdminItem(id) {
  if (!confirm("ยืนยันปิดใช้งานหรือยกเลิกรายการนี้? ข้อมูลจะไม่ถูกลบถาวร")) return;
  try { await adminRequest(`/api/admin/data/${adminState.entity}/${id}`, { method: "DELETE" }); await loadAdminEntity(adminState.entity); }
  catch (error) { document.querySelector("#admin-work-message").textContent = error.message; }
}
function renderAdminGate(needsSetup) {
  const card = document.querySelector("#admin-auth-card");
  card.innerHTML = needsSetup ? `<h2>ตั้งค่าผู้ดูแลคนแรก</h2><p>กรอกรหัส setup ที่แสดงใน terminal ตอนเริ่มเซิร์ฟเวอร์</p><form id="admin-auth-form"><label>รหัส setup<input name="setup_code" required autocomplete="one-time-code"></label><label>ชื่อผู้ใช้ (3-80 ตัว)<input name="username" required minlength="3" maxlength="80"></label><label>รหัสผ่าน (อย่างน้อย 12 ตัว)<input name="password" type="password" required minlength="12" autocomplete="new-password"></label><button class="button button-primary">ตั้งค่าผู้ดูแล</button></form>` : `<h2>เข้าสู่ระบบผู้ดูแล</h2><form id="admin-auth-form"><label>ชื่อผู้ใช้<input name="username" required autocomplete="username"></label><label>รหัสผ่าน<input name="password" type="password" required autocomplete="current-password"></label><button class="button button-primary">เข้าสู่ระบบ</button></form>`;
  card.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await adminRequest(needsSetup ? "/api/admin/setup" : "/api/admin/login", { method: "POST", body: JSON.stringify(body) });
      await startAdminWorkspace();
    } catch (error) { document.querySelector("#admin-message").textContent = error.message; }
  };
}
async function startAdminWorkspace() {
  document.querySelector("#admin-gate").hidden = true;
  document.querySelector("#admin-workspace").hidden = false;
  try {
    const result = await adminRequest("/api/admin/me");
    document.querySelector("#admin-username").textContent = result.username;
    await loadAdminEntity("bookings");
    clearInterval(adminState.refreshTimer);
    adminState.refreshTimer = setInterval(() => {
      if (!document.querySelector("#admin-workspace").hidden && adminState.entity === "bookings") loadAdminEntity("bookings");
    }, 15000);
  } catch { document.querySelector("#admin-workspace").hidden = true; document.querySelector("#admin-gate").hidden = false; }
}
async function initAdmin() {
  document.querySelector("#home").hidden = true;
  document.querySelector(".site-header").hidden = true;
  document.querySelector(".site-footer").hidden = true;
  document.querySelector("#admin-app").hidden = false;
  document.querySelector("#admin-create").onclick = () => openAdminEditor();
  document.querySelector("#admin-logout").onclick = async () => { try { await adminRequest("/api/admin/logout", { method: "POST" }); } finally { location.href = "/admin-login"; } };
  try {
    await adminRequest("/api/admin/me");
    await startAdminWorkspace();
  } catch {
    const result = await adminRequest("/api/admin/setup/status");
    renderAdminGate(result.needsSetup);
  }
}

if (location.pathname === "/admin-login") initAdmin();
else { checkHealth(); loadMarkets(); }
