@echo off
REM ==========================================================
REM  เปิดเว็บแอดมิน + LINE webhook ออกอินเทอร์เน็ตผ่าน Tailscale Funnel
REM  แล้วตรวจจากมุมคนนอกจริง (ไม่ผ่าน MagicDNS) — ซ่อมเองถ้า Funnel ค้าง
REM
REM  enable-funnel.bat          ตรวจ แล้วซ่อมเฉพาะเมื่อเสีย
REM  enable-funnel.bat -Force   ล้างแล้วตั้งใหม่เสมอ
REM ==========================================================
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\enable-funnel.ps1" %*
echo.
pause
