# GitHub Actions — CI/CD

## Workflows

| ไฟล์ | หน้าที่ |
|------|---------|
| `.github/workflows/ci.yml` | ตรวจ syntax + smoke test API อัตโนมัติทุก push/PR |
| `.github/workflows/cd.yml` | สร้าง artifact + (ถ้าตั้ง Secrets) deploy ผ่าน SSH |

## CI ทำอะไรบ้าง

1. `node --check` ทุกไฟล์ใน `server/`
2. สตาร์ทเซิร์ฟเวอร์จริง แล้วรัน `scripts/ci-test.js`
3. ตรวจว่าหน้าลูกค้าไม่โชว์ UI ล็อกอินพนักงาน

## เปิดใช้ CD แบบ SSH (VPS)

ไปที่ repo → **Settings → Secrets and variables → Actions** แล้วเพิ่ม:

| Secret | ความหมาย |
|--------|----------|
| `SSH_HOST` | IP หรือโดเมนเซิร์ฟเวอร์ |
| `SSH_USER` | user SSH เช่น `ubuntu` |
| `SSH_PRIVATE_KEY` | private key ทั้งก้อน |
| `SSH_PORT` | (ถ้าไม่ใช่ 22) |
| `DEPLOY_PATH` | เช่น `/opt/somtum1pos` |

จากนั้นรัน workflow **CD** แบบ Manual (Actions → CD → Run workflow)

### ติดตั้ง systemd บนเซิร์ฟเวอร์ (ครั้งแรก)

```bash
sudo cp deploy/somtum1pos.service /etc/systemd/system/
sudo nano /etc/systemd/system/somtum1pos.service   # แก้ JWT_SECRET
sudo systemctl daemon-reload
sudo systemctl enable --now somtum1pos
```

> Deploy จะ **ไม่ทับ** โฟลเดอร์ `data/` บนเซิร์ฟเวอร์ เพื่อไม่ให้ข้อมูลออเดอร์หาย
