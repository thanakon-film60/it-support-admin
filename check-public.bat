@echo off
REM ==========================================================
REM  ตรวจว่าคนนอกเข้า https://<DOMAIN ใน .env>/ ได้จริงไหม (เส้นทาง DuckDNS + Caddy + port forward)
REM  ให้ check-host.net ยิงจากหลายประเทศ แล้วเทียบกับ log ของ Caddy — บอกว่าพังตรงไหน
REM ==========================================================
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\check-public.ps1" %*
echo.
pause
