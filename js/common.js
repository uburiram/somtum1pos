/**
 * Somtum1POS — Common utilities (แยกจาก customer.js / pos.js)
 * โหลดก่อน customer.js และ pos.js
 * เวอร์ชัน: 2026-08-24 (ข้อ 10 — modules เริ่มต้น)
 */
(function (global) {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const money = (n) => '฿' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

  const toast = (msg) => {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._x);
    t._x = setTimeout(() => { t.style.display = 'none'; }, 2800);
  };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const showErr = (msg) => {
    const e = document.getElementById('errBanner');
    if (!e) return;
    e.textContent = msg;
    e.classList.add('on');
  };

  async function sha256(text) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  /**
   * คำนวณยอดที่ครอบคลุมแล้ว + ส่วนต่าง (ซ่อมข้อมูลเก่าที่ paidAmount รวมทอน)
   */
  function calcPaymentCover(order) {
    const o = order || {};
    const billTotal = Math.max(0, Number(o.total || 0));
    const rawPaid = Math.max(0, Number(o.paidAmount || 0));
    const items = Array.isArray(o.items) ? o.items : [];
    const rounds = items.map((i) => Math.max(0, Math.floor(Number(i.addRound || 0))));
    const maxRound = rounds.length ? Math.max.apply(null, rounds) : 0;
    let covered = rawPaid;
    if (String(o.paymentStatus || '') === 'PAID' && !o.needsRepay) {
      covered = billTotal;
    } else if (o.needsRepay || (String(o.paymentStatus || '') !== 'PAID' && rawPaid > 0)) {
      if (maxRound > 0) {
        const prevSum = items
          .filter((i) => Math.max(0, Math.floor(Number(i.addRound || 0))) < maxRound)
          .reduce((s, i) => s + Number(i.total || 0), 0);
        if (prevSum > 0) {
          const itemsSum = items.reduce((s, i) => s + Number(i.total || 0), 0);
          const disc = Math.max(0, Number(o.discountAmount || 0));
          if (itemsSum > 0 && disc > 0 && billTotal <= itemsSum) {
            covered = Math.max(0, Math.round((prevSum - disc * (prevSum / itemsSum)) * 100) / 100);
          } else {
            covered = prevSum;
          }
        } else {
          covered = Math.min(rawPaid, billTotal);
        }
      } else {
        covered = Math.min(rawPaid, billTotal);
      }
    }
    covered = Math.max(0, Math.min(covered, billTotal));
    const due = Math.max(0, Math.round((billTotal - covered) * 100) / 100);
    return { covered, due, billTotal, rawPaid, maxRound };
  }

  /**
   * แปลงไฟล์รูปเป็น dataURL (compress) — ใช้ทั้งเมนูและสลิป
   * ปรับปรุง: จำกัดขนาดเข้มขึ้นเพื่อลดภาระ Firestore
   */
  function fileToDataUrl(file, maxSide = 480, quality = 0.55) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve('');
      if (file.size > 5 * 1024 * 1024) return reject(new Error('ไฟล์ใหญ่เกิน 5MB'));
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          let w = img.width, h = img.height;
          const s = Math.min(1, maxSide / Math.max(w, h));
          w = Math.max(1, Math.round(w * s));
          h = Math.max(1, Math.round(h * s));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          let q = quality;
          let data = c.toDataURL('image/jpeg', q);
          const maxChars = 120000; // ~90KB binary
          let side = maxSide;
          while (data.length > maxChars && (q > 0.32 || side > 240)) {
            if (q > 0.32) q = Math.max(0.32, q - 0.08);
            else {
              side = Math.max(240, Math.round(side * 0.75));
              const s2 = Math.min(1, side / Math.max(img.width, img.height));
              const w2 = Math.max(1, Math.round(img.width * s2));
              const h2 = Math.max(1, Math.round(img.height * s2));
              c.width = w2;
              c.height = h2;
              c.getContext('2d').drawImage(img, 0, 0, w2, h2);
            }
            data = c.toDataURL('image/jpeg', q);
          }
          resolve(data);
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('อ่านรูปไม่สำเร็จ'));
      };
      img.src = url;
    });
  }

  /**
   * PromptPay / Thai QR helpers
   */
  const PP = {
    crc(p) {
      let c = 0xFFFF;
      for (let i = 0; i < p.length; i++) {
        c ^= p.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
      }
      return c.toString(16).toUpperCase().padStart(4, '0');
    },
    tlv(id, v) {
      const s = String(v);
      return id + String(s.length).padStart(2, '0') + s;
    },
    gen(target, amount) {
      let t = String(target || '').replace(/\D/g, '');
      let idTag = '01';
      if (t.length === 10 && t[0] === '0') { t = '0066' + t.slice(1); idTag = '01'; }
      else if (t.length === 13) { idTag = '02'; }
      else if (t.length === 15 && t.startsWith('0066')) { idTag = '01'; }
      else return null;
      const mai = this.tlv('00', 'A000000677010111') + this.tlv(idTag, t);
      let p = this.tlv('00', '01') + this.tlv('01', Number(amount) > 0 ? '12' : '11') + this.tlv('29', mai) + this.tlv('53', '764');
      if (Number(amount) > 0) {
        const a = (Math.round(Number(amount) * 100) / 100).toFixed(2);
        p += this.tlv('54', a);
      }
      p += this.tlv('58', 'TH') + '6304';
      return p + this.crc(p);
    },
    genMerchant(merchantId, amount) {
      let id = String(merchantId || '').trim();
      if (!id) return null;
      const digits = id.replace(/\D/g, '');
      let mai;
      if (digits.length >= 10 && digits.length <= 15 && digits === id.replace(/\s/g, '')) {
        const biller = digits.padStart(15, '0');
        mai = this.tlv('00', 'A000000677010112') + this.tlv('01', biller);
      } else {
        const mid = id.slice(0, 25);
        mai = this.tlv('00', 'A000000677010111') + this.tlv('03', mid);
      }
      const tag = (digits.length >= 10 && digits.length <= 15 && digits === id.replace(/\s/g, '')) ? '30' : '29';
      let p = this.tlv('00', '01') + this.tlv('01', Number(amount) > 0 ? '12' : '11') + this.tlv(tag, mai) + this.tlv('53', '764');
      if (Number(amount) > 0) {
        const a = (Math.round(Number(amount) * 100) / 100).toFixed(2);
        p += this.tlv('54', a);
      }
      p += this.tlv('58', 'TH') + '6304';
      return p + this.crc(p);
    },
    parseTlv(s) {
      const out = [];
      let i = 0;
      while (i + 4 <= s.length) {
        const tag = s.substr(i, 2);
        const ln = parseInt(s.substr(i + 2, 2), 10);
        i += 4;
        if (isNaN(ln) || i + ln > s.length) break;
        const val = s.substr(i, ln);
        i += ln;
        out.push([tag, val]);
        if (tag === '63') break;
      }
      return out;
    },
    applyAmount(staticPayload, amount) {
      if (!staticPayload) return null;
      let parts = this.parseTlv(String(staticPayload).trim());
      if (!parts.length) return null;
      parts = parts.filter(([t]) => t !== '63');
      const amt = Number(amount);
      const hasAmt = amt > 0;
      let has54 = false;
      const next = [];
      for (const [t, v] of parts) {
        if (t === '01') next.push(['01', hasAmt ? '12' : '11']);
        else if (t === '54') { has54 = true; if (hasAmt) next.push(['54', (Math.round(amt * 100) / 100).toFixed(2)]); }
        else next.push([t, v]);
      }
      let final = next;
      if (hasAmt && !has54) {
        final = [];
        for (const [t, v] of next) {
          if (t === '58') final.push(['54', (Math.round(amt * 100) / 100).toFixed(2)]);
          final.push([t, v]);
        }
      }
      let body = '';
      for (const [t, v] of final) body += this.tlv(t, v);
      body += '6304';
      return body + this.crc(body);
    },
    genKShop(amount, payload) {
      const p = payload || global.KSHOP_QR_PAYLOAD || '';
      if (p) return this.applyAmount(p, amount);
      return null;
    }
  };

  /**
   * Client-side rate limit สำหรับสร้างออเดอร์ (ข้อ 9)
   * ป้องกันกดซ้ำ / สแปมจากเครื่องเดียวกัน
   * @param {string} key - เช่น 'order' หรือ 'table-5'
   * @param {number} cooldownMs - ระยะเวลารอ (default 8 วินาที)
   * @returns {{ok:boolean, waitSec?:number}}
   */
  function checkOrderRateLimit(key = 'order', cooldownMs = 8000) {
    try {
      const storageKey = 'somtum_rl_' + (key || 'order');
      const last = Number(localStorage.getItem(storageKey) || 0);
      const now = Date.now();
      if (last && now - last < cooldownMs) {
        const waitSec = Math.ceil((cooldownMs - (now - last)) / 1000);
        return { ok: false, waitSec };
      }
      localStorage.setItem(storageKey, String(now));
      return { ok: true };
    } catch (e) {
      return { ok: true }; // ถ้า localStorage ใช้ไม่ได้ อนุญาต
    }
  }

  /**
   * เตรียมรองรับ Firebase Storage ในอนาคต (ข้อ 8)
   * ตอนนี้ยังใช้ dataURL (base64) เหมือนเดิม เพื่อไม่พังระบบ
   * เมื่อเปิด Storage ใน Console แล้ว สามารถเรียก uploadImageToStorage ได้
   */
  async function uploadImageToStorage(fileOrDataUrl, path) {
    // ยังไม่ active — รอ enable Storage + rules
    // ตัวอย่างอนาคต:
    // const storage = firebase.storage();
    // const ref = storage.ref(path);
    // if (typeof fileOrDataUrl === 'string' && fileOrDataUrl.startsWith('data:')) {
    //   await ref.putString(fileOrDataUrl, 'data_url');
    // } else {
    //   await ref.put(fileOrDataUrl);
    // }
    // return await ref.getDownloadURL();
    console.warn('uploadImageToStorage: ยังไม่เปิดใช้ Firebase Storage — ใช้ dataURL แทน');
    return null;
  }

  // Export ไป global เพื่อให้ customer.js / pos.js ใช้ได้โดยไม่ต้องแก้มาก
  global.esc = esc;
  global.money = money;
  global.toast = toast;
  global.uid = uid;
  global.showErr = showErr;
  global.sha256 = sha256;
  global.calcPaymentCover = calcPaymentCover;
  global.fileToDataUrl = fileToDataUrl;
  global.PP = PP;
  global.checkOrderRateLimit = checkOrderRateLimit;
  global.uploadImageToStorage = uploadImageToStorage;

})(typeof window !== 'undefined' ? window : globalThis);
