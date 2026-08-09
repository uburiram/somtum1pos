/**
 * วางค่าจาก Firebase Console → Project settings → Your apps → Web app
 * โปรเจกต์: pos1-4d72a
 *
 * วิธีเอาค่า (มือถือ):
 * 1. เปิด https://console.firebase.google.com/project/pos1-4d72a/settings/general
 * 2. เลื่อนลง "Your apps" → ถ้ายังไม่มี กด </>(Web) ตั้งชื่อ pos-web แล้ว Register
 * 3. คัดลอก object firebaseConfig มาวางแทนด้านล่าง
 */
window.FIREBASE_CONFIG = {
  apiKey: "PASTE_API_KEY",
  authDomain: "pos1-4d72a.firebaseapp.com",
  projectId: "pos1-4d72a",
  storageBucket: "pos1-4d72a.firebasestorage.app",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};

/** รหัสร้าน — ใช้แยกข้อมูลถ้าระบบมีหลายสาขา (ตอนนี้ใช้ค่าเดียว) */
window.SHOP_ID = "main";

/** PIN ร้านค้า (เก็บบนเครื่องร้าน + ตรวจในหน้า pos) */
window.DEFAULT_PIN = "1234";
