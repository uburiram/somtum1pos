'use strict';
/**
 * Smoke tests for Somtum1POS v3 — no external test framework required.
 * Expects server already running at BASE_URL (default http://127.0.0.1:3080)
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3080';

async function req(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log('CI smoke tests →', BASE);
  let passed = 0;

  // 1) Health
  {
    const { status, data } = await req('GET', '/api/health');
    assert(status === 200 && data.ok === true, `health failed: ${status}`);
    console.log('✓ GET /api/health');
    passed++;
  }

  // 2) Public shop
  {
    const { status, data } = await req('GET', '/api/public/shop');
    assert(status === 200 && data.shopName, `shop failed: ${status}`);
    console.log('✓ GET /api/public/shop');
    passed++;
  }

  // 3) Public menu
  {
    const { status, data } = await req('GET', '/api/public/menu');
    assert(status === 200 && Array.isArray(data.menus) && data.menus.length > 0, 'menu empty/fail');
    assert(Array.isArray(data.categories), 'categories missing');
    console.log('✓ GET /api/public/menu');
    passed++;
  }

  // 4) Customer pages
  {
    for (const path of ['/', '/order', '/pos']) {
      const res = await fetch(`${BASE}${path}`);
      assert(res.status === 200, `${path} status ${res.status}`);
      const html = await res.text();
      if (path === '/' || path === '/order') {
        assert(!html.includes('เข้าสู่ระบบพนักงาน') || html.includes('สั่ง'), 'customer page looks wrong');
      }
      console.log(`✓ GET ${path}`);
      passed++;
    }
  }

  // 5) Login
  let token;
  {
    const { status, data } = await req('POST', '/api/auth/login', {
      body: { username: 'admin', password: '1234' }
    });
    assert(status === 200 && data.token, `login failed: ${JSON.stringify(data)}`);
    token = data.token;
    console.log('✓ POST /api/auth/login');
    passed++;
  }

  // 6) Bad login
  {
    const { status } = await req('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'wrong' }
    });
    assert(status === 401, `expected 401 got ${status}`);
    console.log('✓ POST /api/auth/login (invalid)');
    passed++;
  }

  // 7) Create order
  let orderId;
  {
    const { status, data } = await req('POST', '/api/public/orders', {
      body: {
        items: [{ name: 'ตำไทย', qty: 1, spiceName: 'เผ็ดกลาง', toppings: [], unitPrice: 40, total: 40 }],
        paymentMethod: 'CASH'
      }
    });
    assert(status === 201 && data.order && data.order.queue, `create order fail: ${JSON.stringify(data)}`);
    orderId = data.order.id;
    console.log('✓ POST /api/public/orders →', data.order.queue);
    passed++;
  }

  // 8) Track order (public)
  {
    const { status, data } = await req('GET', `/api/public/orders/${orderId}`);
    assert(status === 200 && data.order.id === orderId, 'track order fail');
    console.log('✓ GET /api/public/orders/:id');
    passed++;
  }

  // 9) Merchant list
  {
    const { status, data } = await req('GET', '/api/orders?filter=active', { token });
    assert(status === 200 && Array.isArray(data.orders), 'orders list fail');
    assert(data.stats && typeof data.stats.active === 'number', 'stats missing');
    console.log('✓ GET /api/orders stats.active=', data.stats.active);
    passed++;
  }

  // 10) Update status
  {
    const { status, data } = await req('PATCH', `/api/orders/${orderId}/status`, {
      token,
      body: { status: 'Cooking' }
    });
    assert(status === 200 && data.order.status === 'Cooking', 'status update fail');
    console.log('✓ PATCH /api/orders/:id/status');
    passed++;
  }

  // 11) Unauthorized without token
  {
    const { status } = await req('GET', '/api/orders');
    assert(status === 401, `expected 401 got ${status}`);
    console.log('✓ GET /api/orders without token → 401');
    passed++;
  }

  console.log(`\nAll ${passed} checks passed.`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
