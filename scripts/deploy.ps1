#Requires -Version 5.1
<#
    ติดตั้ง/อัปเดตระบบ IT Support + LINE OA แล้วตรวจผลให้เสร็จในคำสั่งเดียว

    ไม่ต้องรันไฟล์นี้ตรงๆ — ดับเบิลคลิก deploy.bat ที่โฟลเดอร์หลักของโปรเจกต์แทน

    สคริปต์นี้ทำ 3 อย่าง:
      1. build + start container (app, bot และ tunnel ของ Cloudflare เมื่อใส่ token แล้ว)
      2. ตรวจว่าของใหม่ทำงานจริงทุกจุด ไม่ใช่แค่ "คำสั่งไม่ error"
      3. ตรวจทางเข้าจากอินเทอร์เน็ต (Cloudflare Tunnel) ว่าคนนอกเปิดเว็บได้ และ LINE ยิง webhook เข้ามาได้จริง

    ออกแบบให้รันซ้ำได้เสมอ ไม่มีขั้นตอนไหนที่รันสองรอบแล้วพัง
#>

param(
    # ข้ามการตรวจทางเข้าจากอินเทอร์เน็ต (ชื่อเดิม -SkipTailscale ยังใช้ได้)
    [Alias('SkipTailscale')]
    [switch]$SkipPublic,
    # ทางสำรองชั่วคราว: กลับไปใช้ Tailscale Funnel แทน Cloudflare Tunnel (ต้องย้าย LINE webhook กลับเองด้วย)
    [switch]$Funnel,
    # ใช้คู่กับ -Funnel เท่านั้น: ตั้งให้ Funnel ทำงานเองทุกครั้งที่ล็อกอินเข้า Windows
    [switch]$InstallAutostart
)

# ทำให้ข้อความไทยในหน้าต่างนี้อ่านออก (encoding + ฟอนต์) — ต้องทำก่อนเขียนอะไรออกจอ
. (Join-Path $PSScriptRoot 'console-utf8.ps1')
Initialize-ThaiConsole

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Windows PowerShell 5.1 บนบางเครื่องยังตั้ง TLS 1.0 เป็นค่าตั้งต้น ซึ่งเซิร์ฟเวอร์สมัยใหม่
# ปฏิเสธไปแล้ว ทำให้การเช็คโดเมน https (Cloudflare / LINE API) ล้มเหลวทั้งที่ระบบปกติดี
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

# ---------------------------------------------------------------- ตัวช่วยแสดงผล

$script:Failures = @()
$script:Warnings = @()

function Write-Step  { param($m) Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Pass  { param($m) Write-Host "  [ผ่าน] $m" -ForegroundColor Green }
function Write-Warn  { param($m) Write-Host "  [เตือน] $m" -ForegroundColor Yellow; $script:Warnings += $m }
function Write-Fail  { param($m) Write-Host "  [ไม่ผ่าน] $m" -ForegroundColor Red; $script:Failures += $m }
function Write-Info  { param($m) Write-Host "  $m" -ForegroundColor Gray }

# เรียก URL ในเครื่องแล้วคืน [int]status กับ [string]body — ไม่ throw ถ้าต่อไม่ได้
# อ่าน body ของ HTTP ให้เป็น UTF-8 เสมอ
#
# Windows PowerShell 5.1 (ตัวที่ deploy.bat เรียกใช้) ถอดรหัส $r.Content ตาม charset
# ที่ติดมากับ Content-Type ถ้าไม่มี charset จะเดาเป็น ISO-8859-1 — ภาษาไทยที่ API ส่งมา
# จึงกลายเป็นอักษรขยะ และที่ร้ายกว่าคือ "การเทียบข้อความไทยทุกจุดจะพลาดหมด"
#
# เจอจริง 2026-09-26: ลูปที่รอ rich menu ติดตั้งให้เสร็จเทียบกับคำว่า "กำลังติดตั้ง"
# แล้วเทียบไม่ตรงเพราะ body เพี้ยน ลูปจึงหลุดทันทีและรายงานว่า "ติดตั้งไม่สำเร็จ"
# ทั้งที่บอทกำลังติดตั้งอยู่และสำเร็จในอีกไม่กี่วินาที
#
# RawContentStream มีทั้งใน 5.1 และ 7.x จึงใช้ได้ทั้งสองรุ่นโดยไม่ต้องแยกเคส
function Get-Utf8Body {
    param($Response)
    try {
        $bytes = $Response.RawContentStream.ToArray()
        if ($bytes.Length -gt 0) { return [Text.Encoding]::UTF8.GetString($bytes) }
    } catch { }
    return $Response.Content
}

function Invoke-Local {
    param([string]$Url, [int]$TimeoutSec = 10)
    try {
        $r = Invoke-WebRequest -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop
        return @{ Status = [int]$r.StatusCode; Body = (Get-Utf8Body $r); Headers = $r.Headers }
    } catch {
        # ต้องรองรับ PowerShell ทั้ง 2 รุ่นที่เจอบน Windows จริง:
        #   5.1 (powershell.exe เรียก) -> HTTP 4xx/5xx โยน System.Net.WebException
        #                                 อ่าน body ได้จาก GetResponseStream()
        #   7.x (pwsh)                 -> โยน HttpResponseException ไม่มี GetResponseStream()
        #                                 body อยู่ใน $_.ErrorDetails.Message
        # ถ้าดัก WebException อย่างเดียว บน 7.x จะตกมา catch รวมแล้วคืน Status 0 ทำให้
        # "404 ที่ถูกต้อง" ถูกรายงานว่า "เรียกไม่ได้เลย" ซึ่งชี้ปัญหาผิดจุด (เจอจริงตอนทดสอบสคริปต์นี้)
        $resp = $null
        try { $resp = $_.Exception.Response } catch { }

        if ($resp) {
            $status = 0
            try { $status = [int]$resp.StatusCode } catch { }

            $body = ''
            if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
                $body = $_.ErrorDetails.Message
            } else {
                try {
                    $stream = $resp.GetResponseStream()
                    if ($stream) { $body = (New-Object System.IO.StreamReader($stream, [Text.Encoding]::UTF8)).ReadToEnd() }
                } catch { }
            }

            if ($status -gt 0) { return @{ Status = $status; Body = $body } }
        }
        return @{ Status = 0; Body = $_.Exception.Message }
    }
}

