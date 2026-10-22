#Requires -Version 5.1
<#
    ตั้งค่าครั้งเดียว ให้ระบบดูแลตัวเองได้โดยไม่ต้องมีคนคอยรันคำสั่ง

    ทำ 2 อย่าง:
      1. เอาตัวเปิด Tailscale Funnel เดิมออกจาก Startup (ถ้ายังมี)
         ตั้งแต่ 7 ต.ค. 2026 ทางเข้าจากอินเทอร์เน็ตคือ Cloudflare Tunnel ซึ่งเป็น container
         (restart: unless-stopped) ขึ้นเองพร้อม Docker Desktop จึงไม่ต้องมีตัวเรียกใน Startup อีก
         แต่ Docker Desktop ต้องตั้งให้เปิดเองตอนล็อกอิน ไม่งั้นรีบูตแล้วบอทเงียบเหมือนเดิม
      2. สำรองข้อมูลอัตโนมัติทุกวัน
         (ข้อมูลจริงเป็นไฟล์ JSON ใน docker volume ไม่ใช่ Postgres — เคยหายถาวรมาแล้วครั้งหนึ่ง)

    รันซ้ำได้ ไม่สร้างงานซ้ำซ้อน
#>

# ทำให้ข้อความไทยในหน้าต่างนี้อ่านออก (encoding + ฟอนต์) — ต้องทำก่อนเขียนอะไรออกจอ
. (Join-Path $PSScriptRoot 'console-utf8.ps1')
Initialize-ThaiConsole

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "  ตั้งค่าให้ระบบดูแลตัวเอง" -ForegroundColor White
Write-Host ""

# ---- 1. ทางเข้าจากอินเทอร์เน็ต ----
# ตัวเรียก Funnel ของเดิมต้องเอาออก ไม่งั้นทุกครั้งที่ล็อกอิน Funnel จะเปิดกลับมาเป็นทางเข้าที่สอง
# โดยไม่มีใครรู้ (use-cloudflare.ps1 ก็เอาออกให้ ที่นี่ทำซ้ำเผื่อเครื่องที่ตั้งใหม่จาก backup)

$startup = [Environment]::GetFolderPath('Startup')
$oldLauncher = $null
if ($startup) { $oldLauncher = Join-Path $startup 'it-support-funnel.bat' }
if ($oldLauncher -and (Test-Path $oldLauncher)) {
    try {
        Remove-Item $oldLauncher -Force
        Write-Host "  [ผ่าน] เอาตัวเปิด Tailscale Funnel เดิมออกจาก Startup แล้ว" -ForegroundColor Green
    } catch {
        Write-Host "  [ไม่ผ่าน] ลบ $oldLauncher ไม่ได้: $($_.Exception.Message) — ลบเองด้วยมือ" -ForegroundColor Red
    }
}
Write-Host "  [ผ่าน] ทางเข้าจากอินเทอร์เน็ตคือ Cloudflare Tunnel (container ขึ้นเองพร้อม Docker Desktop)" -ForegroundColor Green
Write-Host "         ตรวจว่า Docker Desktop เปิดเองตอนล็อกอิน: Settings > General > Start Docker Desktop when you sign in" -ForegroundColor DarkGray

# ---- 2. สำรองข้อมูลทุกวัน ----

$taskName = 'IT Support - สำรองข้อมูลรายวัน'
$backupPs = Join-Path $PSScriptRoot 'backup.ps1'

try {
    $action = New-ScheduledTaskAction `
        -Execute 'powershell.exe' `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$backupPs`""

    # 12:30 — ช่วงพักเที่ยง เครื่องเปิดอยู่แน่ๆ และไม่ชนกับช่วงงานหนัก
    $trigger = New-ScheduledTaskTrigger -Daily -At '12:30'

    # ถ้าเครื่องปิดตอนถึงเวลา ให้รันทันทีที่เปิดเครื่องแทน ไม่ใช่ข้ามไปเลย
    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -DontStopIfGoingOnBatteries `
        -AllowStartIfOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Description 'สำรอง ticket/ทรัพย์สิน/สต็อก/ผู้ใช้ ของระบบ IT Support' `
        -Force | Out-Null

    Write-Host "  [ผ่าน] ตั้งสำรองข้อมูลอัตโนมัติทุกวัน 12:30 น. แล้ว" -ForegroundColor Green
    Write-Host "         ไฟล์สำรองจะอยู่ที่: $RepoRoot\backups\" -ForegroundColor DarkGray
} catch {
    Write-Host "  [ไม่ผ่าน] ตั้งงานสำรองข้อมูลไม่สำเร็จ: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "         ลองคลิกขวาที่ install-autostart.bat แล้วเลือก 'Run as administrator'" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  เสร็จแล้ว — ตรวจได้ที่ Task Scheduler ของ Windows" -ForegroundColor White
Write-Host ""
Write-Host "  หมายเหตุ: ไฟล์สำรองอยู่บนเครื่องเดียวกับต้นฉบับ" -ForegroundColor Yellow
Write-Host "            ควรตั้ง OneDrive/Google Drive sync โฟลเดอร์ backups\ ไว้ด้วย" -ForegroundColor Yellow
Write-Host "            ไม่งั้นเครื่องนี้เสีย = หายทั้งต้นฉบับและสำรอง" -ForegroundColor Yellow
Write-Host ""
