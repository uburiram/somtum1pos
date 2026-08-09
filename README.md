# ส้มตำนายหนึ่ง POS v4 — GitHub Pages + Firebase

## ไฟล์ที่ต้องอยู่ root ของ repo

- `index.html` — ลูกค้า
- `pos.html` — ร้านค้า
- `firebase-config.js`
- `firestore.rules` (วางใน Console)
- `.nojekyll`

## ลิงก์

- ลูกค้า: https://uburiram.github.io/somtum1pos/
- ร้าน: https://uburiram.github.io/somtum1pos/pos.html
- PIN ครั้งแรก: `1234`

## ฟีเจอร์ v4

1. จัดการหมวด / ท็อปปิ้ง / ความเผ็ด (เพิ่ม แก้ ปิด)
2. ท็อปปิ้งหลายอย่าง + จำนวนต่อรายการ + ราคาชัด
3. อัปโหลดรูปเมนูจากเครื่อง → บันทึกใน Firestore
4. พิมพ์ QR สั่งอาหารติดโต๊ะ
5. พร้อมเพย์ตามเลขร้าน (ค่าเริ่ม 1319900156353 + ชื่อบัญชี)
6. ใบเสร็จเมื่อชำระแล้ว (ลูกค้า+ร้าน) ค้นจากคิวได้
7. เงินสด: ร้านกดรับเงิน → ออกใบเสร็จ
8. ตรวจสลิปอัตโนมัติถ้าใส่ `EASYSLIP_API_KEY` (ไม่งั้นร้านตรวจมือ)

## อัป Firestore Rules

Console → Firestore → Rules → วางจากไฟล์ → Publish
