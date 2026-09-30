@echo off
REM เปิด Tailscale Funnel ให้ LINE ยิง webhook เข้ามาได้ หลังล็อกอิน Windows
REM ไฟล์นี้ถูกคัดลอกไปไว้ในโฟลเดอร์ Startup โดย deploy.bat (ตัวเลือก "ตั้งให้ทำงานเองหลังรีบูต")
REM
REM ทำไมต้องมี: Tailscale Funnel ไม่ได้จำค่าข้ามการรีบูต ถ้าเครื่องรีสตาร์ทแล้วไม่มีใครรันคำสั่งนี้
REM LINE จะยิง webhook เข้ามาไม่ได้เลย และ "บอทเงียบ" โดยไม่มี error ให้เห็นที่ไหนทั้งสิ้น

set TS="C:\Program Files\Tailscale\tailscale.exe"
if not exist %TS% set TS=tailscale.exe

REM รอ Docker Desktop สตาร์ทก่อน ไม่งั้น funnel จะชี้ไปที่พอร์ตที่ยังไม่มีอะไรฟัง
timeout /t 60 /nobreak >nul

REM ล้าง config เดิมให้เกลี้ยงก่อนเสมอ แล้วค่อยตั้งใหม่
REM
REM ทำไมต้อง off ก่อน (เจอจริง 2026-09-26): ถ้า config บน control plane ค้างเป็นสถานะเสีย
REM การสั่ง `funnel --bg` ซ้ำจะไม่ช่วยอะไรเลย เพราะ config ในเครื่องเหมือนเดิมทุกตัวอักษร
REM Tailscale จึงไม่ส่งอะไรขึ้นไป sync ใหม่ — `tailscale funnel status` ขึ้น "Funnel on" ครบถ้วน
REM แต่ข้างนอกต่อเข้ามาไม่ได้เลย (LINE ได้ COULD_NOT_CONNECT / session closed)
REM restart service ก็ไม่ช่วย เพราะโหลด config เดิมกลับมาทั้งดุ้น
REM
REM ต้องเป็น funnel เท่านั้น ห้ามใช้ serve — สองคำสั่งเขียนทับ config ตัวเดียวกัน
%TS% funnel --https=443 off
%TS% funnel --bg 3000
%TS% funnel --bg --set-path=/webhook 8000
