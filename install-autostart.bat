@echo off
REM ==========================================================
REM  ตั้งค่าครั้งเดียว ให้ระบบดูแลตัวเอง:
REM    - Tailscale Funnel เปิดเองหลังรีบูต (ไม่งั้นบอทเงียบโดยไม่มี error)
REM    - สำรองข้อมูลอัตโนมัติทุกวัน
REM
REM  แนะนำ: คลิกขวาที่ไฟล์นี้ แล้วเลือก "Run as administrator"
REM ==========================================================
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-autostart.ps1"
echo.
pause
