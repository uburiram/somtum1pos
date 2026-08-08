# ส้มตำนายหนึ่ง POS v3

ระบบ POS + QR Order แยกหน้าลูกค้า / ร้านค้า  
**Backend จริง:** Node.js (built-in `node:http` + `node:sqlite`) — **ไม่บังคับ npm install**

## ตรงตามที่ขอ

| ความต้องการ | ผลลัพธ์ |
|-------------|---------|
| ลูกค้าสแกน QR เห็นเฉพาะหน้าสั่งอาหาร | URL `/` — **ไม่มี** เมนูร้านค้า/จัดการ |
| ร้านค้าเห็นระบบเต็ม | URL `/pos` ต้อง Login |
| Backend + Database | SQLite ไฟล์ (`node:sqlite`) |
| API เดียวกัน | REST + SSE realtime |
| แจ้งเตือนตัวเลข + เสียง | Badge จำนวนออเดอร์ค้าง + เสียง/สั่น |
| ตรวจสลิปอัตโนมัติ | อัปโหลดสลิป + EasySlip / SlipOK / ยืนยันด้วยพนักงาน |
| ไม่กระทบข้อมูลเดิม | Migration แบบ additive, soft-delete เมนู, ไม่ทับออเดอร์เก่าตอน import |

## รันระบบ

ต้องการ **Node.js 22+** (มี `node:sqlite` ในตัว)

```bash
cd somtum1pos-v3

# (แนะนำ) กำหนดที่เก็บฐานข้อมูล
export SOM_TUM_DATA="$(pwd)/data"
mkdir -p "$SOM_TUM_DATA"

node server/index.js
```

เปิดเบราว์เซอร์:

- **ลูกค้า (ติด QR นี้):** http://localhost:3080/
- **ร้านค้า:** http://localhost:3080/pos  
- **Login:** `admin` / `1234`

## Flow การใช้งาน

### ลูกค้า
1. สแกน QR ที่โต๊ะ → เปิดหน้าสั่งอาหารเท่านั้น  
2. เลือกเมนู / เผ็ด / ท็อปปิ้ง → ตะกร้า  
3. ชำระเงินสด หรือ พร้อมเพย์ (QR มาตรฐาน EMV จริง)  
4. ได้เลขคิว — ถ้าโอนแล้วอัปโหลดสลิปได้ทันที  

### ร้านค้า
1. เข้า `/pos` → Login  
2. เห็น **ตัวเลข badge** ออเดอร์ค้าง + สถิติ (รอทำ / กำลังทำ / รอรับ / ยังไม่ชำระ / รอสลิป)  
3. กดเปิดเสียงแจ้งเตือน  
4. เปลี่ยนสถานะ / รับเงิน / ยืนยันสลิป  
5. รายงานยอดขายวันนี้  

## ตรวจสอบสลิป

ตั้งค่าที่หน้า POS → ตั้งค่า:

- **manual** (ค่าเริ่มต้น): พนักงานดูรูปแล้วกดยืนยัน  
- **easyslip** / **slipok**: ใส่ API Key แล้วระบบตรวจยอดอัตโนมัติ  

## โครงสร้างไฟล์

```
somtum1pos-v3/
  server/
    index.js      # HTTP API + SSE
    db.js         # SQLite schema + seed (additive)
    auth logic    # JWT HS256 ใน index.js
    password.js   # scrypt
    slip.js       # ตรวจสลิป
  public/
    customer.html # ลูกค้าเท่านั้น
    merchant.html # ร้านค้า
    uploads/      # รูปสลิป
  data/           # somtum.db (เมื่อตั้ง SOM_TUM_DATA)
```

## Environment

```
PORT=3080
JWT_SECRET=ใส่ค่าลับของคุณ
SOM_TUM_DATA=/path/to/data
SLIP_API_KEY=
SLIPOK_BRANCH_ID=
```

## หมายเหตุสำคัญ

1. **QR ที่พิมพ์ติดโต๊ะต้องชี้ไปที่ `/` เท่านั้น** อย่าชี้ไป `/pos`  
2. ข้อมูลเมนู/ออเดอร์อยู่ใน SQLite — backup โดยคัดลอกไฟล์ `.db`  
3. การ “ลบ” เมนูเป็นการปิดใช้งาน (`is_active=0`) ไม่ลบประวัติออเดอร์  
4. ถ้าต้องการ PostgreSQL / Supabase ภายหลัง สามารถย้าย schema ได้โดย API ยังเหมือนเดิม  


## GitHub Actions (CI/CD)

| Workflow | ไฟล์ | ทำงานเมื่อ |
|----------|------|-----------|
| **CI** | `.github/workflows/ci.yml` | push / pull request |
| **CD** | `.github/workflows/cd.yml` | กด Run workflow หรือ push แท็ก `v*` |

### CI
- ตรวจ syntax ของ `server/`
- สตาร์ทเซิร์ฟเวอร์ + smoke test API (`scripts/ci-test.js`)
- ตรวจว่าหน้าลูกค้าไม่โชว์ UI ร้านค้า

### CD
- สร้างไฟล์ `somtum1pos-v3.tar.gz` (artifact)
- Deploy SSH (ถ้าตั้ง `ENABLE_SSH_DEPLOY=true` + Secrets `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`)

รายละเอียดเพิ่ม: [`.github/README-ACTIONS.md`](.github/README-ACTIONS.md)
