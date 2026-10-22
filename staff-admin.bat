@echo off
rem ---------------------------------------------------------------------------
rem  Staff account manager for the IT Admin web
rem  (add users, set passwords, choose which pages each user can open)
rem
rem  Runs tools\staff_admin.py. Installs the Python package "bcrypt" on first run
rem  (needed to hash passwords exactly like the web does).
rem  Keep this file ASCII + CRLF: cmd.exe misreads UTF-8 .bat files.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo [x] Python 3 not found. Install it from https://www.python.org/downloads/
  echo     ^(tick "Add python.exe to PATH" and keep "tcl/tk and IDLE" selected^)
  pause
  exit /b 1
)

%PY% -c "import bcrypt, tkinter" >nul 2>nul
if errorlevel 1 (
  echo Installing Python package "bcrypt" ^(one time only^)...
  %PY% -m pip install --user bcrypt
  if errorlevel 1 (
    echo [x] "pip install bcrypt" failed - check the internet connection and run this file again.
    pause
    exit /b 1
  )
)

%PY% tools\staff_admin.py %*
if errorlevel 1 pause
endlocal
