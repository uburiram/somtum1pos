'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { hashPassword } = require('./password');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const os = require('os');

function resolveDataDir() {
  if (process.env.SOM_TUM_DATA) {
    return path.resolve(process.env.SOM_TUM_DATA);
  }
  // ค่าเริ่มต้น: <โปรเจกต์>/data
  return path.join(PROJECT_ROOT, 'data');
}

function openDatabase() {
  const candidates = [
    resolveDataDir(),
    path.join(os.tmpdir(), 'somtum1pos-data')
  ];
  // ถ้า path โปรเจกต์เคยพัง ให้ลอง tmp ก่อนในรอบถัดไปผ่าน env
  if (process.env.SOM_TUM_FORCE_TMP === '1') {
    candidates.unshift(path.join(os.tmpdir(), 'somtum1pos-data'));
  }
  let lastErr;
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const dbPath = path.join(dir, 'somtum.db');
      const database = new DatabaseSync(dbPath);
      database.exec('PRAGMA journal_mode = DELETE;');
      database.exec('PRAGMA foreign_keys = ON;');
      // smoke test write
      database.exec('CREATE TABLE IF NOT EXISTS __boot_check (x INTEGER);');
      database.prepare('INSERT INTO __boot_check (x) VALUES (?)').run(1);
      database.exec('DROP TABLE IF EXISTS __boot_check;');
      console.log('[db] using', dbPath);
      return { database, DATA_DIR: dir, DB_PATH: dbPath };
    } catch (e) {
      lastErr = e;
      console.warn('[db] cannot use', dir, '-', e.message);
    }
  }
  throw lastErr || new Error('Cannot open SQLite database');
}

const { database: db, DATA_DIR, DB_PATH } = openDatabase();

/** Schema versioning — additive only, never drop user data */
function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    );
  `);

  let row = db.prepare('SELECT version FROM schema_version LIMIT 1').get();
  if (!row) {
    db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
    row = { version: 0 };
  }

  let v = row.version;

  if (v < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS staff (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'staff',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS menus (
        id TEXT PRIMARY KEY,
        category_id TEXT,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        image_url TEXT DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        is_out INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (category_id) REFERENCES categories(id)
      );
      CREATE TABLE IF NOT EXISTS spice_levels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS toppings (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        queue TEXT NOT NULL,
        items_json TEXT NOT NULL,
        total REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'Pending',
        payment_method TEXT NOT NULL DEFAULT 'CASH',
        payment_status TEXT NOT NULL DEFAULT 'UNPAID',
        paid_amount REAL DEFAULT 0,
        change_amount REAL DEFAULT 0,
        slip_path TEXT,
        slip_status TEXT DEFAULT NULL,
        slip_verified_at INTEGER,
        slip_amount REAL,
        note TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
      CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(payment_status);
    `);
    db.prepare('UPDATE schema_version SET version = 1').run();
    v = 1;
  }

  // Future migrations: if (v < 2) { ... additive only ... }
}

function getSetting(key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

function seedIfEmpty() {
  const catCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (catCount > 0) return;

  const now = Date.now();
  const cats = [
    ['c1', 'เมนูส้มตำ', 1],
    ['c2', 'เมนูยำ', 2],
    ['c3', 'เมนูของทอด', 3],
    ['c4', 'เมนูทานเล่น', 4],
    ['c5', 'เครื่องดื่ม', 5]
  ];
  const insCat = db.prepare('INSERT INTO categories (id, name, sort_order, is_active) VALUES (?, ?, ?, 1)');
  for (const c of cats) insCat.run(...c);

  const menus = [
    ['m1', 'c1', 'ตำปูปลาร้า', 40],
    ['m2', 'c1', 'ตำไทย', 40],
    ['m3', 'c1', 'ตำป่า', 45],
    ['m4', 'c1', 'ตำแตง', 40],
    ['m5', 'c1', 'ตำถั่ว', 40],
    ['m6', 'c2', 'ยำวุ้นเส้น', 50],
    ['m7', 'c2', 'ยำมาม่า', 45],
    ['m8', 'c3', 'ไก่ทอด', 50],
    ['m9', 'c3', 'ปีกไก่ทอด', 40],
    ['m10', 'c4', 'ไข่ต้ม', 10],
    ['m11', 'c5', 'น้ำเปล่า', 10],
    ['m12', 'c5', 'น้ำอัดลม', 15]
  ];
  const insMenu = db.prepare(
    'INSERT INTO menus (id, category_id, name, price, image_url, is_active, is_out) VALUES (?, ?, ?, ?, ?, 1, 0)'
  );
  for (const m of menus) insMenu.run(m[0], m[1], m[2], m[3], '');

  const spices = [
    ['s1', 'ไม่เผ็ด'],
    ['s2', 'เผ็ดน้อย'],
    ['s3', 'เผ็ดกลาง'],
    ['s4', 'เผ็ดมาก'],
    ['s5', 'เผ็ดมากๆ']
  ];
  const insSpice = db.prepare('INSERT INTO spice_levels (id, name, is_active) VALUES (?, ?, 1)');
  for (const s of spices) insSpice.run(...s);

  const tops = [
    ['t1', 'ไข่ดาว', 10],
    ['t2', 'ไข่ต้ม', 10],
    ['t3', 'เพิ่มปู', 20],
    ['t4', 'เพิ่มหมูกรอบ', 15],
    ['t5', 'เพิ่มเส้น/พิเศษ', 15]
  ];
  const insTop = db.prepare('INSERT INTO toppings (id, name, price, is_active) VALUES (?, ?, ?, 1)');
  for (const t of tops) insTop.run(...t);

  setSetting('shopName', 'ส้มตำนายหนึ่ง');
  setSetting('promptpay', '0812345678');
  setSetting('queueCounter', '1');
  setSetting('slipApiEnabled', '0');
  setSetting('slipApiProvider', 'manual'); // manual | easyslip | slipok
  setSetting('slipApiKey', '');

  // Default staff: admin / 1234
  const hash = hashPassword('1234');
  db.prepare(
    'INSERT INTO staff (id, username, password_hash, display_name, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
  ).run('staff1', 'admin', hash, 'เจ้าของร้าน', 'admin', now);
}

migrate();
seedIfEmpty();

module.exports = { db, getSetting, setSetting, DB_PATH };
