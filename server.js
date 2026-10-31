const express = require("express");
const mariadb = require("mariadb");
const crypto = require("node:crypto");

const app = express();
const port = 3104;
const pool = mariadb.createPool({
  host: "10.200.210.117",
  port: 3306,
  user: "std04",
  password: "std04",
  database: "db_std04",
  connectionLimit: 5,
  acquireTimeout: 10000,
});
const sessions = new Map();
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7;
const COOKIE_NAME = "takhlad_session";
const CSRF_COOKIE = "takhlad_csrf";

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});
app.use(express.static("public"));

function sendError(res, status, code, message, fields) {
  const error = { code, message };
  if (fields) error.fields = fields;
  return res.status(status).json({ error });
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return null;
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(Boolean));
}

function setCookies(res, cookies) {
  const previous = res.getHeader("Set-Cookie");
  const values = previous ? (Array.isArray(previous) ? previous : [previous]) : [];
  res.setHeader("Set-Cookie", [...values, ...cookies]);
}

function setSession(res, shopId) {
  const token = crypto.randomBytes(32).toString("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { shopId, csrfToken, expiresAt: Date.now() + SESSION_TTL });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  setCookies(res, [
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`,
    `${CSRF_COOKIE}=${csrfToken}; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`,
  ]);
}

function requireCsrf(req, res, next) {
  const session = sessions.get(req.sessionToken);
  const cookieToken = parseCookies(req.headers.cookie)[CSRF_COOKIE];
  const headerToken = req.headers["x-csrf-token"];
  if (!session || !cookieToken || !headerToken || cookieToken !== session.csrfToken || headerToken !== session.csrfToken) {
    return sendError(res, 403, "CSRF_INVALID", "คำขอไม่ผ่านการตรวจสอบความปลอดภัย กรุณาโหลดหน้าใหม่");
  }
  next();
}

function requireShop(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const session = token && sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return sendError(res, 401, "UNAUTHENTICATED", "กรุณาเข้าสู่ระบบก่อนใช้งาน");
  }
  req.shopId = session.shopId;
  req.sessionToken = token;
  next();
}

function positiveId(value) {
  if (!/^\d+$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validText(value, max, required = false) {
  if (typeof value !== "string") return !required && (value === undefined || value === null);
  const text = value.trim();
  return (!required || text.length > 0) && [...text].length <= max;
}

function validateProfile(body, registering = false) {
  const fields = {};
  if (registering || body.contact_name !== undefined) {
    if (!validText(body.contact_name, 120, true)) fields.contact_name = "กรุณากรอกชื่อผู้ติดต่อ และความยาวต้องไม่เกิน 120 ตัวอักษร";
  }
  if (registering || body.shop_name !== undefined) {
    if (!validText(body.shop_name, 160, true)) fields.shop_name = "กรุณากรอกชื่อร้าน และความยาวต้องไม่เกิน 160 ตัวอักษร";
  }
  if (registering || body.category !== undefined) {
    if (!validText(body.category, 100, true)) fields.category = "กรุณากรอกประเภทสินค้า และความยาวต้องไม่เกิน 100 ตัวอักษร";
  }
  if (registering || body.description !== undefined) {
    if (body.description != null && !validText(body.description, 2000)) fields.description = "คำอธิบายต้องไม่เกิน 2000 ตัวอักษร";
  }
  if (registering || body.public_contact !== undefined) {
    if (body.public_contact != null && !validText(body.public_contact, 160)) fields.public_contact = "ช่องทางติดต่อสาธารณะต้องไม่เกิน 160 ตัวอักษร";
  }
  return fields;
}

function normalizeShop(row) {
  if (!row) return null;
  return { id: Number(row.id), phone: row.phone, contact_name: row.contact_name, shop_name: row.shop_name, category: row.category, description: row.description, public_contact: row.public_contact };
}

async function ensureSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS shops (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      phone VARCHAR(20) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      contact_name VARCHAR(120) NOT NULL,
      shop_name VARCHAR(160) NOT NULL,
      category VARCHAR(100) NOT NULL,
      description TEXT NULL,
      public_contact VARCHAR(160) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS markets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      description TEXT NULL,
      address VARCHAR(255) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS market_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      market_id BIGINT UNSIGNED NOT NULL,
      session_name VARCHAR(120) NOT NULL,
      starts_at DATETIME NOT NULL,
      ends_at DATETIME NOT NULL,
      booking_opens_at DATETIME NULL,
      booking_closes_at DATETIME NULL,
      status ENUM('draft','open','closed','completed','cancelled') NOT NULL DEFAULT 'draft',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sessions_market_start (market_id, starts_at),
      CONSTRAINT fk_sessions_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS stalls (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      market_id BIGINT UNSIGNED NOT NULL,
      stall_code VARCHAR(30) NOT NULL,
      zone VARCHAR(80) NULL,
      size_description VARCHAR(100) NULL,
      price DECIMAL(10,2) NOT NULL DEFAULT 0,
      map_x DECIMAL(7,4) NULL,
      map_y DECIMAL(7,4) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_stalls_market_code (market_id, stall_code),
      CONSTRAINT fk_stalls_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS bookings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      shop_id BIGINT UNSIGNED NOT NULL,
      session_id BIGINT UNSIGNED NOT NULL,
      stall_id BIGINT UNSIGNED NOT NULL,
      status ENUM('pending','confirmed','rejected','cancelled') NOT NULL DEFAULT 'pending',
      shop_note VARCHAR(500) NULL,
      decision_note VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bookings_shop_created (shop_id, created_at),
      INDEX idx_bookings_stall_session_status (session_id, stall_id, status),
      CONSTRAINT fk_bookings_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE RESTRICT,
      CONSTRAINT fk_bookings_session FOREIGN KEY (session_id) REFERENCES market_sessions(id) ON DELETE RESTRICT,
      CONSTRAINT fk_bookings_stall FOREIGN KEY (stall_id) REFERENCES stalls(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ];
  for (const statement of statements) await pool.query(statement);
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Database health check failed:", error.message);
    sendError(res, 503, "DATABASE_UNAVAILABLE", "ระบบฐานข้อมูลยังไม่พร้อมใช้งาน");
  }
});

app.get("/api/markets", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const rows = await pool.query("SELECT id, name, description, address, is_active FROM markets WHERE is_active = 1 AND (? = '' OR name LIKE ?) ORDER BY name LIMIT ? OFFSET ?", [q, `%${q}%`, limit, offset]);
    const count = await pool.query("SELECT COUNT(*) AS total FROM markets WHERE is_active = 1 AND (? = '' OR name LIKE ?)", [q, `%${q}%`]);
    res.json({ items: rows.map((row) => ({ ...row, id: Number(row.id), is_active: Boolean(row.is_active) })), pagination: { limit, offset, total: Number(count[0].total) } });
  } catch (error) {
    console.error("Market list failed:", error.message);
    sendError(res, 500, "INTERNAL_ERROR", "ไม่สามารถโหลดรายการตลาดได้");
  }
});

app.get("/api/markets/:marketId", async (req, res) => {
  const marketId = positiveId(req.params.marketId);
  if (!marketId) return sendError(res, 400, "INVALID_ID", "รหัสตลาดไม่ถูกต้อง");
  try {
    const rows = await pool.query("SELECT id, name, description, address, is_active FROM markets WHERE id = ? AND is_active = 1", [marketId]);
    if (!rows.length) return sendError(res, 404, "MARKET_NOT_FOUND", "ไม่พบตลาดนี้");
    res.json({ market: { ...rows[0], id: Number(rows[0].id), is_active: Boolean(rows[0].is_active) } });
  } catch (error) {
    console.error("Market detail failed:", error.message);
    sendError(res, 500, "INTERNAL_ERROR", "ไม่สามารถโหลดข้อมูลตลาดได้");
  }
});

app.get("/api/markets/:marketId/sessions", async (req, res) => {
  const marketId = positiveId(req.params.marketId);
  if (!marketId) return sendError(res, 400, "INVALID_ID", "รหัสตลาดไม่ถูกต้อง");
  try {
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    if ((from && !/^\\d{4}-\\d{2}-\\d{2}$/.test(from)) || (to && !/^\\d{4}-\\d{2}-\\d{2}$/.test(to))) return sendError(res, 422, "VALIDATION_ERROR", "รูปแบบวันที่ต้องเป็น YYYY-MM-DD");
    const rows = await pool.query("SELECT id, market_id, session_name, starts_at, ends_at, booking_opens_at, booking_closes_at, status FROM market_sessions WHERE market_id = ? AND status IN ('open','closed','completed') AND (? IS NULL OR DATE(starts_at) >= ?) AND (? IS NULL OR DATE(starts_at) <= ?) ORDER BY starts_at", [marketId, from, from, to, to]);
    res.json({ items: rows.map((row) => ({ ...row, id: Number(row.id), market_id: Number(row.market_id) })) });
  } catch (error) {
    console.error("Session list failed:", error.message);
    sendError(res, 500, "INTERNAL_ERROR", "ไม่สามารถโหลดรอบตลาดได้");
  }
});

app.get("/api/markets/:marketId/sessions/:sessionId/map", async (req, res) => {
  const marketId = positiveId(req.params.marketId);
  const sessionId = positiveId(req.params.sessionId);
  if (!marketId || !sessionId) return sendError(res, 400, "INVALID_ID", "รหัสตลาดหรือรอบตลาดไม่ถูกต้อง");
  try {
    const sessionRows = await pool.query("SELECT ms.id, ms.session_name, ms.starts_at, ms.ends_at, m.id AS market_id, m.name AS market_name FROM market_sessions ms JOIN markets m ON m.id = ms.market_id WHERE ms.id = ? AND ms.market_id = ? AND m.is_active = 1 AND ms.status IN ('open','closed','completed')", [sessionId, marketId]);
    if (!sessionRows.length) return sendError(res, 404, "SESSION_NOT_FOUND", "ไม่พบรอบตลาดนี้");
    const { q = "", category = "", zone = "", availability = "all" } = req.query;
    if (!["all", "available", "occupied"].includes(availability)) return sendError(res, 422, "VALIDATION_ERROR", "ตัวกรองสถานะไม่ถูกต้อง");
    const rows = await pool.query(
      `SELECT s.id AS stall_id, s.stall_code, s.zone, s.size_description, s.price, s.map_x, s.map_y,
        sh.id AS shop_id, sh.shop_name, sh.category, sh.description, sh.public_contact
       FROM stalls s LEFT JOIN bookings b ON b.stall_id = s.id AND b.session_id = ? AND b.status = 'confirmed'
       LEFT JOIN shops sh ON sh.id = b.shop_id AND sh.is_active = 1
       WHERE s.market_id = ? AND s.is_active = 1 AND (? = '' OR s.stall_code LIKE ? OR sh.shop_name LIKE ? OR sh.category LIKE ?)
         AND (? = '' OR sh.category = ?) AND (? = '' OR s.zone = ?)
         AND (? = 'all' OR (? = 'occupied' AND sh.id IS NOT NULL) OR (? = 'available' AND sh.id IS NULL)) ORDER BY s.zone, s.stall_code`,
      [sessionId, marketId, q, `%${q}%`, `%${q}%`, `%${q}%`, category, category, zone, zone, availability, availability, availability],
    );
    const categories = await pool.query("SELECT DISTINCT sh.category FROM bookings b JOIN shops sh ON sh.id = b.shop_id WHERE b.session_id = ? AND b.status = 'confirmed' AND sh.is_active = 1 ORDER BY sh.category", [sessionId]);
    const zones = await pool.query("SELECT DISTINCT zone FROM stalls WHERE market_id = ? AND is_active = 1 AND zone IS NOT NULL ORDER BY zone", [marketId]);
    const session = sessionRows[0];
    res.json({ market: { id: Number(session.market_id), name: session.market_name }, session: { id: Number(session.id), session_name: session.session_name, starts_at: session.starts_at, ends_at: session.ends_at }, items: rows.map((row) => ({ stall: { id: Number(row.stall_id), stall_code: row.stall_code, zone: row.zone, size_description: row.size_description, price: row.price, map_x: row.map_x, map_y: row.map_y, availability: row.shop_id ? "occupied" : "available" }, shop: row.shop_id ? { id: Number(row.shop_id), shop_name: row.shop_name, category: row.category, description: row.description, public_contact: row.public_contact } : null })), filters: { categories: categories.map((row) => row.category), zones: zones.map((row) => row.zone) } });
  } catch (error) {
    console.error("Public map failed:", error.message);
    sendError(res, 500, "INTERNAL_ERROR", "ไม่สามารถโหลดผังตลาดได้");
  }
});

app.get("/api/markets/:marketId/sessions/:sessionId/shops", async (req, res) => {
  const marketId = positiveId(req.params.marketId);
  const sessionId = positiveId(req.params.sessionId);
  if (!marketId || !sessionId) return sendError(res, 400, "INVALID_ID", "รหัสตลาดหรือรอบตลาดไม่ถูกต้อง");
  try {
    const q = String(req.query.q || "").trim();
    const category = String(req.query.category || "").trim();
    const zone = String(req.query.zone || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const baseSql = `FROM bookings b JOIN market_sessions ms ON ms.id = b.session_id AND ms.market_id = ? JOIN stalls s ON s.id = b.stall_id AND s.market_id = ?
      JOIN shops sh ON sh.id = b.shop_id WHERE b.session_id = ? AND b.status = 'confirmed' AND s.is_active = 1 AND sh.is_active = 1
      AND (? = '' OR sh.shop_name LIKE ? OR sh.category LIKE ? OR s.stall_code LIKE ?) AND (? = '' OR sh.category = ?) AND (? = '' OR s.zone = ?)`;
    const filterValues = [marketId, marketId, sessionId, q, `%${q}%`, `%${q}%`, `%${q}%`, category, category, zone, zone];
    const count = await pool.query(`SELECT COUNT(*) AS total ${baseSql}`, filterValues);
    const rows = await pool.query(`SELECT sh.id AS shop_id, sh.shop_name, sh.category, sh.description, sh.public_contact, s.stall_code, s.zone ${baseSql} ORDER BY sh.shop_name LIMIT ? OFFSET ?`, [...filterValues, limit, offset]);
    res.json({ items: rows.map((row) => ({ id: Number(row.shop_id), shop_name: row.shop_name, category: row.category, description: row.description, public_contact: row.public_contact, stall_code: row.stall_code, zone: row.zone })), pagination: { limit, offset, total: Number(count[0].total) } });
  } catch (error) {
    console.error("Public shop list failed:", error.message);
    sendError(res, 500, "INTERNAL_ERROR", "ไม่สามารถค้นหาร้านค้าได้");
  }
});

app.post("/api/shop/register", async (req, res) => {
  const body = req.body || {};
  const fields = validateProfile(body, true);
  const phone = typeof body.phone === "string" ? body.phone.replace(/[\s()-]/g, "") : "";
  if (!/^\+?\d{9,15}$/.test(phone)) fields.phone = "กรุณากรอกเบอร์โทรศัพท์ 9–15 หลัก";
  if (typeof body.password !== "string" || [...body.password].length < 10 || [...body.password].length > 200) fields.password = "รหัสผ่านต้องมีความยาว 10–200 ตัวอักษร";
  if (Object.keys(fields).length) return sendError(res, 422, "VALIDATION_ERROR", "กรุณาตรวจสอบข้อมูลที่กรอก", fields);
  try {
    const salt = crypto.randomBytes(16);
    const derived = await new Promise((resolve, reject) => crypto.scrypt(body.password, salt, 64, (error, key) => error ? reject(error) : resolve(key)));
    const passwordHash = `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
    const result = await pool.query("INSERT INTO shops (phone, password_hash, contact_name, shop_name, category, description, public_contact) VALUES (?, ?, ?, ?, ?, ?, ?)", [phone, passwordHash, body.contact_name.trim(), body.shop_name.trim(), body.category.trim(), body.description?.trim() || null, body.public_contact?.trim() || null]);
    setSession(res, Number(result.insertId));
    const rows = await pool.query("SELECT id, phone, contact_name, shop_name, category, description, public_contact FROM shops WHERE id = ?", [result.insertId]);
    res.status(201).json({ shop: normalizeShop(rows[0]) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return sendError(res, 409, "PHONE_ALREADY_REGISTERED", "เบอร์โทรศัพท์นี้มีบัญชีแล้ว");
    console.error("Shop registration failed:", error.message);
    sendError(res, 500, "INTERNAL_ERROR", "ไม่สามารถสมัครสมาชิกได้ในขณะนี้");
  }
});

app.post("/api/shop/login", async (req, res) => {
  const phone = typeof req.body?.phone === "string" ? req.body.phone.replace(/[\\s()-]/g, "") : "";
  const password = req.body?.password;
  if (!/^\\+?\\d{9,15}$/.test(phone) || typeof password !== "string") return sendError(res, 422, "VALIDATION_ERROR", "กรุณากรอกเบอร์โทรศัพท์และรหัสผ่านให้ถูกต้อง");
  try {
    const rows = await pool.query("SELECT id, password_hash, is_active FROM shops WHERE phone = ?", [phone]);
    const row = rows[0];
    let valid = false;
    if (row?.password_hash?.startsWith("scrypt$")) {
      const [, saltHex, keyHex] = row.password_hash.split("$");
      const expected = Buffer.from(keyHex, "hex");
      const actual = await new Promise((resolve, reject) => crypto.scrypt(password, Buffer.from(saltHex, "hex"), expected.length, (error, key) => error ? reject(error) : resolve(key)));
      valid = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    }
    if (!row || !valid || !row.is_active) return sendError(res, 401, "INVALID_CREDENTIALS", "เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง");
    setSession(res, Number(row.id));
    const profile = await pool.query("SELECT id, phone, contact_name, shop_name, category, description, public_contact FROM shops WHERE id = ?", [row.id]);
    res.json({ shop: normalizeShop(profile[0]) });
  } catch (error) {
    console.error("Shop login failed:", error.message);
    sendError(res, 500, "INTERNAL_ERROR", "ไม่สามารถเข้าสู่ระบบได้ในขณะนี้");
  }
});

app.post("/api/shop/logout", requireShop, requireCsrf, (req, res) => {
  sessions.delete(req.sessionToken);
  setCookies(res, [
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    `${CSRF_COOKIE}=; SameSite=Lax; Path=/; Max-Age=0`,
  ]);
  res.json({ ok: true });
});

app.get("/api/shop/me", requireShop, async (req, res) => {
  try {
    const rows = await pool.query("SELECT id, phone, contact_name, shop_name, category, description, public_contact FROM shops WHERE id = ? AND is_active = 1", [req.shopId]);
    if (!rows.length) return sendError(res, 401, "UNAUTHENTICATED", "บัญชีนี้ไม่พร้อมใช้งาน");
    res.json({ shop: normalizeShop(rows[0]) });
  } catch (error) {
    console.error("Shop profile read failed:", error.message);
    sendError(res, 500, "INTERNAL_ERROR", "ไม่สามารถโหลดข้อมูลร้านได้");
  }
});

app.patch("/api/shop/me", requireShop, requireCsrf, async (req, res) => {
  const body = req.body || {};
  const allowed = ["contact_name", "shop_name", "category", "description", "public_contact"];
  if (!Object.keys(body).length || Object.keys(body).some((key) => !allowed.includes(key))) return sendError(res, 400, "INVALID_FIELDS", "มีฟิลด์ที่ไม่อนุญาตหรือไม่มีข้อมูลแก้ไข");
  const fields = validateProfile(body, false);
  if (Object.keys(fields).length) return sendError(res, 422, "VALIDATION_ERROR", "กรุณาตรวจสอบข้อมูลที่กรอก", fields);
  try {
    const updates = [];
    const values = [];
    for (const field of allowed) if (body[field] !== undefined) { updates.push(`${field} = ?`); values.push(typeof body[field] === "string" ? body[field].trim() || null : null); }
    values.push(req.shopId);
    const result = await pool.query(`UPDATE shops SET ${updates.join(", ")} WHERE id = ? AND is_active = 1`, values);
    if (!result.affectedRows) return sendError(res, 404, "SHOP_NOT_FOUND", "ไม่พบข้อมูลร้านค้า");
    const rows = await pool.query("SELECT id, phone, contact_name, shop_name, category, description, public_contact FROM shops WHERE id = ?", [req.shopId]);
    res.json({ shop: normalizeShop(rows[0]) });
  } catch (error) {
    console.error("Shop profile update failed:", error.message);
    sendError(res, 500, "INTERNAL_ERROR", "ไม่สามารถบันทึกข้อมูลร้านได้");
  }
});

app.get("/api/shop/markets/:marketId/sessions/:sessionId/stalls", requireShop, async (req, res) => {
  const marketId = positiveId(req.params.marketId);
  const sessionId = positiveId(req.params.sessionId);
  if (!marketId || !sessionId) return sendError(res, 400, "INVALID_ID", "รหัสตลาดหรือรอบตลาดไม่ถูกต้อง");
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const zone = String(req.query.zone || "");
    const minPrice = req.query.min_price === undefined ? null : Number(req.query.min_price);
    const maxPrice = req.query.max_price === undefined ? null : Number(req.query.max_price);
    if ((minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0)) || (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0))) return sendError(res, 422, "VALIDATION_ERROR", "ช่วงราคาไม่ถูกต้อง");
    const count = await pool.query("SELECT COUNT(*) AS total FROM stalls s WHERE s.market_id = ? AND s.is_active = 1 AND (? = '' OR s.zone = ?) AND (? IS NULL OR s.price >= ?) AND (? IS NULL OR s.price <= ?)", [marketId, zone, zone, minPrice, minPrice, maxPrice, maxPrice]);
    const rows = await pool.query(`SELECT s.id, s.stall_code, s.zone, s.size_description, s.price, s.map_x, s.map_y,
      CASE WHEN EXISTS (SELECT 1 FROM bookings b WHERE b.stall_id = s.id AND b.session_id = ? AND b.status = 'confirmed') THEN 'occupied'
           WHEN EXISTS (SELECT 1 FROM bookings b WHERE b.stall_id = s.id AND b.session_id = ? AND b.status = 'pending') THEN 'pending' ELSE 'available' END AS availability
      FROM stalls s WHERE s.market_id = ? AND s.is_active = 1 AND (? = '' OR s.zone = ?) AND (? IS NULL OR s.price >= ?) AND (? IS NULL OR s.price <= ?) ORDER BY s.zone, s.stall_code LIMIT ? OFFSET ?`,
      [sessionId, sessionId, marketId, zone, zone, minPrice, minPrice, maxPrice, maxPrice, limit, offset]);
    res.json({ items: rows.map((row) => ({ ...row, id: Number(row.id) })), pagination: { limit, offset, total: Number(count[0].total) } });
  } catch (error) {
    console.error("Stall list failed:", error.message);
    sendError(res, 500, "INTERNAL_ERROR", "ไม่สามารถโหลดรายการแผงได้");
  }
});

