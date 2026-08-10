# คู่มือ Deploy รอบ Auth + FCM + ตรวจสลิป

## 1) อัปไฟล์ขึ้น GitHub (root)

- index.html
- pos.html
- firestore.rules → **ต้อง Publish ใน Firebase Console**
- firebase-config.js
- firebase-messaging-sw.js (ใหม่)
- sw.js
- manifest.webmanifest
- functions/ (สำหรับเครื่องที่ deploy functions)

## 2) Firebase Console

### Authentication
1. Authentication → Sign-in method → เปิด **Email/Password**
2. เปิด pos.html → กด **สมัครบัญชีร้านครั้งแรก** (อีเมล+รหัสผ่าน ≥ 6 ตัว)

### Cloud Messaging (FCM)
1. Project Settings → Cloud Messaging → **Web Push certificates** → Generate key pair
2. วางค่าใน `firebase-config.js` → `window.FIREBASE_VAPID_KEY = "..."`  
3. หลัง login ร้าน ระบบจะขออนุญาตแจ้งเตือนและบันทึก token

### Firestore Rules
1. Firestore → Rules → วางเนื้อหาจาก `firestore.rules` → Publish

## 3) Cloud Functions (ต้องอัปเกรด Blaze)

```bash
npm i -g firebase-tools
firebase login
firebase use pos1-4d72a
# คัดลอกโฟลเดอร์ functions/
cd functions && npm install && cd ..
firebase functions:config:set easyslip.key="YOUR_EASYSLIP_API_KEY"
firebase deploy --only functions
```

หลัง deploy จะได้ URL ประมาณ:
`https://asia-southeast1-pos1-4d72a.cloudfunctions.net`

ใส่ใน firebase-config.js:
```js
window.FUNCTIONS_BASE = "https://asia-southeast1-pos1-4d72a.cloudfunctions.net";
```

Functions ที่มี:
- `verifySlip` — ตรวจสลิปฝั่งเซิร์ฟเวอร์ (ไม่มี CORS)
- `onOrderCreate` — ส่ง FCM เมื่อมีออเดอร์ใหม่

## 4) ทดสอบ

1. ร้าน login → อนุญาตแจ้งเตือน
2. ลูกค้าสั่งเงินสด/QR
3. ร้านได้เสียง + notification (ถ้า FCM ตั้งครบ)
4. ลูกค้าอัปโหลดสลิป → ถ้ามี Functions + EasySlip key จะ auto ผ่านได้

## หมายเหตุ

- ก่อน Publish rules ใหม่: ร้านต้อง login ก่อนถึงจะแก้เมนู/ยืนยันเงินได้
- ลูกค้าสั่งอาหารได้โดยไม่ login
- คิวใช้เอกสาร `settings/queue` (ไม่พึ่ง secure)
