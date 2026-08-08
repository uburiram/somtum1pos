'use strict';

/**
 * Automatic slip verification layer.
 * Providers:
 *  - manual: staff confirms only
 *  - easyslip: https://developer.easyslip.com (set SLIP_API_KEY)
 *  - slipok: https://slipok.com (set SLIP_API_KEY + optional branchId)
 *
 * Never deletes or overwrites paid orders; only updates slip fields additively.
 */

const fs = require('fs');
const path = require('path');
const { getSetting, setSetting } = require('./db');

async function verifyWithEasySlip({ imagePath, amount, promptpay }) {
  const apiKey = getSetting('slipApiKey', process.env.SLIP_API_KEY || '');
  if (!apiKey) {
    return { ok: false, provider: 'easyslip', reason: 'ไม่มี API Key' };
  }

  const form = new FormData();
  const buf = fs.readFileSync(imagePath);
  form.append('file', new Blob([buf]), path.basename(imagePath));
  // EasySlip expects amount as number string
  if (amount != null) form.append('amount', String(Number(amount).toFixed(2)));

  const res = await fetch('https://developer.easyslip.com/api/v1/verify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, provider: 'easyslip', reason: data.message || 'API error', raw: data };
  }

  // Typical success shape varies by plan — normalize
  const paid = data?.data?.amount ?? data?.amount;
  const receiver = data?.data?.receiver?.account?.name || data?.receiver || '';
  const transRef = data?.data?.transRef || data?.transRef || '';

  const amountMatch =
    paid == null || Math.abs(Number(paid) - Number(amount)) < 0.01;

  return {
    ok: amountMatch && (data?.status === true || data?.success === true || !!transRef),
    provider: 'easyslip',
    amount: paid != null ? Number(paid) : null,
    receiver,
    transRef,
    amountMatch,
    raw: data,
    reason: amountMatch ? null : `ยอดไม่ตรง (สลิป ${paid} / ออเดอร์ ${amount})`
  };
}

async function verifyWithSlipOK({ imagePath, amount }) {
  const apiKey = getSetting('slipApiKey', process.env.SLIP_API_KEY || '');
  if (!apiKey) {
    return { ok: false, provider: 'slipok', reason: 'ไม่มี API Key' };
  }

  const form = new FormData();
  const buf = fs.readFileSync(imagePath);
  form.append('files', new Blob([buf]), path.basename(imagePath));
  form.append('amount', String(Number(amount)));

  // SlipOK endpoint pattern (adjust branch if needed via env)
  const branchId = process.env.SLIPOK_BRANCH_ID || '';
  const url = branchId
    ? `https://api.slipok.com/api/line/apikey/${apiKey}/${branchId}`
    : `https://api.slipok.com/api/line/apikey/${apiKey}`;

  const res = await fetch(url, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.code) {
    return {
      ok: false,
      provider: 'slipok',
      reason: data?.message || 'API error',
      raw: data
    };
  }

  return {
    ok: true,
    provider: 'slipok',
    amount: data?.data?.amount != null ? Number(data.data.amount) : Number(amount),
    receiver: data?.data?.receiver?.displayName || '',
    transRef: data?.data?.transRef || data?.data?.trans_ref || '',
    amountMatch: true,
    raw: data
  };
}

/**
 * Main entry: verify slip file against order amount.
 * Returns normalized result; never throws for business failures.
 */
async function verifySlip({ imagePath, amount, promptpay }) {
  const enabled = getSetting('slipApiEnabled', '0') === '1';
  const provider = getSetting('slipApiProvider', 'manual');

  if (!enabled || provider === 'manual') {
    return {
      ok: false,
      pendingManual: true,
      provider: 'manual',
      reason: 'รอพนักงานตรวจสอบสลิป'
    };
  }

  try {
    if (provider === 'easyslip') {
      return await verifyWithEasySlip({ imagePath, amount, promptpay });
    }
    if (provider === 'slipok') {
      return await verifyWithSlipOK({ imagePath, amount });
    }
    return { ok: false, pendingManual: true, provider, reason: 'provider ไม่รองรับ' };
  } catch (err) {
    return {
      ok: false,
      pendingManual: true,
      provider,
      reason: 'เชื่อมต่อ API ไม่สำเร็จ: ' + (err.message || String(err))
    };
  }
}

module.exports = { verifySlip };
