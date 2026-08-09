# POS Firebase — มือถือ + GitHub Pages + Firestore realtime

โปรเจกต์ Firebase: **pos1-4d72a**

## ไฟล์

| ไฟล์ | หน้าที่ |
|------|---------|
| `index.html` | หน้าลูกค้า (QR) |
| `pos.html` | หน้าร้านค้า |
| `firebase-config.js` | **ใส่ค่า config ที่นี่** |
| `firestore.rules` | กฎความปลอดภัย (วางใน Console) |

## ตั้งค่า Firebase บนมือถือ (ทีละข้อ)

### 1) เปิด Firestore
1. เปิด https://console.firebase.google.com/project/pos1-4d72a/firestore
2. กด **Create database**
3. เลือก **Start in test mode** (ชั่วคราว) หรือวาง rules จากไฟล์ `firestore.rules`
4. Location เลือกใกล้ไทย เช่น `asia-southeast1`
5. Enable

### 2) สร้าง Web App เพื่อเอา Config
1. เปิด https://console.firebase.google.com/project/pos1-4d72a/settings/general
2. เลื่อนลง **Your apps**
3. กดไอคอน **</>** (Web)
4. App nickname: `pos-web` → Register
5. คัดลอกค่าใน `firebaseConfig = { ... }`

### 3) แก้ไฟล์ `firebase-config.js`
วางค่าที่คัดลอก:

```js
window.FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "pos1-4d72a.firebaseapp.com",
  projectId: "pos1-4d72a",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

### 4) อัปขึ้น GitHub (root ของ repo)
อัปไฟล์เหล่านี้ไปที่ root:
- index.html
- pos.html
- firebase-config.js
- .nojekyll (ว่างก็ได้)

### 5) เปิด GitHub Pages
Settings → Pages → Deploy from branch → main → / (root) → Save

### 6) ใช้งาน
- ลูกค้า: `https://uburiram.github.io/somtum1pos/`
- ร้าน: `https://uburiram.github.io/somtum1pos/pos.html`
- PIN: `1234`

ลูกค้าสั่งบนมือถือใดก็ได้ → ร้านเห็นทันทีผ่าน Firestore realtime

## โครงสร้างข้อมูล Firestore

```
shops/main/
  settings/config
  categories/{id}
  menus/{id}
  spiceLevels/{id}
  toppings/{id}
  orders/{id}
```

ครั้งแรกที่เปิดหน้าลูกค้า ระบบจะ seed เมนูให้อัตโนมัติถ้ายังว่าง (ไม่ทับของเดิม)
