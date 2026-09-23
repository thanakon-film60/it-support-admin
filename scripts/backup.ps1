#Requires -Version 5.1
<#
    สำรองข้อมูลทั้งระบบออกมาเป็นโฟลเดอร์ตามวันที่

    ทำไมสำคัญเป็นพิเศษกับระบบนี้: ข้อมูลจริงทั้งหมด (ticket / ทรัพย์สิน 251 ชิ้น /
    ผู้ใช้ 182 คน / สต็อก / FAQ) เก็บเป็นไฟล์ JSON อยู่ใน docker volume ชื่อ app_data
    ไม่ได้อยู่ใน Postgres — container db รันอยู่จริงแต่ยังไม่มีโค้ดไหนเรียกใช้เลย

    เคยมีเหตุการณ์ข้อมูลหายถาวรมาแล้วครั้งหนึ่ง ตอนที่ /app/data ยังไม่ได้ mount เป็น
    volume ถาวร — container ถูกสร้างใหม่แล้วข้อมูลในชั้น filesystem หายไปพร้อมกัน กู้ไม่ได้

    รันซ้ำได้ทุกวัน แต่ละครั้งได้โฟลเดอร์ใหม่ตามวันเวลา ไม่ทับของเดิม
#>

# ทำให้ข้อความไทยในหน้าต่างนี้อ่านออก (encoding + ฟอนต์) — ต้องทำก่อนเขียนอะไรออกจอ
. (Join-Path $PSScriptRoot 'console-utf8.ps1')
Initialize-ThaiConsole

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

# เรียกคำสั่งภายนอก (docker) โดยไม่ให้ข้อความความคืบหน้ากลายเป็น error
#
# docker เขียนบรรทัด "Copying ... to ..." ลง stderr เป็นปกติ ไม่ใช่ความผิดพลาด
# แต่เมื่อ redirect ด้วย 2>&1 ในไปป์ไลน์ ขณะที่ $ErrorActionPreference = 'Stop'
# PowerShell 5.1 จะแปลงเป็น NativeCommandError แล้วโยนทิ้งทั้งสคริปต์
# ผลคือ "สำรองสำเร็จแต่รายงานว่าล้ม" และขั้นตอนถัดไป (คัดลอกรูป) ถูกข้ามไปเงียบๆ
# ซึ่งอันตรายกว่าการล้มจริง เพราะคนเห็นข้อความแดงแล้วคิดว่าไม่ได้สำรองอะไรเลย
function Invoke-Native {
    param([Parameter(Mandatory)][scriptblock]$Command)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Command 2>&1 | Out-Null } finally { $ErrorActionPreference = $prev }
}

$stamp  = Get-Date -Format 'yyyy-MM-dd_HHmm'
$dest   = Join-Path $RepoRoot "backups\$stamp"

Write-Host ""
Write-Host "  สำรองข้อมูลระบบ IT Support" -ForegroundColor White
Write-Host "  ปลายทาง: $dest" -ForegroundColor DarkGray
Write-Host ""

try {
    docker version --format '{{.Server.Version}}' 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw }
} catch {
    Write-Host "  [ไม่ผ่าน] ต่อ Docker ไม่ได้ — เปิด Docker Desktop ก่อน" -ForegroundColor Red
    return
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null

# ---- ข้อมูลหลัก (ไฟล์ JSON ที่เป็นฐานข้อมูลจริงของระบบ) ----
Write-Host "  กำลังคัดลอกข้อมูลหลัก..." -ForegroundColor Gray
Invoke-Native { docker compose cp app:/app/data "$dest\data" }
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ไม่ผ่าน] คัดลอก /app/data ไม่สำเร็จ — container app รันอยู่หรือเปล่า?" -ForegroundColor Red
    return
}

# ---- รูปที่ผู้ใช้แนบมาและรูปประกอบ FAQ ----
Write-Host "  กำลังคัดลอกรูปที่อัปโหลด..." -ForegroundColor Gray
Invoke-Native { docker compose cp app:/app/public/uploads "$dest\uploads" }

# ---- ตรวจว่าได้ของครบจริง ไม่ใช่แค่คำสั่งไม่ error ----
$dataDir = Join-Path $dest 'data'
if (-not (Test-Path $dataDir)) {
    Write-Host "  [ไม่ผ่าน] ไม่มีโฟลเดอร์ data ในไฟล์สำรอง" -ForegroundColor Red
    return
}

$expected = @('tickets.json','equipment.json','users.json','stock_items.json','faq_items.json')
$missing  = @()
$total    = 0

Write-Host ""
foreach ($name in $expected) {
    $f = Join-Path $dataDir $name
    if (Test-Path $f) {
        $rows = 0
        try { $rows = (Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json).Count } catch { $rows = -1 }
        $kb = [math]::Round((Get-Item $f).Length / 1KB, 1)
        if ($rows -ge 0) {
            Write-Host ("    {0,-20} {1,6} รายการ  ({2} KB)" -f $name, $rows, $kb) -ForegroundColor Green
            $total += $rows
        } else {
            Write-Host ("    {0,-20} อ่าน JSON ไม่ได้ ({1} KB)" -f $name, $kb) -ForegroundColor Yellow
        }
    } else {
        $missing += $name
        Write-Host ("    {0,-20} ไม่พบ" -f $name) -ForegroundColor Red
    }
}

$size = [math]::Round((Get-ChildItem $dest -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB, 2)

Write-Host ""
if ($missing.Count -eq 0) {
    Write-Host "  สำรองข้อมูลสำเร็จ — รวม $total รายการ, $size MB" -ForegroundColor Green
    Write-Host "  เก็บไว้ที่: $dest" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  แนะนำ: คัดลอกโฟลเดอร์นี้ขึ้น cloud หรือไดรฟ์อื่นด้วย" -ForegroundColor Yellow
    Write-Host "         สำรองไว้บนเครื่องเดียวกับต้นฉบับ ไม่ช่วยอะไรถ้าเครื่องนี้เสีย" -ForegroundColor Yellow
} else {
    Write-Host "  สำรองได้ไม่ครบ — ขาด: $($missing -join ', ')" -ForegroundColor Red
}

# ---- ลบไฟล์สำรองที่เก่ากว่า 30 ชุด กันดิสก์เต็มเงียบๆ ----
$all = Get-ChildItem (Join-Path $RepoRoot 'backups') -Directory -ErrorAction SilentlyContinue |
       Sort-Object Name -Descending
if ($all.Count -gt 30) {
    $old = $all | Select-Object -Skip 30
    foreach ($o in $old) { Remove-Item $o.FullName -Recurse -Force }
    Write-Host ""
    Write-Host "  ลบไฟล์สำรองเก่าทิ้ง $($old.Count) ชุด (เก็บไว้ 30 ชุดล่าสุด)" -ForegroundColor DarkGray
}

Write-Host ""
