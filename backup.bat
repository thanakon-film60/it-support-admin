@echo off
REM ==========================================================
REM  ดับเบิลคลิกเพื่อสำรองข้อมูลทั้งระบบ (ticket / ทรัพย์สิน / สต็อก / ผู้ใช้ / FAQ)
REM
REM  ข้อมูลจริงของระบบเก็บเป็นไฟล์ JSON อยู่ใน docker volume "app_data"
REM  ไม่ได้อยู่ใน Postgres (container db รันอยู่แต่ยังไม่มีโค้ดไหนใช้)
REM  ถ้า volume เสียหรือถูกลบโดยไม่มีสำรอง ข้อมูลหายถาวร กู้ไม่ได้
REM ==========================================================
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup.ps1"
echo.
pause
