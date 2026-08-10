# Somtum1POS — รายการแก้บั๊ก (v5.1-fix)

## ไฟล์ที่ต้องอัปโหลดทับที่ root ของ GitHub repo

| พาธใน repo | ไฟล์ |
|---|---|
| `/index.html` | หน้าลูกค้า (แก้ฟังก์ชันขาด + flow ชำระเงิน) |
| `/pos.html` | หน้าร้าน (query ออเดอร์ + เสียงแจ้งเตือน) |
| `/firestore.rules` | Security rules (สำคัญมาก) |
| `/manifest.webmanifest` | start_url ชี้หน้าลูกค้า |
| `/sw.js` | cache version v10 บังคับรีเฟรช PWA |
| `/firebase-config.js` | ไม่แก้ (ใช้ของเดิม) |

## ขั้นตอนหลังอัปโหลด GitHub

1. อัปโหลดไฟล์ด้านบนทับของเดิมบน GitHub
2. **Deploy Firestore Rules** ใน Firebase Console → Firestore → Rules → วางเนื้อหาจาก `firestore.rules` → Publish
3. บนมือถือ Android: เปิด Chrome → ล้าง cache ของไซต์ หรือปิดแอป PWA แล้วเปิดใหม่ (sw v10 จะเคลียร์ cache เก่า)
4. ทดสอบ:
   - หน้าลูกค้า: เลือกเมนู → สั่ง → ต้องได้คิว + QR โดยไม่ error ใน console
   - หน้าร้าน (`/pos.html`): login PIN → เห็นออเดอร์ → กดยืนยันรับโอน → หน้าลูกค้าอัปเดตเป็นชำระแล้ว

## สิ่งที่แก้แล้ว

1. **ฟังก์ชันที่ขาด** ใน `index.html`: `autoSubmitQROrder`, `startPayWatch`, `renderCart`, `attachTicketQR`
2. **Flow QR**: สร้างออเดอร์อัตโนมัติสถานะ `AwaitingPayment` เมื่อเลือกพร้อมเพย์
3. **สลับเงินสดหลังสร้าง QR order**: อัปเดตออเดอร์เดิม ไม่สร้างซ้ำ
4. **Firestore Rules**: ห้าม create order ที่เป็น PAID, ล็อก id/queue/createdAt ตอน update
5. **POS listen**: `orderBy(createdAt desc) limit 300` + fallback, แจ้งเตือนเมื่อชำระแล้ว
6. **สถิติรอทำ**: นับทั้ง `Pending` และ `AwaitingPayment`
7. **manifest**: `start_url` = `./index.html` (ลูกค้า)
8. **Service Worker**: `somtum-pwa-v10`
9. **CSS**: เพิ่ม `.bd` สำหรับสถานะยกเลิก
10. **Best sellers**: นับเฉพาะที่ชำระแล้ว/เสร็จ, limit 300

## ข้อจำกัดที่ยังมี (เพราะไม่มี Firebase Auth)

- ใครเปิด `/pos.html` แล้วยังต้องเดา PIN — แต่ PIN อยู่ฝั่ง client
- Rules ยังอนุญาต write เมนู/ออเดอร์ได้ (จำเป็นสำหรับ POS แบบไม่มี Auth)
- แนะนำขั้นถัดไป: เปิด **Firebase App Check** + เปลี่ยน PIN จาก 1234

## ทดสอบ syntax

- `index.html` JS: node --check ผ่าน
- `pos.html` JS: node --check ผ่าน
- PromptPay / K-Shop QR payload generation: ผ่าน
