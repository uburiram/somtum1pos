/**
 * Somtum1POS Cloud Functions
 *
 * Deploy (ต้องใช้ Firebase Blaze):
 *   npm install -g firebase-tools
 *   firebase login
 *   firebase init functions  (เลือกโปรเจกต์ pos1-4d72a)
 *   วางไฟล์นี้ + package.json แล้ว:
 *   firebase functions:config:set easyslip.key="YOUR_EASYSLIP_KEY"
 *   firebase deploy --only functions
 *
 * Endpoints:
 *   POST /verifySlip   { orderId, shopId, slipDataUrl }
 *   (auto) onOrderCreate → ส่ง FCM ไปเครื่องร้าน
 */
'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const FormData = require('form-data');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

const REGION = 'asia-southeast1';

function getEasySlipKey() {
  try {
    return (functions.config().easyslip && functions.config().easyslip.key) || process.env.EASYSLIP_KEY || '';
  } catch (e) {
    return process.env.EASYSLIP_KEY || '';
  }
}

/** แปลง dataURL → Buffer */
function dataUrlToBuffer(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) throw new Error('slipData ต้องเป็น data URL รูปภาพ JPEG/PNG/WebP');
  const raw = m[2].replace(/\s+/g, '');
  // กัน payload ขนาดใหญ่เกินกว่าที่ระบบจะเก็บใน Firestore ได้อย่างปลอดภัย
  if (raw.length > 190000) throw new Error('slipData ใหญ่เกินกำหนด');
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length || buffer.length > 140000) throw new Error('ขนาดรูปสลิปไม่ถูกต้อง');
  return buffer;
}

