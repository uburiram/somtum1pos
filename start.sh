#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# พาธฐานข้อมูลเริ่มต้น = โฟลเดอร์โปรเจกต์/data
export SOM_TUM_DATA="${SOM_TUM_DATA:-$PWD/data}"
mkdir -p "$SOM_TUM_DATA" "$PWD/public/uploads"

echo "========================================"
echo " ส้มตำนายหนึ่ง POS v3"
echo "========================================"
echo " Project : $PWD"
echo " Database: $SOM_TUM_DATA/somtum.db"
echo " Uploads : $PWD/public/uploads"
echo " Port    : ${PORT:-3080}"
echo ""
echo " ลูกค้า (ติด QR): http://localhost:${PORT:-3080}/"
echo " ร้านค้า (Login) : http://localhost:${PORT:-3080}/pos"
echo " user/pass       : admin / 1234"
echo "========================================"

exec node server/index.js
