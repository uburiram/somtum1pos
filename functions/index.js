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
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('slipData ต้องเป็น data URL รูปภาพ');
  return Buffer.from(m[2], 'base64');
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
  const paid = Number((json.data && json.data.amount) || json.amount || 0);
  if (paid && amount && Math.abs(paid - Number(amount)) > 1) {
    return { ok: false, reason: 'ยอดในสลิปไม่ตรง ฿' + paid, raw: json };
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

    const buf = dataUrlToBuffer(slipData);
    const result = await verifyWithEasySlip(buf, order.total);

    if (result.ok) {
      await ref.update({
        slipData: slipData.slice(0, 900000), // กันเอกสารใหญ่เกิน
        slipStatus: 'APPROVED',
        paymentStatus: 'PAID',
        paidAmount: Number(order.total) || 0,
        paidAt: Date.now(),
        paymentMethod: order.paymentMethod || 'PROMPTPAY',
        status: order.status === 'AwaitingPayment' ? 'Pending' : (order.status || 'Pending'),
        slipAuto: true
      });
      return res.json({ ok: true, msg: result.reason, autoPaid: true });
    }

    // ไม่ผ่าน → รอร้านตรวจมือ
    await ref.update({
      slipData: slipData.slice(0, 900000),
      slipStatus: 'PENDING_REVIEW',
      slipAutoReason: result.reason || 'รอตรวจมือ'
    });
    return res.json({ ok: false, pendingManual: true, msg: result.reason || 'รอร้านตรวจสอบสลิป' });
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