function extractVerifiedAmount(json) {
  const candidates = [
    json && json.data && json.data.amount && json.data.amount.amount,
    json && json.data && json.data.amount,
    json && json.amount && json.amount.amount,
    json && json.amount
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function slipHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function verifyWithEasySlip(buffer, amount) {
  const apiKey = getEasySlipKey();
  if (!apiKey) {
    return { ok: false, reason: 'ยังไม่ได้ตั้ง EasySlip key ใน Functions config' };
  }
  const form = new FormData();
  form.append('file', buffer, { filename: 'slip.jpg', contentType: 'image/jpeg' });
  if (amount) form.append('amount', String(Number(amount)));

  const res = await fetch('https://developer.easyslip.com/api/v1/verify', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, ...form.getHeaders() },
    body: form
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch (e) {}
  if (!res.ok) {
    return { ok: false, reason: 'EasySlip HTTP ' + res.status, raw: text.slice(0, 300) };
  }
  const paid = extractVerifiedAmount(json);
  if (amount > 0 && (!paid || Math.abs(paid - Number(amount)) > 1)) {
    return { ok: false, reason: paid ? ('ยอดในสลิปไม่ตรง ฿' + paid) : 'ระบบตรวจไม่พบยอดเงินในผลตรวจสลิป', raw: json };
  }
  // บางแพ็กเกจใช้ status field
  const status = (json.status || (json.data && json.data.status) || '').toString().toLowerCase();
  if (status && status !== 'success' && status !== 'ok' && json.success === false) {
    return { ok: false, reason: 'สลิปไม่ผ่านการตรวจสอบ', raw: json };
  }
  return { ok: true, reason: 'ตรวจสลิปผ่าน', raw: json, paid: paid || amount };
}

/**
 * ลูกค้า / ร้าน เรียกเพื่อตรวจสลิปฝั่งเซิร์ฟเวอร์ (ไม่มี CORS)
 * Body JSON: { shopId, orderId, slipData }
 */
exports.verifySlip = functions.region(REGION).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const shopId = body.shopId || 'main';
    const orderId = body.orderId;
    const slipData = body.slipData;
    if (!orderId || !slipData) {
      return res.status(400).json({ ok: false, error: 'ต้องมี orderId และ slipData' });
    }

    const ref = db.collection('shops').doc(shopId).collection('orders').doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'ไม่พบออเดอร์' });
    const order = snap.data() || {};
    if (order.paymentStatus === 'PAID') {
      return res.json({ ok: true, alreadyPaid: true, msg: 'ชำระแล้ว' });
    }
    if (order.status === 'Cancelled' || order.status === 'Completed') {
      return res.status(409).json({ ok: false, error: 'ออเดอร์ปิดแล้ว ไม่สามารถตรวจสลิปได้' });
    }

    const buf = dataUrlToBuffer(slipData);
    const hash = slipHash(buf);
    if (order.slipHash && order.slipHash === hash) {
      return res.status(409).json({ ok: false, error: 'สลิปนี้ถูกส่งตรวจแล้ว' });
    }

    // ยอดที่ต้องตรงในสลิป = ส่วนต่าง (ถ้า needsRepay) ไม่งั้นยอดเต็มบิล
    const billTotal = Math.max(0, Number(order.total || 0));
    const already = Math.max(0, Number(order.paidAmount || 0));
    const expectAmt = order.needsRepay
      ? Math.max(0, Number(order.repayAmount != null ? order.repayAmount : (billTotal - already)))
      : billTotal;
    if (!(expectAmt > 0)) {
      return res.status(409).json({ ok: false, error: 'ออเดอร์นี้ไม่มียอดที่ต้องชำระผ่านสลิป' });
    }
    const result = await verifyWithEasySlip(buf, expectAmt);

    if (result.ok) {
      // ยืนยันอีกครั้งแบบ transaction เพื่อกันการยิงสลิปซ้ำพร้อมกันหลาย request
      const committed = await db.runTransaction(async (tx) => {
        const latest = await tx.get(ref);
        if (!latest.exists) return false;
        const cur = latest.data() || {};
        if (cur.paymentStatus === 'PAID' || cur.slipHash === hash) return false;
        const latestTotal = Math.max(0, Number(cur.total || 0));
        if (cur.status === 'Cancelled' || cur.status === 'Completed') return false;
        const alreadyPaid = Math.max(0, Number(cur.paidAmount || 0));
        const expectNow = cur.needsRepay
          ? Math.max(0, Number(cur.repayAmount != null ? cur.repayAmount : (latestTotal - alreadyPaid)))
          : latestTotal;
        const verifiedAmt = Number(result.paid || 0);
        if (expectNow > 0 && verifiedAmt > 0 && Math.abs(verifiedAmt - expectNow) > 1) {
          tx.update(ref, {
            slipData: String(slipData).slice(0, 200000),
            slipHash: hash,
            slipStatus: 'PENDING_REVIEW',
            slipAutoReason: 'ยอดออเดอร์เปลี่ยนระหว่างตรวจ (สลิป ฿' + verifiedAmt + ' / ต้องชำระ ฿' + expectNow + ')'
          });
          return 'mismatch';
        }
        tx.update(ref, {
          slipData: String(slipData).slice(0, 200000),
          slipHash: hash,
          slipStatus: 'APPROVED',
          paymentStatus: 'PAID',
          paidAmount: latestTotal,
          paidAt: Date.now(),
          paymentMethod: cur.paymentMethod || 'PROMPTPAY',
          status: cur.status === 'AwaitingPayment' ? 'Pending' : (cur.status || 'Pending'),
          slipAuto: true,
          needsRepay: false,
          repayAmount: 0
        });
        return true;
      });
      if (committed === 'mismatch') {
        return res.json({ ok: false, pendingManual: true, needManual: true, msg: 'ยอดออเดอร์เปลี่ยนระหว่างตรวจสลิป · รอร้านตรวจมือ' });
      }
      if (!committed) {
        return res.json({ ok: true, alreadyPaid: true, msg: 'รายการถูกยืนยันไปแล้ว' });
      }
      return res.json({ ok: true, msg: result.reason, autoPaid: true });
    }

    // ไม่ผ่าน → รอร้านตรวจมือ
    await ref.update({
      slipData: String(slipData).slice(0, 200000),
      slipHash: hash,
      slipStatus: 'PENDING_REVIEW',
      slipAutoReason: result.reason || 'รอตรวจมือ'
    });
    // ส่งทั้ง pendingManual และ needManual เพื่อให้ client เวอร์ชันเก่า/ใหม่รองรับ
    return res.json({ ok: false, pendingManual: true, needManual: true, msg: result.reason || 'รอร้านตรวจสอบสลิป' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/**
 * เมื่อมีออเดอร์ใหม่ → ดึง FCM tokens ของร้าน แล้วส่งแจ้งเตือน
 */
exports.onOrderCreate = functions.region(REGION).firestore
  .document('shops/{shopId}/orders/{orderId}')
  .onCreate(async (snap, context) => {
    const order = snap.data() || {};
    const shopId = context.params.shopId;
    const queue = order.queue || '-';
    const total = order.total || 0;

    const tokensSnap = await db.collection('shops').doc(shopId).collection('fcmTokens').get();
    const tokens = tokensSnap.docs.map((d) => d.id).filter(Boolean);
    if (!tokens.length) {
      console.log('no FCM tokens for shop', shopId);
      return null;
    }

    const payload = {
      notification: {
        title: '🔔 ออเดอร์ใหม่ ' + queue,
        body: 'ยอด ฿' + total + ' · ' + (order.paymentMethod === 'CASH' ? 'เงินสด' : 'QR')
      },
      data: {
        orderId: context.params.orderId,
        queue: String(queue),
        click_action: 'FLUTTER_NOTIFICATION_CLICK'
      }
    };

    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: payload.notification,
      data: payload.data,
      webpush: {
        fcmOptions: { link: '/pos.html' },
        notification: {
          icon: '/icon/icon-192.png',
          requireInteraction: true
        }
      }
    });
    console.log('FCM sent', res.successCount, 'fail', res.failureCount);

    // ลบ token ตาย
    const stale = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          stale.push(tokens[i]);
        }
      }
    });
    await Promise.all(stale.map((t) => db.collection('shops').doc(shopId).collection('fcmTokens').doc(t).delete().catch(() => {})));
    return null;
  });


