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

REM ต้องเป็น funnel เท่านั้น ห้ามใช้ serve — สองคำสั่งเขียนทับ config ตัวเดียวกัน
%TS% funnel --bg 3000
%TS% funnel --bg --set-path=/webhook 8000