# อ่านค่าเดียวจาก .env — ห้ามพิมพ์ค่าที่ได้ออกจอ (ไฟล์นี้มีความลับของระบบ)
function Read-EnvValue {
    param([string]$Name)
    $f = Join-Path $RepoRoot '.env'
    if (-not (Test-Path $f)) { return $null }
    $line = Get-Content $f -Encoding UTF8 | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -Last 1
    if (-not $line) { return $null }
    return (($line -replace "^\s*$Name\s*=\s*", '') -replace '^["'']|["'']$', '').Trim()
}

# tunnel ต่อ Cloudflare ติดหรือยัง — cloudflared ตอบ 200 ที่ /ready ถามจากในเครือข่ายของ compose ผ่าน
# container app (มี node) แทนการเปิดพอร์ตออกมาที่เครื่อง: cloudflared ของงานอื่นที่ติดตั้งบนเครื่องนี้
# จองพอร์ต 20241-20245 ไว้แล้ว เปิดชนกันแล้ว container tunnel สตาร์ทไม่ขึ้น (เจอจริง 8 ต.ค. 2026)
# EAP = Continue เฉพาะในนี้: compose เขียนคำเตือนลง stderr ได้ทั้งที่สำเร็จ ถ้า Stop จะกลายเป็น "ไม่ผ่าน" ปลอม
function Test-TunnelReady {
    $ErrorActionPreference = 'Continue'
    $js = "fetch('http://tunnel:20241/ready').then(r=>process.exit(r.status==200?0:1),()=>process.exit(1))"
    try {
        docker compose exec -T app node -e $js 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}

# ตัวชี้ขาดว่าบอทรับข้อความได้จริง: ให้เซิร์ฟเวอร์ LINE ยิง webhook เข้ามาเอง (ไม่กินโควตา push)
# และตรวจว่า Webhook URL ใน LINE ชี้มาที่ทางเข้าปัจจุบัน — ย้ายทางเข้าแล้วลืมย้าย URL = บอทเงียบ
function Test-LineWebhookUrl {
    param([string]$Want)
    $token = Read-EnvValue 'LINE_CHANNEL_ACCESS_TOKEN'
    if (-not $token) { Write-Warn 'ไม่พบ LINE_CHANNEL_ACCESS_TOKEN ใน .env — ข้ามการให้ LINE ทดสอบ'; return }
    $h = @{ Authorization = "Bearer $token" }
    try {
        $ep = Invoke-RestMethod -Uri 'https://api.line.me/v2/bot/channel/webhook/endpoint' -Headers $h -TimeoutSec 15
        if ($ep.endpoint -ne $Want) {
            Write-Fail "LINE ยังส่ง webhook ไปที่ '$($ep.endpoint)' ไม่ใช่ '$Want' — ดับเบิลคลิก use-cloudflare.bat เพื่อย้าย"
        } elseif (-not $ep.active) {
            Write-Warn 'Webhook URL ถูกแล้ว แต่ "Use webhook" ยังปิดอยู่ใน LINE Developers Console'
        }
    } catch { Write-Warn "อ่าน Webhook URL จาก LINE ไม่ได้: $($_.Exception.Message)" }
    try {
        $t = Invoke-RestMethod -Uri 'https://api.line.me/v2/bot/channel/webhook/test' -Method Post -Headers $h `
            -ContentType 'application/json' -Body (@{ endpoint = $Want } | ConvertTo-Json) -TimeoutSec 30
        if ($t.success) { Write-Pass "LINE ยิง webhook เข้ามาได้จริง (statusCode $($t.statusCode))" }
        else { Write-Fail "LINE ยิงเข้ามาไม่สำเร็จ: $($t.reason) $($t.detail)" }
    } catch { Write-Warn "เรียก LINE webhook test ไม่ได้: $($_.Exception.Message)" }
}

# ---------------------------------------------------------------- เริ่ม

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

Write-Host ""
Write-Host "  ระบบ IT Support + LINE OA — ติดตั้ง/อัปเดต" -ForegroundColor White
Write-Host "  โฟลเดอร์: $RepoRoot" -ForegroundColor DarkGray
Write-Host "  เวลา: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor DarkGray

# ---- 0. ตรวจว่าเครื่องมือพร้อม ----

Write-Step "0. ตรวจเครื่องมือที่จำเป็น"

try {
    docker version --format '{{.Server.Version}}' 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker ตอบกลับไม่สำเร็จ" }
    Write-Pass "Docker ทำงานอยู่"
} catch {
    Write-Fail "ต่อ Docker ไม่ได้ — เปิดโปรแกรม Docker Desktop แล้วรอจนไอคอนขึ้นเขียว จากนั้นรันไฟล์นี้ใหม่"
    return
}

if (-not (Test-Path (Join-Path $RepoRoot 'docker-compose.yml'))) {
    Write-Fail "ไม่พบ docker-compose.yml ใน $RepoRoot"
    return
}
Write-Pass "พบ docker-compose.yml"

if (-not (Test-Path (Join-Path $RepoRoot '.env'))) {
    Write-Fail "ไม่พบไฟล์ .env — ระบบจะไม่มี LINE token / INTERNAL_API_KEY และบอทจะไม่สตาร์ท"
    return
}
Write-Pass "พบไฟล์ .env"

$menuImage = Join-Path $RepoRoot 'line-oa\assets\richmenu-main.png'
if (Test-Path $menuImage) {
    $kb = [math]::Round((Get-Item $menuImage).Length / 1KB)
    if ($kb -gt 1000) {
        Write-Warn "รูป rich menu ใหญ่ $kb KB เกินลิมิต 1 MB ของ LINE — เมนูจะติดตั้งไม่ขึ้น"
    } else {
        Write-Pass "พบรูป rich menu ($kb KB)"
    }
} else {
    Write-Warn "ไม่พบ line-oa\assets\richmenu-main.png — เมนูจะติดตั้งไม่ได้ (สร้างใหม่ด้วย: python line-oa\make_assets.py)"
}

# ---- 1. build + start ----

Write-Step "1. Build และสตาร์ท container (ใช้เวลา 1-3 นาที)"
# tunnel (Cloudflare) สตาร์ทเฉพาะเมื่อใส่ token แล้ว — ไม่มี token แล้วสั่ง up จะวนรีสตาร์ทไม่จบ
$tunnelToken = Read-EnvValue 'CLOUDFLARE_TUNNEL_TOKEN'
$publicHost = Read-EnvValue 'PUBLIC_HOST'
if (-not $publicHost) { $publicHost = 'it.thanakronpart-time.com' }
$services = @('app', 'bot')
if ($tunnelToken -and -not $Funnel) { $services += 'tunnel' }
Write-Info "กำลังรัน: docker compose up -d --build $($services -join ' ')"

docker compose up -d --build @services
if ($LASTEXITCODE -ne 0) {
    Write-Fail "build ไม่สำเร็จ — อ่านข้อความ error ด้านบน"
    return
}
Write-Pass "build และสตาร์ทเรียบร้อย"

# ---- 2. รอให้บริการพร้อม ----

Write-Step "2. รอให้บริการพร้อมทำงาน"

$deadline = (Get-Date).AddSeconds(90)
$appReady = $false
$botReady = $false

while ((Get-Date) -lt $deadline -and -not ($appReady -and $botReady)) {
    if (-not $appReady) {
        # 200 หรือ 307 (redirect ไป login) ถือว่าแอปตอบแล้วทั้งคู่
        $r = Invoke-Local 'http://127.0.0.1:3000/' 5
        if ($r.Status -ge 200 -and $r.Status -lt 400) { $appReady = $true; Write-Pass "แอปแอดมินพร้อม (พอร์ต 3000)" }
    }
    if (-not $botReady) {
        $r = Invoke-Local 'http://127.0.0.1:8000/health' 5
        if ($r.Status -eq 200) { $botReady = $true; Write-Pass "บอท LINE พร้อม (พอร์ต 8000)" }
    }
    if (-not ($appReady -and $botReady)) { Start-Sleep -Seconds 3 }
}

if (-not $appReady) { Write-Fail "แอปแอดมินไม่ตอบใน 90 วินาที — ดู log ด้วย: docker compose logs app --tail 50" }
if (-not $botReady) { Write-Fail "บอทไม่ตอบใน 90 วินาที — ดู log ด้วย: docker compose logs bot --tail 50" }
if (-not ($appReady -and $botReady)) { return }

# ---- 3. ตรวจว่าโค้ดใหม่ทำงานจริง ----
# สำคัญ: ตรวจที่ "ผลลัพธ์ปลายทาง" ไม่ใช่แค่ว่าคำสั่ง build ไม่ error
# (เคยเจอมาแล้วว่า SQL patch รันผ่านแต่แอปไม่ได้อ่านจากที่นั่นเลย)

Write-Step "3. ตรวจว่าของใหม่ทำงานจริง"

# rich menu ถูกติดตั้งเป็น background task (main.py -> _install_rich_menu) บอทจึงตอบ /health ได้
# ตั้งแต่ก่อนติดตั้งเสร็จ ถ้าอ่านครั้งเดียวจะได้สถานะ "กำลังติดตั้ง..." แล้วสรุปว่าพัง
# ทั้งที่อีกไม่กี่วินาทีก็สำเร็จ — ต้องรอให้สถานะนิ่งก่อนค่อยตัดสิน
#
# เดิมแทบไม่เจอ เพราะกรณีปกติคือ "มีอยู่แล้ว" ซึ่งใช้แค่ 3 คำขอ GET (ไม่ถึงครึ่งวินาที)
# แต่รอบที่ปุ่มเปลี่ยนจริง ต้องลบเมนูเก่า + ลบ alias + สร้างใหม่ + อัปโหลดรูป + ตั้ง alias
# + ตั้งเป็นเมนูเริ่มต้น รวม 6-7 คำขอไป api.line.me ใช้เวลาหลายวินาที จึงชนแทบทุกครั้ง
$h = $null
$menuDeadline = (Get-Date).AddSeconds(60)
$menuWaitShown = $false
while ($true) {
    $health = Invoke-Local 'http://127.0.0.1:8000/health'
    try { $h = $health.Body | ConvertFrom-Json } catch { $h = $null }
    # เทียบจาก richmenu_state ที่เป็น ASCII เท่านั้น ห้ามเทียบข้อความไทยจาก body
    # (บอทรุ่นก่อน 2026-09-26 ยังไม่มีฟิลด์นี้ ให้หลุดลูปไปตัดสินด้านล่างเลย)
    if ($null -eq $h -or $h.richmenu_state -ne 'installing') { break }
    if ((Get-Date) -ge $menuDeadline) { break }
    if (-not $menuWaitShown) {
        Write-Info "บอทกำลังติดตั้ง rich menu อยู่ (ลบเมนูเก่า + อัปโหลดรูปใหม่) รอสักครู่..."
        $menuWaitShown = $true
    }
    Start-Sleep -Seconds 2
}

if ($null -eq $h) {
    Write-Fail "อ่านผลจาก /health ไม่ได้"
} else {
    if ($null -ne $h.richmenu) {
        Write-Pass "บอทรันโค้ดชุดใหม่แล้ว"

        # บอทรุ่นก่อน 2026-09-26 ไม่มี richmenu_state — เดาจากคำนำหน้าที่เป็น ASCII แทน
        # (ข้อความไทยเชื่อถือไม่ได้ เพราะรุ่นนั้นยังไม่ได้ส่ง charset มาด้วย)
        $menuState = $h.richmenu_state
        if ([string]::IsNullOrEmpty($menuState)) {
            if ($h.richmenu -like 'installed*') { $menuState = 'installed' }
            elseif ($h.richmenu -like 'ok*')    { $menuState = 'ok' }
            else                                { $menuState = 'failed' }
        }

        switch ($menuState) {
            'installed' {
                Write-Pass "ติดตั้ง rich menu สำเร็จ — $($h.richmenu)"
                Write-Info "เปิดแชท LINE OA แล้วปิด/เปิดห้องแชทใหม่ 1 ครั้งจะเห็นปุ่ม (LINE แคชเมนูไว้ฝั่งเครื่อง)"
            }
            'ok' {
                Write-Pass "rich menu ติดตั้งไว้อยู่แล้ว — $($h.richmenu)"
            }
            'installing' {
                Write-Fail "ติดตั้ง rich menu ไม่เสร็จใน 60 วินาที — ยังค้างอยู่ที่ $($h.richmenu)"
                Write-Info "ดูว่าค้างตรงไหน: docker compose logs bot --tail 50"
            }
            'disabled' {
                Write-Warn "ปิดการติดตั้ง rich menu อัตโนมัติไว้ (RICHMENU_AUTO_INSTALL=false ใน .env)"
            }
            default {
                Write-Fail "ติดตั้ง rich menu ไม่สำเร็จ — $($h.richmenu)"
                Write-Info "ข้อความเต็มอยู่ใน log: docker compose logs bot --tail 50"
            }
        }

        if ($h.accept_images -eq $true) { Write-Pass "รับรูปจากผู้ใช้: เปิด" }
        else { Write-Warn "รับรูปจากผู้ใช้: ปิด (ตั้ง ACCEPT_IMAGES=true ใน .env ถ้าต้องการ)" }

        if ($h.rate_limit_per_minute -gt 0) { Write-Pass "กันสแปม: $($h.rate_limit_per_minute) ครั้ง/นาที/คน" }
        else { Write-Warn "กันสแปม: ปิดอยู่" }

        # ดูจากอาการไม่ได้ — บอทเก่าก็ตอบข้อความคล้ายกัน แค่ข้ามขั้นตอนเลือกบริษัทไปถามสาขาเลย
        # ซึ่งผลคือ ticket ไม่มีบริษัทกำกับ และจะรู้ตัวก็ต่อเมื่อเปิดหน้า /tickets มาดูทีหลัง
        if ($h.first_step -eq 'ASK_COMPANY' -or
            ($h.first_step -eq 'ASK_BRANCH' -and $h.first_selection -eq 'company')) {
            Write-Pass "บอทถามบริษัทก่อนสาขาแล้ว"
        } else {
            Write-Fail "บอทยังไม่มีขั้นตอนเลือกบริษัท (first_step = '$($h.first_step)') — ลอง: docker compose up -d --build --force-recreate bot"
        }

        # ปุ่ม "คุยกับเจ้าหน้าที่" ส่งต่อได้เฉพาะตอนเปิด Chat ใน LINE OA Manager (ทีม IT ตอบในแอป LINE OA)
        # บอทถาม LINE เองแบบ background ตอนสตาร์ท รอบแรกอาจยังเป็น unknown อยู่ 1-2 วินาที
        $chatMode = $h.chat_mode
        for ($i = 0; $i -lt 5 -and $chatMode -eq 'unknown'; $i++) {
            Start-Sleep -Seconds 2
            try { $chatMode = ((Invoke-Local 'http://127.0.0.1:8000/health').Body | ConvertFrom-Json).chat_mode } catch { }
        }
        if ($null -eq $chatMode) {
            Write-Fail "บอทยังไม่มีปุ่ม 'คุยกับเจ้าหน้าที่' (/health ไม่มี chat_mode) — ลอง: docker compose up -d --build --force-recreate bot"
        } elseif ($chatMode -eq 'chat') {
            Write-Pass "Chat ใน LINE OA เปิดอยู่ — ทีม IT ตอบในแอป LINE Official Account ได้ (บอทเงียบ $($h.handoff_hours) ชม. กับคนที่ขอคุย)"
        } elseif ($chatMode -eq 'bot') {
            Write-Warn "Chat ใน LINE OA ปิดอยู่ — ปุ่ม 'คุยกับเจ้าหน้าที่' จะตอบว่ายังไม่เปิดให้คุย (เปิดที่ OA Manager > Settings > Response settings > Chat)"
        } else {
            Write-Warn "ยังถาม LINE ไม่ได้ว่าเปิด Chat อยู่ไหม (chat_mode = '$chatMode') — ดู: docker compose logs bot --tail 50"
        }

        # ทีม IT ปิดบอทจากการ์ดในแชท (พิมพ์ "แอดมิน") — เก็บใน Redis จึงไม่หายตอน deploy
        # ปิดทั้งระบบค้างไว้ = บอทไม่ตอบใครเลย ต้องเห็นตรงนี้ ไม่งั้นจะนึกว่า deploy ทำบอทพัง
        if (-not ($h.PSObject.Properties.Name -contains 'bot_off')) {
            Write-Fail "บอทยังไม่มีคำสั่งเปิด/ปิดบอทจากแชท (/health ไม่มี bot_off) — ลอง: docker compose up -d --build --force-recreate bot"
        } elseif ($null -eq $h.bot_off) {
            Write-Warn "อ่านสถานะเปิด/ปิดบอทไม่ได้ (Redis มีปัญหา?) — ดู: docker compose logs bot --tail 50"
        } elseif ($h.bot_off -eq $true) {
            Write-Warn "ตอนนี้ปิดบอททั้งระบบอยู่ — ผู้ใช้ทุกคนได้ข้อความแจ้งแล้วบอทเงียบ (เปิดที่หน้า 'บอท LINE' หรือพิมพ์ 'แอดมิน' ในแชท)"
        } elseif ($h.users_off -gt 0) {
            Write-Info "ปิดบอทรายคนไว้ $($h.users_off) คน (ดูรายชื่อที่หน้า 'บอท LINE')"
        } else {
            Write-Pass "บอทตอบทุกคนตามปกติ (ทีม IT ปิด/เปิดได้ด้วยการพิมพ์ 'แอดมิน' ในแชท)"
        }
    } else {
        Write-Fail "บอทยังรันโค้ดเก่า (/health ไม่มีฟิลด์ richmenu) — ลองรัน: docker compose up -d --build --force-recreate bot"
    }
}

# ฝั่งแอปแอดมิน — ถามตัวแอปตรงๆ ว่ามีฟีเจอร์อะไรบ้าง
#
# ทำไมไม่เช็คด้วยการยิงหา /uploads/... แล้วดู 404: แยกไม่ออก เพราะแอปรุ่นเก่า
# (ที่ยังไม่มี route นี้) ก็ตอบ 404 เหมือนกัน แถม PowerShell ยังตัดแท็ก HTML ออกจาก
# body ของ error response ให้อัตโนมัติ ทำให้ดูจากเนื้อหาก็แยกไม่ได้อีก
# การให้แอปรายงานตัวเองผ่าน /api/health จึงเป็นวิธีเดียวที่ชี้ขาดได้จริง
$appHealth = Invoke-Local 'http://127.0.0.1:3000/api/health'
$ah = $null
if ($appHealth.Status -eq 200) { try { $ah = $appHealth.Body | ConvertFrom-Json } catch { } }

if ($null -eq $ah) {
    Write-Fail "แอปยังรันโค้ดเก่า (ไม่มี /api/health) — รูปที่ผู้ใช้แนบมาจะไม่แสดง และไม่มีแจ้งเตือนสถานะ ลอง: docker compose up -d --build --force-recreate app"
} else {
    Write-Pass "แอปรันโค้ดชุดใหม่แล้ว"

    if ($ah.features.uploads_route) {
        Write-Pass "route เสิร์ฟรูปแนบทำงาน (รูปที่อัปโหลดใหม่แสดงได้ทันที ไม่ต้อง restart)"
    }

    $cb = $ah.features.company_branches
    if ($null -eq $cb) {
        Write-Fail "แอปยังไม่มีตารางบริษัท/สาขา — ปุ่มเลือกสาขาในบอทจะว่างเปล่า ลอง: docker compose up -d --build --force-recreate app"
    } elseif ($cb.branches -gt 0) {
        Write-Pass "ตารางสาขาพร้อม: $($cb.companies) บริษัท / $($cb.branches) สาขา"
    } else {
        Write-Fail "ตารางสาขาว่างเปล่า — บอทจะไม่มีสาขาให้เลือก ตรวจว่า volume app_data เขียนได้"
    }

    if ($ah.features.line_token_configured) { Write-Pass "ตั้งค่า LINE token แล้ว" }
    else { Write-Fail "ไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN ในฝั่งแอป — แจ้งเตือนสถานะจะไม่ถูกส่ง" }

    if ($ah.features.internal_api_key_configured) { Write-Pass "ตั้งค่า INTERNAL_API_KEY แล้ว (บอทคุยกับแอปได้)" }
    else { Write-Fail "ไม่ได้ตั้ง INTERNAL_API_KEY ในฝั่งแอป — บอทจะโดนปฏิเสธ 401 ทุกครั้ง" }

    if ([string]::IsNullOrWhiteSpace($ah.features.ticket_status_notify)) {
        Write-Warn "ปิดการแจ้งเตือนสถานะไว้ (LINE_NOTIFY_STATUSES ว่าง) — ผู้แจ้งจะไม่รู้ว่าเรื่องคืบหน้า"
    } else {
        Write-Pass "แจ้งเตือนสถานะเมื่อ: $($ah.features.ticket_status_notify)"
    }

    if ($ah.storage.data_store -eq 'ok') {
        Write-Pass "ข้อมูลหลักอ่านได้ ($($ah.storage.collections.Count) ชุด)"
    } elseif ($ah.storage.data_store -eq 'empty') {
        Write-Fail "โฟลเดอร์ข้อมูลว่างเปล่า — volume app_data อาจไม่ได้ mount ข้อมูลจะหายทุกครั้งที่ build"
    } else {
        Write-Fail "อ่านโฟลเดอร์ข้อมูลไม่ได้ — ตรวจ volume app_data ใน docker-compose.yml"
    }

    if (-not $ah.storage.uploads_writable) {
        Write-Fail "เขียนโฟลเดอร์ uploads ไม่ได้ — รูปที่ผู้ใช้ส่งมาจะบันทึกไม่สำเร็จ"
    }

    # คลังไฟล์ (/files) อยู่บน volume "drive" แยกจาก app_data — ถ้าเขียนไม่ได้ (EACCES) หน้าเว็บยังเปิดได้ปกติ
    # แต่อัปโหลดทุกไฟล์จะล้ม จึงต้องตรวจตรงนี้แทนการรอให้ผู้ใช้เจอเอง
    if ($null -eq $ah.storage.drive_writable) {
        Write-Warn "แอปยังไม่มีคลังไฟล์ (/files) — โค้ดเก่ากว่ารอบนี้ ถ้าเพิ่งแก้มา ให้ build ใหม่อีกครั้ง"
    } elseif ($ah.storage.drive_writable) {
        Write-Pass "คลังไฟล์ (/files) เขียนได้ · เพดานรวม $($ah.storage.drive_quota_gb) GB"
    } else {
        Write-Fail "เขียนโฟลเดอร์คลังไฟล์ไม่ได้ — อัปโหลดใน /files จะล้มทุกไฟล์ ตรวจ volume drive ใน docker-compose.yml"
    }

    # ชุดกัน Inspect ไม่ทิ้งร่องรอยใน DOM เวลาไม่ทำงาน ดูจากหน้าเว็บจึงไม่มีทางรู้
    # ต้องถาม /api/health เท่านั้น (นี่คือเหตุผลที่เพิ่มก้อน security เข้าไปใน endpoint นั้น)
    if ($null -ne $ah.security) {
        if ($ah.security.block_devtools) {
            $menu = if ($ah.security.block_context_menu) { " + คลิกขวา" } else { "" }
            Write-Pass "กันการเปิด Inspect บนหน้าแอดมินแล้ว (F12/Ctrl+Shift+I/Ctrl+U$menu)"
        } else {
            Write-Warn "ปิดการกัน Inspect ไว้ (BLOCK_DEVTOOLS=false)"
        }
        if ($ah.security.auth_enabled) {
            Write-Pass "บังคับล็อกอินอยู่ — นี่คือชั้นป้องกันจริงชั้นเดียวที่มี"
        }
    } else {
        Write-Warn "แอปยังไม่มีชุดกัน Inspect (โค้ดเก่ากว่ารอบนี้) — ถ้าเพิ่งแก้มา ให้ build ใหม่อีกครั้ง"
    }
}

# ---- 3.1 security headers ----
# ต่างจากการกัน F12 ตรงที่ข้อนี้ "ได้ผลจริง 100%" เพราะเป็นคำสั่งจากเซิร์ฟเวอร์ตรงๆ
# เบราว์เซอร์ปฏิเสธไม่ได้ และ curl/สคริปต์ก็เห็นเหมือนกัน จึงตรวจแยกจาก /api/health
$root = Invoke-Local 'http://127.0.0.1:3000/'
if ($root.Status -eq 200 -and $root.Headers) {
    $missing = @()
    foreach ($k in @('X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'X-Robots-Tag')) {
        if (-not $root.Headers.ContainsKey($k)) { $missing += $k }
    }
    if ($missing.Count -eq 0) {
        Write-Pass "security headers ครบ (กัน iframe, กันเดาชนิดไฟล์, ไม่ให้ Google เก็บเข้าดัชนี)"
    } else {
        Write-Warn "ยังไม่มี security headers: $($missing -join ', ') — ต้อง build ใหม่ (ค่าอยู่ใน next.config.ts)"
    }
    if ($root.Headers.ContainsKey('X-Powered-By')) {
        Write-Warn "ยังส่งหัว X-Powered-By อยู่ (บอกเวอร์ชัน Next.js ให้คนสแกนช่องโหว่) — ต้อง build ใหม่"
    }
}

# ---- 4. ทางเข้าจากอินเทอร์เน็ต ----
# ตั้งแต่ 7 ต.ค. 2026 ใช้ Cloudflare Tunnel (service "tunnel" ใน docker-compose.yml) แทน Tailscale Funnel
# ตรวจ 3 ชั้น: tunnel ต่อ Cloudflare ติด → คนนอกเปิดเว็บ/ถึงบอทได้จริง → LINE ยิงเข้ามาได้จริง
# ยิงจากเครื่องนี้พิสูจน์ได้จริง เพราะชื่อนี้ resolve ไป Cloudflare แล้ววิ่งกลับเข้ามาทาง tunnel
# (ต่างจาก *.ts.net ที่ MagicDNS ลัดเข้าเครื่องตรงๆ จนเคย "ผ่าน" ทั้งที่คนนอกเข้าไม่ได้)
# -Funnel = ทางสำรองแบบเดิม — ตรรกะทั้งหมดของ Funnel ยังอยู่ที่ enable-funnel.ps1 ที่เดียว

if ($Funnel) {
    Write-Step "4. ทางเข้าจากอินเทอร์เน็ต (Tailscale Funnel — ทางสำรอง)"
    $funnelArgs = @{}
    if ($InstallAutostart) { $funnelArgs.InstallAutostart = $true }
    # เพิ่ง recreate container — ให้รอ app/bot ขึ้นก่อนตรวจ ไม่งั้นได้ "ไม่ผ่าน" ปลอม
    & (Join-Path $PSScriptRoot 'enable-funnel.ps1') -WaitSeconds 120 @funnelArgs
    switch ($LASTEXITCODE) {
        0       { Write-Pass "คนนอกเข้าเว็บแอดมินได้ และ LINE ยิง webhook เข้ามาได้จริง" }
        2       { Write-Warn "ตั้ง Funnel แล้ว แต่ยืนยันจากข้างนอกไม่ได้ในรอบนี้ — ดับเบิลคลิก enable-funnel.bat ซ้ำภายหลัง" }
        default { Write-Fail "คนนอกยังเข้าไม่ได้ — ดูรายละเอียดข้างบน หรือรัน .\scripts\enable-funnel.ps1 -Force" }
    }
} elseif (-not $SkipPublic) {
    Write-Step "4. ทางเข้าจากอินเทอร์เน็ต (Cloudflare Tunnel → https://$publicHost)"
    if (-not $tunnelToken) {
        Write-Fail "ยังไม่ได้ใส่ token ของ Cloudflare Tunnel — ดับเบิลคลิก use-cloudflare.bat (ตอนนี้คนนอกและ LINE เข้าไม่ได้)"
    } else {
        $tunnelReady = $false
        $deadline = (Get-Date).AddSeconds(60)
        while (-not $tunnelReady -and (Get-Date) -lt $deadline) {
            if (Test-TunnelReady) { $tunnelReady = $true } else { Start-Sleep -Seconds 3 }
        }
        if (-not $tunnelReady) {
            Write-Fail "Cloudflare Tunnel ต่อไม่ติด — ดู log: docker compose logs tunnel --tail 30 (เจอ Unauthorized = token ผิด → use-cloudflare.bat -NewToken)"
        } else {
            Write-Pass "Cloudflare Tunnel ต่อติดแล้ว"
            $pub = Invoke-Local "https://$publicHost/api/health" 20
            if ($pub.Status -eq 200 -and $pub.Body -match '"ok"\s*:\s*true') {
                Write-Pass "คนนอกเปิดเว็บแอดมินได้: https://$publicHost"
            } else {
                Write-Fail "เปิด https://$publicHost จากข้างนอกไม่ได้ (สถานะ $($pub.Status)) — ตรวจ Routes ของ tunnel IT-Support-Admin ในหน้า Cloudflare"
            }
            $hook = Invoke-Local "https://$publicHost/webhook" 20
            if ($hook.Status -eq 200 -and $hook.Body -match 'line-bot-python') {
                Write-Pass "/webhook ถึงบอท LINE"
            } else {
                Write-Fail "https://$publicHost/webhook ไม่ถึงบอท (สถานะ $($hook.Status)) — route ^/webhook ต้องอยู่บนสุดและชี้ http://bot:8000"
            }
            Test-LineWebhookUrl "https://$publicHost/webhook"
        }
    }
}

# ---- สรุป ----

Write-Host ""
Write-Host "============================================================" -ForegroundColor White

if ($script:Failures.Count -eq 0) {
    Write-Host "  พร้อมใช้งานแล้ว" -ForegroundColor Green
    if (-not $Funnel) { Write-Host "  เว็บแอดมิน (เปิดได้ทุกที่): https://$publicHost" -ForegroundColor White }
    Write-Host ""
    Write-Host "  ทดสอบด้วยตัวเองจากมือถือ:" -ForegroundColor White
    Write-Host "    1. เพิ่ม LINE OA เป็นเพื่อน (QR อยู่ที่ qr\line-oa-qr-logo.png)" -ForegroundColor Gray
    Write-Host "    2. ต้องเห็น 2 ปุ่มแถวเดียวด้านล่าง: แจ้งซ่อม · ขอใช้บริการ IT (ถ้ายังเป็น 4 ปุ่มเดิม ปิด/เปิดห้องแชทใหม่ 1 ครั้ง)" -ForegroundColor Gray
    Write-Host "    3. ส่งรูปหน้าจอเข้าไป -> บอทต้องตอบ 'ได้รับรูปแล้วครับ'" -ForegroundColor Gray
    Write-Host "    4. กด 'แจ้งซ่อม' บนเมนู -> ต้องขึ้นปุ่มบริษัท (Montipa / Motta / ส่วนกลาง) ก่อนถามสาขา" -ForegroundColor Gray
    Write-Host "    5. เลือก Motta -> ต้องขึ้นปุ่มทีม แล้วเลือกทีมจึงเห็นสาขาของทีมนั้น" -ForegroundColor Gray
    Write-Host "    6. แจ้งเรื่องจนจบ แล้วเปิด http://127.0.0.1:3000/tickets ดูว่ารูปขึ้นและคอลัมน์บริษัทถูกต้อง" -ForegroundColor Gray
    Write-Host "    7. กดเปลี่ยนสถานะเป็น 'แก้ไขแล้ว' -> ต้องได้ข้อความแจ้งเตือนกลับเข้า LINE" -ForegroundColor Gray
    Write-Host "    8. กด 'คุยกับเจ้าหน้าที่' -> บอทตอบ 'ส่งต่อให้ทีม IT แล้ว' แล้วเงียบ / แชทนั้นขึ้นในแอป LINE Official Account ให้ทีมตอบ" -ForegroundColor Gray
    Write-Host "" -ForegroundColor Gray
    Write-Host "  แก้รายชื่อสาขาได้ที่ http://127.0.0.1:3000/branches (เพิ่ม/ปิดสาขาแล้วปุ่มในบอทเปลี่ยนทันที)" -ForegroundColor Gray
} else {
    Write-Host "  ยังไม่ผ่าน $($script:Failures.Count) ข้อ" -ForegroundColor Red
    Write-Host ""
    foreach ($f in $script:Failures) { Write-Host "    - $f" -ForegroundColor Red }
}

if ($script:Warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "  เรื่องที่ควรดู $($script:Warnings.Count) ข้อ:" -ForegroundColor Yellow
    foreach ($w in $script:Warnings) { Write-Host "    - $w" -ForegroundColor Yellow }
}

Write-Host "============================================================" -ForegroundColor White
Write-Host ""