/**
 * ร้านยืนยันรับเงิน (ต้องมี X-Shop-Secret ตรงกับ functions config shop.secret)
 * ใช้ Admin SDK ข้าม client rules — ปลอดภัยกว่าให้ client ตั้ง PAID เอง
 */
exports.markOrderPaid = functions.region(REGION).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Shop-Secret');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  try {
    let secret = '';
    try {
      secret = (functions.config().shop && functions.config().shop.secret) || process.env.SHOP_SECRET || '';
    } catch (e) {
      secret = process.env.SHOP_SECRET || '';
    }
    const got = req.get('x-shop-secret') || req.get('X-Shop-Secret') || '';
    if (!secret || got !== secret) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const shopId = body.shopId || 'main';
    const orderId = body.orderId;
    const patch = body.patch || {};
    if (!orderId) return res.status(400).json({ ok: false, error: 'orderId required' });

    const ref = db.collection('shops').doc(shopId).collection('orders').doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'order not found' });
    const order = snap.data() || {};

    const update = {
      paymentStatus: 'PAID',
      paidAt: Number(patch.paidAt) || Date.now(),
      paidAmount: patch.paidAmount != null ? Number(patch.paidAmount) : Number(order.total || 0),
      changeAmount: Number(patch.changeAmount || 0),
      paymentMethod: patch.paymentMethod || order.paymentMethod || 'CASH',
      needsRepay: false,
      repayAmount: 0,
      updatedAt: Date.now()
    };
    if (order.status === 'AwaitingPayment') update.status = 'Pending';
    if (patch.status) update.status = patch.status;

    await ref.update(update);
    return res.json({ ok: true, orderId, paymentStatus: 'PAID' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});
