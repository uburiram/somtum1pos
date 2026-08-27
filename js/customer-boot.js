/**
 * Somtum1POS — Customer boot
 */
/* global C */
(function () {
  'use strict';
  try { C.init(); } catch (e) { console.error('C.init', e); }
  try {
    if (C.isLineBrowser && C.isLineBrowser()) {
      const h = document.getElementById('ppQRHint');
      if (h) h.style.display = 'block';
    }
  } catch (e) {}
})();
