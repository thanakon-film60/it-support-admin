@echo off
REM ==========================================================
REM  ดับเบิลคลิกไฟล์นี้เพื่อติดตั้ง/อัปเดตระบบ แล้วตรวจผลให้เสร็จในครั้งเดียว
REM  ต้องเปิดโปรแกรม Docker Desktop ไว้ก่อน
REM ==========================================================
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy.ps1" %*
echo.
pause
