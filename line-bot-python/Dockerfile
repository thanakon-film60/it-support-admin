# syntax=docker/dockerfile:1

# base เดียวพอ (ไม่ต้อง multi-stage แบบฝั่ง Next.js) เพราะ pip ไม่มีขั้นตอน "build" แยกจาก "runtime"
# เหมือน npm run build — ติดตั้ง dependency แล้วรันได้เลย
FROM python:3.14-slim

WORKDIR /app

# แยก layer ติดตั้ง dependency ออกจาก layer copy โค้ด — แก้โค้ดบ่อยแค่ไหน ก็ไม่ต้องติดตั้งซ้ำ
# ถ้า requirements.txt ไม่เปลี่ยน (เหมือนหลักการเดียวกับ deps stage ใน Dockerfile ฝั่ง Next.js)
COPY requirements.txt ./
# pythainlp/rapidfuzz มี C extension แต่มี wheel สำเร็จรูปสำหรับ linux/amd64 อยู่แล้ว จึงไม่ต้องลง
# build-essential เพิ่ม (ถ้าวันหนึ่ง build พังเพราะหา wheel ไม่เจอ ค่อยเพิ่ม apt-get install
# build-essential ก่อน pip install บรรทัดนี้)
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# รันด้วย user ที่ไม่ใช่ root เหมือนฝั่ง Next.js (Dockerfile หลักของโปรเจกต์นี้ทำแบบนี้)
# ต้องสร้าง home directory ให้จริงๆ ด้วย — adduser --system เฉยๆ จะได้ HOME=/nonexistent
# ซึ่ง pythainlp พังทันทีตอนพยายามสร้างโฟลเดอร์ cache ข้อมูล (~/pythainlp-data) ตอน import ครั้งแรก
# (เจอจริงตอนทดสอบ: PermissionError: [Errno 13] Permission denied: '/nonexistent')
RUN addgroup --system --gid 1001 bot \
  && adduser --system --uid 1001 --gid 1001 bot \
  && mkdir -p /home/bot \
  && chown -R bot:bot /home/bot
ENV HOME=/home/bot
USER bot

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
