#Requires -Version 5.1
<#
    ตั้งค่าครั้งเดียว ให้ระบบดูแลตัวเองได้โดยไม่ต้องมีคนคอยรันคำสั่ง

    ทำ 2 อย่าง:
      1. เปิด Tailscale Funnel อัตโนมัติหลังล็อกอิน Windows
         (Funnel ไม่จำค่าข้ามการรีบูต — เครื่องรีสตาร์ทแล้วไม่มีใครรันคำสั่ง = LINE ยิง webhook
          เข้ามาไม่ได้ และบอทจะ "เงียบ" โดยไม่มี error ให้เห็นที่ไหนเลย ซึ่งหายากมาก)
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

# ---- 1. Tailscale Funnel หลังล็อกอิน ----

$startup = [Environment]::GetFolderPath('Startup')
$src     = Join-Path $PSScriptRoot 'startup-funnel.bat'
$dstName = 'it-support-funnel.bat'

if (Test-Path $src) {
    try {
        Copy-Item $src (Join-Path $startup $dstName) -Force
        Write-Host "  [ผ่าน] Tailscale Funnel จะเปิดเองทุกครั้งที่ล็อกอิน Windows" -ForegroundColor Green
        Write-Host "         ไฟล์อยู่ที่: $startup\$dstName" -ForegroundColor DarkGray
    } catch {
        Write-Host "  [ไม่ผ่าน] คัดลอกไฟล์ไป Startup ไม่ได้: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "  [ไม่ผ่าน] ไม่พบ $src" -ForegroundColor Red
}

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
