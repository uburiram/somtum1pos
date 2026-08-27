/**
 * Somtum1POS — Customer shared (db + seed)
 * โหลดหลัง common.js
 */
/* global toast */
let db, shopRef;

function checkConfig() {
  const c = window.FIREBASE_CONFIG || {};
  if (!c.apiKey || String(c.apiKey).includes('PASTE')) {
    const b = document.getElementById('cfgBanner');
    if (b) b.classList.add('on');
    return false;
  }
  return true;
}

async function migrateAndSeed() {
  try {
    const pub = await shopRef.collection('settings').doc('public').get();
    if (pub.exists) {
      const an = String((pub.data() || {}).accountName || '');
      if (an.includes('นราทร')) {
        await shopRef.collection('settings').doc('public').set(
          { accountName: an.replace(/นราทร/g, 'นรากร') }, { merge: true }
        );
      }
    }
  } catch (e) { console.warn('fix accountName', e); }
  try {
    const q = await shopRef.collection('settings').doc('queue').get();
    if (!q.exists) {
      await shopRef.collection('settings').doc('queue').set(
        { queueCounter: 1, queueDate: '' }, { merge: true }
      );
    }
  } catch (e) { console.warn('queue seed', e); }
}
