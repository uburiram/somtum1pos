# แพตช์ 3 จุด (11 ส.ค. 2026)

## ไฟล์ที่แก้ (อัปโหลดทับ root)
- pos.html
- index.html
- manifest.webmanifest
- sw.js (v18)

## สิ่งที่แก้
1. เปิดแอป (PWA) → ไปหน้า POS ร้านค้า (`/somtum1pos/pos.html`)
   - start_url ใน manifest ชี้ pos.html แบบ absolute
   - หน้าลูกค้าถอด manifest ออก ไม่ให้ติดตั้งแอปจากหน้าลูกค้า

2. ลบประวัติ → หลังใส่ PIN ถูกต้อง ลบออกจากรายการทันที
   - อัปเดต this.orders + loadHistory() + renderOrders() ทันที

3. กดแก้ไขเมนู/หมวด/ท็อปปิ้ง/ความเผ็ด → เลื่อนไปฟอร์มทันที
   - เพิ่ม method scrollToForm ที่เคยหายไป
   - เลื่อนหลายรอบ + ไฮไลต์ช่อง + รองรับรายการเยอะ

## หลังอัป
ลบแอปเก่าบนมือถือแล้วติดตั้งใหม่จากหน้า pos.html
(หรือล้าง cache / รอ SW v18)
