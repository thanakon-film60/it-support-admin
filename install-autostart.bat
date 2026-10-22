@echo off
REM ==========================================================
REM  ตั้งค่าครั้งเดียว ให้ระบบดูแลตัวเอง:
REM    - เอาตัวเปิด Tailscale Funnel เดิมออก (ย้ายไป Cloudflare Tunnel แล้ว ขึ้นเองพร้อม Docker)
REM    - สำรองข้อมูลอัตโนมัติทุกวัน
REM
REM  แนะนำ: คลิกขวาที่ไฟล์นี้ แล้วเลือก "Run as administrator"
REM ==========================================================
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-autostart.ps1"
echo.
pause