const bookingSelect = `SELECT b.id, b.status, b.shop_note, b.decision_note, b.created_at, b.updated_at,
  ms.id AS session_id, ms.session_name, ms.starts_at, ms.ends_at, m.name AS market_name,
  s.id AS stall_id, s.stall_code, s.zone, s.size_description, s.price, s.map_x, s.map_y
  FROM bookings b JOIN market_sessions ms ON ms.id = b.session_id JOIN markets m ON m.id = ms.market_id JOIN stalls s ON s.id = b.stall_id`;

function shapeBooking(row) {
  return { id: Number(row.id), status: row.status, shop_note: row.shop_note, decision_note: row.decision_note, created_at: row.created_at, updated_at: row.updated_at,
    session: { id: Number(row.session_id), market_name: row.market_name, session_name: row.session_name, starts_at: row.starts_at, ends_at: row.ends_at },
    stall: { id: Number(row.stall_id), stall_code: row.stall_code, zone: row.zone, size_description: row.size_description, price: row.price, map_x: row.map_x, map_y: row.map_y } };
}

app.get("/api/shop/bookings", requireShop, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const status = String(req.query.status || "");
    if (status && !["pending", "confirmed", "rejected", "cancelled"].includes(status)) return sendError(res, 422, "VALIDATION_ERROR", "สถานะการจองไม่ถูกต้อง");
    const rows = await pool.query(`${bookingSelect} WHERE b.shop_id = ? AND (? = '' OR b.status = ?) ORDER BY b.created_at DESC LIMIT ? OFFSET ?`, [req.shopId, status, status, limit, offset]);
    const count = await pool.query("SELECT COUNT(*) AS total FROM bookings WHERE shop_id = ? AND (? = '' OR status = ?)", [req.shopId, status, status]);
    res.json({ items: rows.map(shapeBooking), pagination: { limit, offset, total: Number(count[0].total) } });
  } catch (error) {
    console.error("Booking list failed:", error.message);
    sendError(res, 500, "INTERNAL_ERROR", "ไม่สามารถโหลดรายการจองได้");
  }
});

