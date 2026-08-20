/**
 * Firebase — pos1-4d72a
 * แก้แล้ว: FUNCTIONS_BASE ต้องเป็น URL เท่านั้น (ว่าง = ไม่เรียก CF)
 * SHOP_OPS_SECRET ใช้เฉพาะเครื่องร้าน — อย่า commit ค่าจริงขึ้น public repo ถ้าไม่จำเป็น
 */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyC4aJKI-HbwWhA6AcZqOS5Wx8ShKvCWN8U",
  authDomain: "pos1-4d72a.firebaseapp.com",
  projectId: "pos1-4d72a",
  storageBucket: "pos1-4d72a.firebasestorage.app",
  messagingSenderId: "598519354918",
  appId: "1:598519354918:web:c41df74ea126644725f8e7",
  measurementId: "G-NK6YKVT17J"
};

window.SHOP_ID = "main";

/** Web Push key จาก Firebase Console → Cloud Messaging → Web Push certificates */
window.FIREBASE_VAPID_KEY = "";

/**
 * App Check (reCAPTCHA v3) — แนะนำเปิด
 * Firebase Console → App Check → ลงทะเบียนเว็บแอป → คัดลอก site key
 * ว่าง = ยังไม่เปิด (ระบบยังใช้ได้)
 */
window.FIREBASE_APPCHECK_SITE_KEY = "";

/**
 * หลัง deploy Cloud Functions ใส่ URL จริงเท่านั้น เช่น
 * https://asia-southeast1-pos1-4d72a.cloudfunctions.net
 * ว่าง หรือไม่ขึ้นต้นด้วย http = ไม่เรียก CF (ใช้ client + rules แทน)
 */
window.FUNCTIONS_BASE = "";

/**
 * ความลับร้านสำหรับ markOrderPaid (ต้องตรงกับ
 * firebase functions:config:set shop.secret="...")
 * ใส่เฉพาะบนเครื่องร้าน — อย่าแชร์สาธารณะ
 * ว่าง = ร้านยืนยันชำระผ่าน client update (rules อนุญาต canMarkPaid)
 */
window.SHOP_OPS_SECRET = "";

/** เลิกใช้ EasySlip ฝั่ง client — ใส่ key ใน Functions config แทน */
window.EASYSLIP_API_KEY = "";

window.KSHOP_QR_PAYLOAD = "0002010102110216478772000526340904155303920005264131531343007640052044640122296664800130810016A00000067701011201150107536000315010214KB0000021987930320EMPKB00000219879300131900016A00000067701011301030040214KB0000021987930420EMPKB0000021987930010517KB00000219879300151430014A000000004101001064169710211123456789015204581253037645802TH5917SOM TUM NAI NEUNG6004CITY622505095155710130708422966646304AE9C";
window.KSHOP_REF = "EMPKB000002198793001";
window.KSHOP_ACCOUNT = "นาย นรากร วงค์แก่นท้าว";
window.PAYMENT_VERIFY_URL = window.PAYMENT_VERIFY_URL || "";
