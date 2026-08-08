'use strict';
/**
 * Somtum1POS v3 — pure Node.js (no npm deps required at runtime except optional)
 * Uses: node:http, node:sqlite, node:crypto, SSE for realtime
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { randomUUID, createHmac, timingSafeEqual, scryptSync, randomBytes } = require('crypto');
const { db, getSetting, setSetting } = require('./db');
const { verifySlip } = require('./slip');

const PORT = Number(process.env.PORT) || 3080;
const JWT_SECRET = process.env.JWT_SECRET || 'somtum1pos-change-me-in-production-2026';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(PROJECT_ROOT, 'public');
const UPLOAD_DIR = path.join(PUBLIC, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---- minimal JWT (HS256) ----
function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}
function signToken(payload, expiresSec = 12 * 3600) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + expiresSec }));
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
function verifyToken(token) {
  try {
    const [h, b, s] = token.split('.');
    const expect = createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
    if (s.length !== expect.length || !timingSafeEqual(Buffer.from(s), Buffer.from(expect))) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// ---- password (already in password.js via db seed) ----
const { verifyPassword } = require('./password');

// ---- SSE clients ----
const sseClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { sseClients.delete(res); }
  }
}

function getOrderStats() {
  const active = db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE status != 'Completed'`).get().c;
  const pending = db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE status = 'Pending'`).get().c;
  const cooking = db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE status = 'Cooking'`).get().c;
  const ready = db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE status = 'Ready'`).get().c;
  const unpaid = db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE payment_status = 'UNPAID' AND status != 'Completed'`).get().c;
  const slipPending = db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE slip_status IN ('pending_review','pending_manual')`).get().c;
  return { active, pending, cooking, ready, unpaid, slipPending };
}

function nextQueue() {
  let n = Number(getSetting('queueCounter', '1')) || 1;
  if (n > 999) n = 1;
  const q = 'A' + String(n).padStart(3, '0');
  setSetting('queueCounter', String(n + 1));
  return q;
}

function mapOrder(row) {
  if (!row) return null;
  return {
    id: row.id, queue: row.queue,
    items: JSON.parse(row.items_json || '[]'),
    total: row.total, status: row.status,
    paymentMethod: row.payment_method, paymentStatus: row.payment_status,
    paidAmount: row.paid_amount, changeAmount: row.change_amount,
    slipPath: row.slip_path ? '/uploads/' + path.basename(row.slip_path) : null,
    slipStatus: row.slip_status, slipVerifiedAt: row.slip_verified_at,
    slipAmount: row.slip_amount, note: row.note,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

/** Parse multipart for single file field "slip" — minimal parser */
async function parseMultipart(req) {
  const ctype = req.headers['content-type'] || '';
  const m = ctype.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) throw new Error('no boundary');
  const boundary = m[1] || m[2];
  const buf = await readBody(req);
  const parts = buf.toString('binary').split('--' + boundary);
  let file = null;
  for (const part of parts) {
    if (!part.includes('Content-Disposition')) continue;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    let body = part.slice(headerEnd + 4);
    if (body.endsWith('\r\n')) body = body.slice(0, -2);
    if (headers.includes('filename=')) {
      const fm = headers.match(/filename="([^"]*)"/);
      const name = fm ? fm[1] : 'slip.jpg';
      const ext = path.extname(name).toLowerCase() || '.jpg';
      const fname = `slip_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
      const fpath = path.join(UPLOAD_DIR, fname);
      fs.writeFileSync(fpath, Buffer.from(body, 'binary'));
      file = { path: fpath, filename: fname };
    }
  }
  return { file };
}

function getAuth(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  return verifyToken(h.slice(7));
}

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
      });
      return res.end();
    }

    const u = new URL(req.url, `http://${req.headers.host}`);
    const p = u.pathname;
    const method = req.method;

    // SSE realtime
    if (method === 'GET' && p === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write(`event: orders:update\ndata: ${JSON.stringify(getOrderStats())}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // Health / public shop
    if (method === 'GET' && p === '/api/health') {
      return json(res, 200, { ok: true, shop: getSetting('shopName', 'ส้มตำนายหนึ่ง') });
    }
    if (method === 'GET' && p === '/api/public/shop') {
      return json(res, 200, {
        shopName: getSetting('shopName', 'ส้มตำนายหนึ่ง'),
        promptpay: getSetting('promptpay', ''),
        hasPromptPay: !!getSetting('promptpay', '')
      });
    }
    if (method === 'GET' && p === '/api/public/menu') {
      const categories = db.prepare(
        'SELECT id, name, sort_order AS sortOrder FROM categories WHERE is_active = 1 ORDER BY sort_order'
      ).all();
      const menus = db.prepare(
        `SELECT id, category_id AS categoryId, name, price, image_url AS imageUrl, is_out AS isOut
         FROM menus WHERE is_active = 1`
      ).all().map(m => ({ ...m, isOut: !!m.isOut }));
      const spiceLevels = db.prepare('SELECT id, name FROM spice_levels WHERE is_active = 1').all();
      const toppings = db.prepare('SELECT id, name, price FROM toppings WHERE is_active = 1').all();
      return json(res, 200, { categories, menus, spiceLevels, toppings });
    }

    // Create order
    if (method === 'POST' && p === '/api/public/orders') {
      const body = await readJson(req);
      const items = body.items;
      if (!Array.isArray(items) || !items.length) return json(res, 400, { error: 'ไม่มีรายการอาหาร' });
      const total = items.reduce((s, i) => s + Number(i.total || i.unitPrice * i.qty), 0);
      if (total <= 0) return json(res, 400, { error: 'ยอดรวมไม่ถูกต้อง' });
      const payMethod = body.paymentMethod === 'PROMPTPAY' ? 'PROMPTPAY' : 'CASH';
      const now = Date.now();
      const id = randomUUID();
      const queue = nextQueue();
      db.prepare(
        `INSERT INTO orders (id, queue, items_json, total, status, payment_method, payment_status,
          paid_amount, change_amount, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Pending', ?, 'UNPAID', 0, 0, ?, ?, ?)`
      ).run(id, queue, JSON.stringify(items), total, payMethod, body.note || '', now, now);
      const order = mapOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
      broadcast('orders:update', getOrderStats());
      broadcast('order:new', order);
      return json(res, 201, { order });
    }

    // Get order by id (customer track)
    const pubOrder = p.match(/^\/api\/public\/orders\/([^/]+)$/);
    if (method === 'GET' && pubOrder) {
      const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(pubOrder[1]);
      if (!row) return json(res, 404, { error: 'ไม่พบออเดอร์' });
      return json(res, 200, { order: mapOrder(row) });
    }

    // Upload slip
    const slipPath = p.match(/^\/api\/public\/orders\/([^/]+)\/slip$/);
    if (method === 'POST' && slipPath) {
      const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(slipPath[1]);
      if (!row) return json(res, 404, { error: 'ไม่พบออเดอร์' });
      if (row.payment_status === 'PAID') return json(res, 400, { error: 'ออเดอร์นี้ชำระเงินแล้ว' });
      const { file } = await parseMultipart(req);
      if (!file) return json(res, 400, { error: 'ไม่พบไฟล์สลิป' });
      const result = await verifySlip({
        imagePath: file.path,
        amount: row.total,
        promptpay: getSetting('promptpay', '')
      });
      const now = Date.now();
      if (result.ok) {
        db.prepare(
          `UPDATE orders SET slip_path=?, slip_status='verified', slip_verified_at=?, slip_amount=?,
            payment_status='PAID', payment_method='PROMPTPAY', paid_amount=?, change_amount=0, updated_at=?
           WHERE id=?`
        ).run(file.path, now, result.amount ?? row.total, result.amount ?? row.total, now, row.id);
      } else {
        const st = result.pendingManual ? 'pending_manual' : 'rejected';
        db.prepare(
          `UPDATE orders SET slip_path=?, slip_status=?, slip_amount=?, updated_at=? WHERE id=?`
        ).run(file.path, st, result.amount ?? null, now, row.id);
      }
      const order = mapOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(row.id));
      broadcast('orders:update', getOrderStats());
      broadcast('order:updated', order);
      return json(res, 200, {
        order,
        verification: {
          ok: !!result.ok,
          provider: result.provider,
          reason: result.reason || null,
          pendingManual: !!result.pendingManual
        }
      });
    }

    // Login
    if (method === 'POST' && p === '/api/auth/login') {
      const body = await readJson(req);
      const staff = db.prepare('SELECT * FROM staff WHERE username = ? AND is_active = 1').get(String(body.username || '').trim());
      if (!staff || !verifyPassword(String(body.password || ''), staff.password_hash)) {
        return json(res, 401, { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
      }
      const token = signToken({ sub: staff.id, username: staff.username, role: staff.role, name: staff.display_name });
      return json(res, 200, {
        token,
        user: { id: staff.id, username: staff.username, displayName: staff.display_name, role: staff.role }
      });
    }

    if (method === 'GET' && p === '/api/auth/me') {
      const user = getAuth(req);
      if (!user) return json(res, 401, { error: 'ต้องเข้าสู่ระบบ' });
      return json(res, 200, { user });
    }

    // Merchant routes require auth
    const needAuth = p.startsWith('/api/orders') || p.startsWith('/api/admin');
    let user = null;
    if (needAuth) {
      user = getAuth(req);
      if (!user) return json(res, 401, { error: 'ต้องเข้าสู่ระบบ' });
    }

    if (method === 'GET' && p === '/api/orders/stats') {
      return json(res, 200, getOrderStats());
    }

    if (method === 'GET' && p === '/api/orders') {
      const filter = u.searchParams.get('filter') || 'active';
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const t0 = todayStart.getTime();
      let rows;
      if (filter === 'active') rows = db.prepare(`SELECT * FROM orders WHERE status != 'Completed' ORDER BY created_at DESC`).all();
      else if (filter === 'unpaid') rows = db.prepare(`SELECT * FROM orders WHERE payment_status='UNPAID' AND status!='Completed' ORDER BY created_at DESC`).all();
      else if (filter === 'slip') rows = db.prepare(`SELECT * FROM orders WHERE slip_status IN ('pending_review','pending_manual') ORDER BY created_at DESC`).all();
      else if (filter === 'completed') rows = db.prepare(`SELECT * FROM orders WHERE status='Completed' AND created_at>=? ORDER BY created_at DESC`).all(t0);
      else if (filter === 'today') rows = db.prepare(`SELECT * FROM orders WHERE created_at>=? ORDER BY created_at DESC`).all(t0);
      else rows = db.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 200`).all();
      return json(res, 200, { orders: rows.map(mapOrder), stats: getOrderStats() });
    }

    const orderId = p.match(/^\/api\/orders\/([^/]+)$/);
    if (method === 'GET' && orderId) {
      const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId[1]);
      if (!row) return json(res, 404, { error: 'ไม่พบออเดอร์' });
      return json(res, 200, { order: mapOrder(row) });
    }

    const statusPath = p.match(/^\/api\/orders\/([^/]+)\/status$/);
    if (method === 'PATCH' && statusPath) {
      const body = await readJson(req);
      const allowed = ['Pending', 'Cooking', 'Ready', 'Completed'];
      if (!allowed.includes(body.status)) return json(res, 400, { error: 'สถานะไม่ถูกต้อง' });
      const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(statusPath[1]);
      if (!row) return json(res, 404, { error: 'ไม่พบออเดอร์' });
      db.prepare(`UPDATE orders SET status=?, updated_at=? WHERE id=?`).run(body.status, Date.now(), row.id);
      const order = mapOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(row.id));
      broadcast('orders:update', getOrderStats());
      broadcast('order:updated', order);
      return json(res, 200, { order });
    }

    const payPath = p.match(/^\/api\/orders\/([^/]+)\/pay$/);
    if (method === 'POST' && payPath) {
      const body = await readJson(req);
      const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(payPath[1]);
      if (!row) return json(res, 404, { error: 'ไม่พบออเดอร์' });
      if (row.payment_status === 'PAID') return json(res, 400, { error: 'ชำระเงินแล้ว' });
      const payMethod = body.method === 'PROMPTPAY' ? 'PROMPTPAY' : 'CASH';
      const paid = payMethod === 'CASH' ? Number(body.paidAmount) : Number(row.total);
      if (payMethod === 'CASH' && (isNaN(paid) || paid < row.total)) return json(res, 400, { error: 'จำนวนเงินไม่พอ' });
      const change = payMethod === 'CASH' ? paid - row.total : 0;
      const now = Date.now();
      db.prepare(
        `UPDATE orders SET payment_status='PAID', payment_method=?, paid_amount=?, change_amount=?,
          slip_status=COALESCE(slip_status,'manual_confirmed'), updated_at=? WHERE id=?`
      ).run(payMethod, paid, change, now, row.id);
      const order = mapOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(row.id));
      broadcast('orders:update', getOrderStats());
      broadcast('order:updated', order);
      return json(res, 200, { order });
    }

    const confirmSlip = p.match(/^\/api\/orders\/([^/]+)\/confirm-slip$/);
    if (method === 'POST' && confirmSlip) {
      const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(confirmSlip[1]);
      if (!row) return json(res, 404, { error: 'ไม่พบออเดอร์' });
      if (!row.slip_path) return json(res, 400, { error: 'ยังไม่มีสลิป' });
      const now = Date.now();
      db.prepare(
        `UPDATE orders SET payment_status='PAID', payment_method='PROMPTPAY', paid_amount=total,
          change_amount=0, slip_status='manual_confirmed', slip_verified_at=?, updated_at=? WHERE id=?`
      ).run(now, now, row.id);
      const order = mapOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(row.id));
      broadcast('orders:update', getOrderStats());
      broadcast('order:updated', order);
      return json(res, 200, { order });
    }

    // Admin catalog / settings / reports
    if (method === 'GET' && p === '/api/admin/catalog') {
      return json(res, 200, {
        categories: db.prepare('SELECT * FROM categories ORDER BY sort_order').all(),
        menus: db.prepare('SELECT * FROM menus').all(),
        spiceLevels: db.prepare('SELECT * FROM spice_levels').all(),
        toppings: db.prepare('SELECT * FROM toppings').all()
      });
    }

    if (method === 'PUT' && p.match(/^\/api\/admin\/menus\/([^/]+)$/)) {
      const id = p.split('/').pop();
      const row = db.prepare('SELECT * FROM menus WHERE id = ?').get(id);
      if (!row) return json(res, 404, { error: 'ไม่พบ' });
      const b = await readJson(req);
      db.prepare(
        `UPDATE menus SET name=?, price=?, category_id=?, image_url=?, is_active=?, is_out=? WHERE id=?`
      ).run(
        b.name != null ? String(b.name).trim() : row.name,
        b.price != null ? Number(b.price) : row.price,
        b.categoryId !== undefined ? b.categoryId : row.category_id,
        b.imageUrl != null ? b.imageUrl : row.image_url,
        b.isActive != null ? (b.isActive ? 1 : 0) : row.is_active,
        b.isOut != null ? (b.isOut ? 1 : 0) : row.is_out,
        row.id
      );
      return json(res, 200, { ok: true });
    }

    if (method === 'GET' && p === '/api/admin/settings') {
      return json(res, 200, {
        shopName: getSetting('shopName', ''),
        promptpay: getSetting('promptpay', ''),
        slipApiEnabled: getSetting('slipApiEnabled', '0') === '1',
        slipApiProvider: getSetting('slipApiProvider', 'manual'),
        hasSlipApiKey: !!getSetting('slipApiKey', '')
      });
    }

    if (method === 'PUT' && p === '/api/admin/settings') {
      const b = await readJson(req);
      if (b.shopName != null) setSetting('shopName', String(b.shopName).trim());
      if (b.promptpay != null) {
        const pp = String(b.promptpay).replace(/\D/g, '');
        if (pp && pp.length !== 10 && pp.length !== 13) {
          return json(res, 400, { error: 'PromptPay ต้อง 10 หรือ 13 หลัก' });
        }
        setSetting('promptpay', pp);
      }
      if (b.slipApiEnabled != null) setSetting('slipApiEnabled', b.slipApiEnabled ? '1' : '0');
      if (b.slipApiProvider != null) setSetting('slipApiProvider', String(b.slipApiProvider));
      if (b.slipApiKey != null && String(b.slipApiKey).trim()) setSetting('slipApiKey', String(b.slipApiKey).trim());
      return json(res, 200, { ok: true });
    }

    if (method === 'GET' && p === '/api/admin/reports/today') {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const t0 = todayStart.getTime();
      const orders = db.prepare('SELECT * FROM orders WHERE created_at >= ?').all(t0);
      const paid = orders.filter(o => o.payment_status === 'PAID');
      const sales = paid.reduce((s, o) => s + o.total, 0);
      const menuCount = {};
      for (const o of orders) {
        try {
          for (const it of JSON.parse(o.items_json || '[]')) {
            menuCount[it.name] = (menuCount[it.name] || 0) + Number(it.qty || 0);
          }
        } catch {}
      }
      const topMenus = Object.entries(menuCount).sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([name, qty]) => ({ name, qty }));
      return json(res, 200, {
        orderCount: orders.length, paidCount: paid.length,
        unpaidCount: orders.filter(o => o.payment_status === 'UNPAID').length,
        completedCount: orders.filter(o => o.status === 'Completed').length,
        sales, totalValue: orders.reduce((s, o) => s + o.total, 0), topMenus
      });
    }

    // Static files
    if (method === 'GET') {
      if (p === '/' || p === '/order') return serveStatic(res, path.join(PUBLIC, 'customer.html'));
      if (p === '/pos' || p === '/merchant') return serveStatic(res, path.join(PUBLIC, 'merchant.html'));
      if (p.startsWith('/uploads/')) {
        const fp = path.join(UPLOAD_DIR, path.basename(p));
        return serveStatic(res, fp);
      }
      const fp = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (fp.startsWith(PUBLIC)) return serveStatic(res, fp);
    }

    json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Somtum1POS v3  http://localhost:${PORT}`);
  console.log(`  ลูกค้า (QR):  http://localhost:${PORT}/`);
  console.log(`  ร้านค้า:      http://localhost:${PORT}/pos`);
  console.log(`  Login: admin / 1234`);
});
