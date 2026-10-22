<#
.SYNOPSIS
  ตั้งรหัสผ่านบัญชีแอดมินของหน้าเว็บ IT Admin ใหม่

.DESCRIPTION
  ทำไมต้องมีสคริปต์นี้: หน้าเว็บยังไม่มีเมนู "เปลี่ยนรหัสผ่าน" และรหัสตั้งต้นอยู่ในซอร์สโค้ด
  (src/lib/db/staff.ts) ซึ่งใครอ่าน repo ได้ก็รู้ — ตราบใดที่ยังใช้รหัสนั้น ระบบที่เปิดออก
  อินเทอร์เน็ตผ่าน Tailscale Funnel เท่ากับแทบไม่มีรหัสผ่าน

  รหัสผ่านไม่เคยขึ้นจอ ไม่ถูกเขียนลงไฟล์ชั่วคราว ไม่ผ่าน argument (ซึ่งโผล่ในตาราง process
  และใน `docker inspect`) และไม่เข้าไปอยู่ใน history ของ PowerShell

  งานจริงทั้งหมดอยู่ใน scripts/admin-password.js — ไฟล์นี้ทำแค่รับรหัสผ่านกับย้ายข้อมูล
  เข้า-ออกคอนเทนเนอร์ เพราะ PowerShell กลืนเครื่องหมายคำพูดเวลาส่งโค้ดเป็น argument

  ⚠️ ไฟล์นี้ต้องเซฟเป็น UTF-8 **พร้อม BOM** เสมอ (เหมือน backup.ps1 / deploy.ps1)
  Windows PowerShell 5.1 อ่าน .ps1 ที่ไม่มี BOM เป็น ANSI ตัวอักษรไทยจะเพี้ยนทั้งไฟล์
  แล้ว parser จะพังตั้งแต่บรรทัด param() ด้วย error ที่อ่านไม่ออกว่าเกี่ยวกับ encoding

.EXAMPLE
  .\scripts\set-admin-password.ps1
  .\scripts\set-admin-password.ps1 -Username admin
#>
param(
  [string]$Username = "admin",
  [string]$DisplayName = "ผู้ดูแลระบบ IT"
)

# ทำให้ข้อความไทยในหน้าต่างนี้อ่านออก (encoding + ฟอนต์) — ต้องทำก่อนเขียนอะไรออกจอ
# เหมือน backup.ps1 / deploy.ps1 ไม่งั้นคำถาม "รหัสผ่านใหม่" จะกลายเป็น ???? หรือสี่เหลี่ยมทึบ
# (ฟังก์ชันนี้ตั้ง $OutputEncoding เป็น UTF-8 ด้วย — ชื่อภาษาไทยที่ pipe เข้า node/docker จึงไม่เพี้ยน)
. (Join-Path $PSScriptRoot 'console-utf8.ps1')
Initialize-ThaiConsole

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# ไฟล์ที่แอป "อ่านจริง" = data/<COLLECTION>.json โดย COLLECTION = "staff_accounts" (src/lib/db/staff.ts)
#
# บั๊กเดิม (แก้ 2 ต.ค. 2026): สคริปต์รุ่นแรกเขียน staff.json ซึ่งแอปไม่เคยเปิดอ่านเลย ถ้ารันผ่านได้
# จะขึ้น "ตั้งรหัสผ่านแล้ว" ทั้งที่รหัสตั้งต้นยังล็อกอินได้ — ปลอดภัยปลอม ซึ่งแย่กว่า error
# เปลี่ยนชื่อ collection ใน staff.ts เมื่อไหร่ ต้องแก้บรรทัดนี้ตามทุกครั้ง
$DataFile = "/app/data/staff_accounts.json"

function Fail { param($m) Write-Host "  [x] $m" -ForegroundColor Red; exit 1 }

