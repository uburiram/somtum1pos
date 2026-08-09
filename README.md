# ส้มตำนายหนึ่ง POS — GitHub Pages + Firebase (รุ่นแก้ไขครบ)

## ไฟล์ที่ต้องอยู่ที่ root ของ repo

```
index.html           ← หน้าลูกค้า (QR)
pos.html             ← หน้าร้านค้า
firebase-config.js   ← ค่า Firebase
firestore.rules      ← วางใน Firebase Console
.nojekyll
README.md
```

## ลิงก์ใช้งาน

| ใคร | URL |
|-----|-----|
| ลูกค้า | https://uburiram.github.io/somtum1pos/ |
| ร้านค้า | https://uburiram.github.io/somtum1pos/pos.html |
| PIN ครั้งแรก | `1234` (เปลี่ยนทันทีหลังเข้า) |

## สิ่งที่แก้ในรุ่นนี้

### วิกฤต
- แยก settings เป็น `public` (ชื่อร้าน/PromptPay) กับ `secure` (pinHash + คิว)
- ลบ PIN ข้อความธรรมดาออกจากเอกสารเก่าอัตโนมัติ
- ตัดช่องโหว่ DEFAULT_PIN ถาวร — ตรวจเฉพาะ pinHash
- rules ห้าม delete ออเดอร์จาก client

### สูง
- แก้เสียงแจ้งเตือนไม่บี๊บตอนเปิด POS ครั้งแรก
- CRUD เมนู (เพิ่ม/แก้/ปิดขาย/หมด)
- อัปโหลดสลิป (ย่อรูป) + ร้านกดผ่าน/ไม่ผ่าน
- ลูกค้าเช็กคิวได้จากช่องด้านบน / `?queue=A001`

### กลาง
- รายงานวันนี้ / 7 วัน / 30 วัน แยกเงินสด-พร้อมเพย์ + เมนูขายดี
- รองรับรูปเมนูผ่าน URL
- offline persistence ของ Firestore
- คิวรันบน `settings/secure` ด้วย transaction

### ต่ำ
- แพ็กเฉพาะไฟล์ Pages (ไม่ปน server Node)
- README ชัดเจน

## วิธีอัปจากมือถือ

1. ดาวน์โหลดไฟล์จาก zip ชุดนี้
2. GitHub → repo `uburiram/somtum1pos`
3. อัป **ทับ** ที่ root:
   - index.html
   - pos.html
   - firebase-config.js
   - .nojekyll
4. Commit
5. เปิด https://console.firebase.google.com/project/pos1-4d72a/firestore/rules
6. วางเนื้อหาจาก `firestore.rules` → Publish
7. รอ 1–2 นาที แล้วรีเฟรชหน้าเว็บ

## ข้อมูลเดิม

- เมนู / หมวด / ออเดอร์เก่าใน Firestore **ไม่ถูกลบ**
- ระบบย้าย `settings/config` → `public` + `secure` อัตโนมัติ
- PIN เดิมถ้าเป็น `1234` จะยังใช้ได้หลัง migrate (ผ่าน hash)

## ข้อจำกัดที่ยังเหลือ (เทคโนโลยี)

บน GitHub Pages **ไม่มี Firebase Auth**  
rules จึงยังเปิด write ได้ในระดับร้านเล็ก — อย่าแชร์ลิงก์ POS สาธารณะเกินจำเป็น  
เมื่อพร้อม ควรเพิ่ม Firebase Authentication ภายหลัง
