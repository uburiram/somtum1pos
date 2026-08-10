# แก้ไขบั๊ก this.enter is not a function (10 ส.ค. 2026)

## ปัญหา
- หน้า POS ขึ้น Error: "เริ่มระบบไม่สำเร็จ: this.enter is not a function"
- ใส่ PIN 1234 หรือ PIN อื่นก็เข้าไม่ได้

## สาเหตุ
ใน pos.html มีการเรียก this.enter() ทั้งใน boot() และ login()
แต่ method enter() ถูกลบออกไปโดยไม่ได้ตั้งใจ (หายไปตอนอัปเดตโค้ด)

## การแก้ไข
1. เพิ่ม method enter() กลับเข้า object M ใน pos.html
   - ซ่อน loginView
   - แสดง appView
   - เริ่ม listenOrders()
   - โหลด loadSettingsUI()
   - อัปเดตชื่อร้าน realtime จาก Firestore

2. เปลี่ยน Service Worker cache เป็น somtum-pwa-v16
   เพื่อบังคับให้มือถือโหลดไฟล์ใหม่ (ไม่ใช้ cache เก่า)

## วิธีอัปโหลด (Android)
1. แตก zip นี้
2. อัปโหลดไฟล์ทั้งหมดทับที่ root ของ repo GitHub (โดยเฉพาะ pos.html + sw.js)
3. รอ GitHub Pages อัปเดต 1–3 นาที
4. บนมือถือ: ปิดแท็บ Chrome ทั้งหมดของเว็บนี้ → เปิดใหม่
   หรือ Chrome → ตั้งค่าเว็บไซต์ → ลบข้อมูล / ล้าง cache
5. ใส่ PIN 1234 (หรือ PIN ที่เคยเปลี่ยนไว้)

## ไฟล์ที่แก้
- pos.html  (เพิ่ม enter)
- sw.js     (v16)