# ---- ตรวจของที่ต้องมีก่อนถามรหัสผ่าน — ไม่ให้พิมพ์ 2 รอบแล้วค่อยมารู้ว่าทำไม่ได้ ----

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "ไม่พบ node — ติดตั้ง Node.js ก่อน (https://nodejs.org)"
}
if (-not (Test-Path (Join-Path $root "node_modules\bcryptjs"))) {
  Fail "ไม่พบ bcryptjs ใน node_modules — รัน npm install ที่โฟลเดอร์โปรเจกต์ก่อน"
}

# คอนเทนเนอร์ต้องรันอยู่ — ถ้าไม่รัน exec ทุกตัวล้ม แล้วได้สตริงว่างกลับมาหน้าตาเหมือน "ยังไม่มีไฟล์"
# สคริปต์จะสร้างบัญชีใหม่ทับ แล้วเขียนกลับไม่ได้ ไล่สาเหตุยาก จึงเช็คให้ชัดตั้งแต่ต้น
$probe = docker compose exec -T app sh -c "test -d /app/data && echo READY"
if ($LASTEXITCODE -ne 0 -or "$probe" -notmatch 'READY') {
  Fail "ติดต่อคอนเทนเนอร์ app ไม่ได้ — Docker Desktop เปิดอยู่ไหม? ลอง: docker compose up -d app"
}

Write-Host ""
Write-Host "  ตั้งรหัสผ่านแอดมินใหม่ (ชื่อผู้ใช้: $Username)" -ForegroundColor Cyan
Write-Host ""

$p1 = Read-Host "  รหัสผ่านใหม่" -AsSecureString
$p2 = Read-Host "  พิมพ์อีกครั้งเพื่อยืนยัน" -AsSecureString

# PtrToStringBSTR ไม่ใช่ PtrToStringAuto — Auto ถอดตาม charset ของ OS ซึ่งบน pwsh นอก Windows
# อ่าน BSTR (UTF-16) ผิด ได้รหัสผ่านเหลือตัวเดียวแบบเงียบๆ
$b1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1)
$b2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2)
$plain1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b1)
$plain2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b2)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b1)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b2)

if ($plain1 -cne $plain2) { Fail "รหัสผ่านสองครั้งไม่ตรงกัน" }
if ($plain1.Length -lt 12) {
  # 12 ตัวเป็นขั้นต่ำที่สมเหตุสมผลเมื่อหน้าเว็บเปิดออกอินเทอร์เน็ต — หน้า login ไม่มีตัวจำกัด
  # จำนวนครั้งที่กรอกผิด รหัสสั้นกว่านี้จึงถูกไล่เดาจนเจอได้ในเวลาที่ยอมรับไม่ได้
  Fail "สั้นเกินไป ขอ 12 ตัวอักษรขึ้นไป"
}
if ($plain1 -eq "ITadmin@2026") { Fail "ห้ามใช้รหัสตั้งต้น — รหัสนี้อยู่ในซอร์สโค้ด" }

# อ่านไฟล์เดิมออกมาจากคอนเทนเนอร์ (อยู่บน docker volume app_data ไม่ใช่ในโฟลเดอร์โปรเจกต์)
# แยก "ไม่มีไฟล์" ออกจาก "อ่านไม่ได้" ด้วย marker — สองกรณีนี้ต้องทำต่างกัน
$existing = (docker compose exec -T app sh -c "if [ -f $DataFile ]; then cat $DataFile; else echo __NO_FILE__; fi" | Out-String)
if ($LASTEXITCODE -ne 0) { Fail "อ่าน $DataFile จากคอนเทนเนอร์ไม่ได้" }
$hadFile = $existing.Trim() -ne "__NO_FILE__"
if (-not $hadFile) { $existing = "" }
$isUpdate = $hadFile -and ($existing -match ('"username"\s*:\s*"' + [regex]::Escape($Username) + '"'))

$payload = @{
  password    = $plain1
  username    = $Username
  displayName = $DisplayName
  existing    = $existing
} | ConvertTo-Json -Compress
$plain1 = $null; $plain2 = $null

