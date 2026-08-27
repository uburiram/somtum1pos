/**
 * Somtum1POS — POS boot
 */
/* global M, toast */
(function () {
  'use strict';
  try {
    const pin = document.getElementById('pinIn');
    if (pin) pin.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') M.login();
    });
  } catch (e) {}
  M.boot().catch(function (e) {
    console.error(e);
    try { toast('เริ่มไม่สำเร็จ: ' + (e.message || e)); } catch (e2) {}
  });
})();
