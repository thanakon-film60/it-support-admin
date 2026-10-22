@echo off
REM ==========================================================
REM  ย้ายทางเข้าจากอินเทอร์เน็ตไปใช้ Cloudflare Tunnel
REM    เว็บแอดมิน + LINE webhook -> https://it.thanakronpart-time.com
REM  รันซ้ำได้ ทำเฉพาะขั้นที่ยังไม่เสร็จ (รายละเอียดใน scripts\use-cloudflare.ps1)
REM
REM  use-cloudflare.bat              ใส่ token (ครั้งแรก) แล้วย้ายให้ครบ
REM  use-cloudflare.bat -NewToken    ใส่ token ใหม่ (หลังกด Rotate token ในหน้า Cloudflare)
REM  ต้องเปิด Docker Desktop ไว้ก่อน
REM ==========================================================
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\use-cloudflare.ps1" %*
echo.
pause