# แฮชบนเครื่องนี้ ไม่ใช่ในคอนเทนเนอร์: Next build แบบ standalone บันเดิล bcryptjs เข้าไปใน
# ชังก์ของเซิร์ฟเวอร์ ในคอนเทนเนอร์จึงไม่มีโมดูลให้ require (ลองแล้วได้ MODULE_NOT_FOUND)
# ส่วนโฟลเดอร์โปรเจกต์มี node_modules ครบ และเป็น bcryptjs ตัวเดียวกับที่ใช้ตรวจตอนล็อกอิน
#
# ต้อง | Out-String — node พิมพ์ JSON หลายบรรทัด PowerShell จะได้เป็น "array ของบรรทัด"
# แล้ว -match/-notmatch กับ array จะ "กรองสมาชิก" แทนที่จะคืน true/false (บั๊กเดิม: ได้ข้อมูลถูก
# ทุกอย่างแต่สคริปต์รายงานว่าล้ม)
$merged = ($payload | node (Join-Path $PSScriptRoot "admin-password.js") | Out-String)
$payload = $null
if ($LASTEXITCODE -ne 0 -or -not $merged.Trim()) { Fail "สร้างข้อมูลบัญชีไม่สำเร็จ (node ล้ม — ดูข้อความด้านบน)" }

try { $want = @((ConvertFrom-Json $merged) | Where-Object { $_.username -eq $Username })[0].password_hash }
catch { $want = $null }
if (-not $want) { Fail "ข้อมูลที่ node สร้างไม่มีบัญชี '$Username'" }

# เขียนกลับเข้าคอนเทนเนอร์ผ่าน stdin — ไม่ต้องยัดเนื้อ JSON เป็น argument ให้ PowerShell ทำพัง
# เขียนลงไฟล์ชั่วคราวก่อนแล้ว mv — ถ้าสายหลุดกลางทาง ไฟล์จริงไม่ถูกตัดเหลือครึ่งจนล็อกอินไม่ได้ทั้งระบบ
$merged | docker compose exec -T app sh -c "cat > $DataFile.tmp && mv $DataFile.tmp $DataFile"
if ($LASTEXITCODE -ne 0) { Fail "เขียน $DataFile ไม่สำเร็จ" }

# ตรวจจาก "สิ่งที่แอปจะอ่านจริง" — hash ในไฟล์ปลายทางต้องตรงกับที่เพิ่งสร้าง
# (เทียบแค่ว่ามีชื่อผู้ใช้อยู่ไม่พอ: ไฟล์เดิมก็มี admin อยู่แล้ว ต่อให้เขียนไม่สำเร็จก็ผ่าน)
$check = (docker compose exec -T app sh -c "cat $DataFile" | Out-String)
try { $got = @((ConvertFrom-Json $check) | Where-Object { $_.username -eq $Username })[0].password_hash }
catch { $got = $null }

if ($got -and $got -ceq $want) {
  Write-Host ""
  if ($isUpdate) { Write-Host "  [v] เปลี่ยนรหัสผ่านของ '$Username' แล้ว" -ForegroundColor Green }
  else { Write-Host "  [v] สร้างบัญชี '$Username' พร้อมรหัสผ่านใหม่แล้ว" -ForegroundColor Green }
  Write-Host "      ล็อกอินใหม่ได้ทันที ไม่ต้อง deploy ซ้ำ (แอปอ่านไฟล์ใหม่ทุกครั้งที่ล็อกอิน)" -ForegroundColor DarkGray
  Write-Host "      session ที่ล็อกอินค้างไว้ยังใช้ได้จนหมดอายุ (7 วัน) — รหัสใหม่มีผลกับการล็อกอินครั้งถัดไป" -ForegroundColor DarkGray
  Write-Host ""
} else {
  Fail "ไฟล์ปลายทางไม่ได้มีรหัสใหม่ — รหัสเดิมยังใช้อยู่ ห้ามถือว่าเปลี่ยนแล้ว"
}