app.get("/api/shop/bookings/:bookingId", requireShop, async (req, res) => {
  const bookingId = positiveId(req.params.bookingId);
  if (!bookingId) return sendError(res, 400, "INVALID_ID", "รหัสการจองไม่ถูกต้อง");
  try {
    const rows = await pool.query(`${bookingSelect} WHERE b.id = ? AND b.shop_id = ?`, [bookingId, req.shopId]);
    if (!rows.length) return sendError(res, 404, "BOOKING_NOT_FOUND", "ไม่พบรายการจองนี้");
    res.json({ booking: shapeBooking(rows[0]) });
  } catch (error) {
    console.error("Booking detail failed:", error.message);
    sendError(res, 500, "INTERNAL_ERROR", "ไม่สามารถโหลดรายละเอียดการจองได้");
  }
});

app.post("/api/shop/bookings", requireShop, requireCsrf, async (req, res) => {
  const sessionId = positiveId(req.body?.session_id);
  const stallId = positiveId(req.body?.stall_id);
  const shopNote = req.body?.shop_note;
  const fields = {};
  if (!sessionId) fields.session_id = "รอบตลาดไม่ถูกต้อง";
  if (!stallId) fields.stall_id = "หมายเลขแผงไม่ถูกต้อง";
  if (shopNote != null && !validText(shopNote, 500)) fields.shop_note = "หมายเหตุต้องไม่เกิน 500 ตัวอักษร";
  if (Object.keys(fields).length) return sendError(res, 422, "VALIDATION_ERROR", "กรุณาตรวจสอบข้อมูลการจอง", fields);
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const sessionsFound = await connection.query("SELECT id, market_id, status, booking_opens_at, booking_closes_at FROM market_sessions WHERE id = ? FOR UPDATE", [sessionId]);
    if (!sessionsFound.length) { await connection.rollback(); return sendError(res, 404, "SESSION_NOT_FOUND", "ไม่พบรอบตลาดนี้"); }
    const session = sessionsFound[0];
    const now = new Date();
    if (session.status !== "open" || (session.booking_opens_at && now < new Date(session.booking_opens_at)) || (session.booking_closes_at && now > new Date(session.booking_closes_at))) { await connection.rollback(); return sendError(res, 409, "BOOKING_CLOSED", "รอบตลาดนี้ยังไม่เปิดหรือปิดรับจองแล้ว"); }
    const stallsFound = await connection.query("SELECT id FROM stalls WHERE id = ? AND market_id = ? AND is_active = 1 FOR UPDATE", [stallId, session.market_id]);
    if (!stallsFound.length) { await connection.rollback(); return sendError(res, 404, "STALL_NOT_FOUND", "ไม่พบแผงนี้ในตลาดของรอบที่เลือก"); }
    const shopRows = await connection.query("SELECT id FROM shops WHERE id = ? AND is_active = 1 FOR UPDATE", [req.shopId]);
    if (!shopRows.length) { await connection.rollback(); return sendError(res, 401, "UNAUTHENTICATED", "บัญชีร้านค้าไม่พร้อมใช้งาน"); }
    const duplicate = await connection.query("SELECT id FROM bookings WHERE shop_id = ? AND session_id = ? AND stall_id = ? AND status IN ('pending','confirmed') LIMIT 1", [req.shopId, sessionId, stallId]);
    if (duplicate.length) { await connection.rollback(); return sendError(res, 409, "DUPLICATE_BOOKING", "คุณมีคำขอจองแผงนี้อยู่แล้ว"); }
    const occupied = await connection.query("SELECT id FROM bookings WHERE session_id = ? AND stall_id = ? AND status = 'confirmed' LIMIT 1", [sessionId, stallId]);
    if (occupied.length) { await connection.rollback(); return sendError(res, 409, "STALL_UNAVAILABLE", "แผงนี้ได้รับการยืนยันให้ร้านอื่นแล้ว"); }
    const inserted = await connection.query("INSERT INTO bookings (shop_id, session_id, stall_id, status, shop_note) VALUES (?, ?, ?, 'pending', ?)", [req.shopId, sessionId, stallId, shopNote?.trim() || null]);
    await connection.commit();
    const rows = await pool.query(`${bookingSelect} WHERE b.id = ? AND b.shop_id = ?`, [inserted.insertId, req.shopId]);
    res.status(201).json({ booking: shapeBooking(rows[0]) });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Booking creation failed:", error.message);
    sendError(res, 500, "INTERNAL_ERROR", "ไม่สามารถส่งคำขอจองได้ในขณะนี้");
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/shop/bookings/:bookingId/cancel", requireShop, requireCsrf, async (req, res) => {
  const bookingId = positiveId(req.params.bookingId);
  if (!bookingId) return sendError(res, 400, "INVALID_ID", "รหัสการจองไม่ถูกต้อง");
  try {
    const result = await pool.query("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND shop_id = ? AND status = 'pending'", [bookingId, req.shopId]);
    if (!result.affectedRows) {
      const found = await pool.query("SELECT id FROM bookings WHERE id = ? AND shop_id = ?", [bookingId, req.shopId]);
      if (!found.length) return sendError(res, 404, "BOOKING_NOT_FOUND", "ไม่พบรายการจองนี้");
      return sendError(res, 409, "BOOKING_CANNOT_BE_CANCELLED", "ยกเลิกได้เฉพาะคำขอที่รอตรวจสอบ");
    }
    const rows = await pool.query("SELECT id, status, updated_at FROM bookings WHERE id = ?", [bookingId]);
    res.json({ booking: { id: Number(rows[0].id), status: rows[0].status, updated_at: rows[0].updated_at } });
  } catch (error) {
    console.error("Booking cancellation failed:", error.message);
    sendError(res, 500, "INTERNAL_ERROR", "ไม่สามารถยกเลิกคำขอจองได้");
  }
});

app.use("/api", (req, res) => sendError(res, 404, "NOT_FOUND", "ไม่พบ API นี้"));

async function start() {
  try {
    await ensureSchema();
    app.listen(port, () => console.log(`Server listening at http://localhost:${port}`));
  } catch (error) {
    console.error("Database schema initialization failed:", error.message);
    process.exitCode = 1;
  }
}

start();
