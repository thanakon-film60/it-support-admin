#Requires -Version 5.1
<#
    ติดตั้ง/อัปเดตระบบ IT Support + LINE OA แล้วตรวจผลให้เสร็จในคำสั่งเดียว

    ไม่ต้องรันไฟล์นี้ตรงๆ — ดับเบิลคลิก deploy.bat ที่โฟลเดอร์หลักของโปรเจกต์แทน

    สคริปต์นี้ทำ 3 อย่าง:
      1. build + start container (app, bot)
      2. ตรวจว่าของใหม่ทำงานจริงทุกจุด ไม่ใช่แค่ "คำสั่งไม่ error"
      3. ตั้ง Tailscale Funnel ให้ LINE ยิง webhook เข้ามาได้

    ออกแบบให้รันซ้ำได้เสมอ ไม่มีขั้นตอนไหนที่รันสองรอบแล้วพัง
#>

param(
    # ข้ามการตั้ง Tailscale Funnel (ใช้ตอนที่จัดการ ingress เองด้วยวิธีอื่น)
    [switch]$SkipTailscale,
    # ตั้งให้ Funnel ทำงานเองทุกครั้งที่ล็อกอินเข้า Windows
    [switch]$InstallAutostart
)

# ทำให้ข้อความไทยในหน้าต่างนี้อ่านออก (encoding + ฟอนต์) — ต้องทำก่อนเขียนอะไรออกจอ
. (Join-Path $PSScriptRoot 'console-utf8.ps1')
Initialize-ThaiConsole

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Windows PowerShell 5.1 บนบางเครื่องยังตั้ง TLS 1.0 เป็นค่าตั้งต้น ซึ่งเซิร์ฟเวอร์สมัยใหม่
# ปฏิเสธไปแล้ว ทำให้การเช็คโดเมน https (Tailscale Funnel) ล้มเหลวทั้งที่ระบบปกติดี
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
function Invoke-Local {
    param([string]$Url, [int]$TimeoutSec = 10)
    try {
        $r = Invoke-WebRequest -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop
        return @{ Status = [int]$r.StatusCode; Body = $r.Content; Headers = $r.Headers }
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
                    if ($stream) { $body = (New-Object System.IO.StreamReader($stream)).ReadToEnd() }
                } catch { }
            }

            if ($status -gt 0) { return @{ Status = $status; Body = $body } }
        }
        return @{ Status = 0; Body = $_.Exception.Message }
    }
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
Write-Info "กำลังรัน: docker compose up -d --build app bot"

docker compose up -d --build app bot
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

$health = Invoke-Local 'http://127.0.0.1:8000/health'
$h = $null
try { $h = $health.Body | ConvertFrom-Json } catch { }

if ($null -eq $h) {
    Write-Fail "อ่านผลจาก /health ไม่ได้"
} else {
    if ($null -ne $h.richmenu) {
        Write-Pass "บอทรันโค้ดชุดใหม่แล้ว"

        if ($h.richmenu -like 'installed*') {
            Write-Pass "ติดตั้ง rich menu สำเร็จ — $($h.richmenu)"
            Write-Info "เปิดแชท LINE OA แล้วปิด/เปิดห้องแชทใหม่ 1 ครั้งจะเห็นปุ่ม (LINE แคชเมนูไว้ฝั่งเครื่อง)"
        } elseif ($h.richmenu -like 'ok*') {
            Write-Pass "rich menu ติดตั้งไว้อยู่แล้ว — $($h.richmenu)"
        } else {
            Write-Fail "ติดตั้ง rich menu ไม่สำเร็จ — $($h.richmenu)"
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

if (-not $SkipTailscale) {
    Write-Step "4. ทางเข้าจากอินเทอร์เน็ต (Tailscale Funnel)"

    # เหตุผลเดียวกับใน backup.ps1: tailscale เขียนข้อความปกติลง stderr ได้
    # ถ้าปล่อยให้ 2>&1 เจอ $ErrorActionPreference = 'Stop' สคริปต์จะตายทั้งที่ Funnel ทำงานอยู่
    $ErrorActionPreference = 'Continue'

    $tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if (-not $tailscale) {
        $guess = 'C:\Program Files\Tailscale\tailscale.exe'
        if (Test-Path $guess) { $tailscale = $guess } else { $tailscale = $null }
    } else {
        $tailscale = $tailscale.Source
    }

    if (-not $tailscale) {
        Write-Warn "ไม่พบ tailscale.exe — ข้ามขั้นนี้ ถ้ายังไม่มีทางเข้าอื่น LINE จะยิง webhook เข้ามาไม่ได้"
    } else {
        $status = & $tailscale funnel status 2>&1 | Out-String

        # ต้องเป็น funnel เท่านั้น ห้ามเป็น serve — สองคำสั่งเขียนทับ config ตัวเดียวกัน
        # การเผลอรัน serve จะสลับเป็น "tailnet only" เงียบๆ แล้ว webhook ตายโดยไม่มี error
        if ($status -match 'Funnel on') {
            Write-Pass "Funnel เปิดอยู่แล้ว"
        } else {
            Write-Info "Funnel ยังไม่เปิด — กำลังตั้งให้"
            & $tailscale funnel --bg 3000 2>&1 | Out-Null
            & $tailscale funnel --bg --set-path=/webhook 8000 2>&1 | Out-Null
            Start-Sleep -Seconds 3
            $status = & $tailscale funnel status 2>&1 | Out-String
            if ($status -match 'Funnel on') { Write-Pass "ตั้ง Funnel เรียบร้อย" }
            else { Write-Fail "ตั้ง Funnel ไม่สำเร็จ — ลองรันเองดู: tailscale funnel --bg 3000" }
        }

        if ($status -match 'tailnet only') {
            Write-Fail "Funnel เป็นโหมด 'tailnet only' — คนนอกวงเข้าไม่ได้ และ LINE จะยิง webhook ไม่เข้า (มักเกิดจากเผลอรัน tailscale serve)"
        }

        # ยิงจากอินเทอร์เน็ตจริงเข้ามาที่ webhook เพื่อพิสูจน์ว่าทางเข้าใช้ได้
        $m = [regex]::Match($status, 'https://([a-z0-9\-\.]+\.ts\.net)')
        if ($m.Success) {
            $host2 = $m.Groups[1].Value
            Write-Info "โดเมนสาธารณะ: $host2"
            $pub = Invoke-Local "https://$host2/webhook" 20
            if ($pub.Status -eq 200 -and $pub.Body -match 'line-bot-python') {
                Write-Pass "LINE ยิง webhook เข้ามาได้จริง (ทดสอบจากภายนอกแล้ว)"
            } else {
                Write-Warn "เรียก https://$host2/webhook ได้ status $($pub.Status) — Funnel อาจยังไม่พร้อม รออีก 1-2 นาทีแล้วลองใหม่"
            }
        }
    }
}

# ---- 5. ตั้งให้ทำงานเองหลังรีบูต ----

if ($InstallAutostart) {
    Write-Step "5. ตั้งให้ Funnel ทำงานเองทุกครั้งที่ล็อกอิน Windows"
    $startup = [Environment]::GetFolderPath('Startup')
    $src = Join-Path $PSScriptRoot 'startup-funnel.bat'
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $startup 'it-support-funnel.bat') -Force
        Write-Pass "คัดลอกไปที่ $startup แล้ว — หลังรีบูตและล็อกอิน Funnel จะเปิดเอง"
    } else {
        Write-Warn "ไม่พบ $src"
    }
}

# ---- สรุป ----

Write-Host ""
Write-Host "============================================================" -ForegroundColor White

if ($script:Failures.Count -eq 0) {
    Write-Host "  พร้อมใช้งานแล้ว" -ForegroundColor Green
    Write-Host ""
    Write-Host "  ทดสอบด้วยตัวเองจากมือถือ:" -ForegroundColor White
    Write-Host "    1. เพิ่ม LINE OA เป็นเพื่อน (QR อยู่ที่ qr\line-oa-qr-logo.png)" -ForegroundColor Gray
    Write-Host "    2. ต้องเห็นปุ่ม 6 ปุ่มด้านล่าง (ถ้าไม่เห็น ปิด/เปิดห้องแชทใหม่ 1 ครั้ง)" -ForegroundColor Gray
    Write-Host "    3. ส่งรูปหน้าจอเข้าไป -> บอทต้องตอบ 'ได้รับรูปแล้วครับ'" -ForegroundColor Gray
    Write-Host "    4. กด 'แจ้งเรื่องใหม่' -> ต้องขึ้นปุ่มบริษัท (Montipa / Motta / ส่วนกลาง) ก่อนถามสาขา" -ForegroundColor Gray
    Write-Host "    5. เลือก Motta -> ต้องขึ้นปุ่มทีม แล้วเลือกทีมจึงเห็นสาขาของทีมนั้น" -ForegroundColor Gray
    Write-Host "    6. แจ้งเรื่องจนจบ แล้วเปิด http://127.0.0.1:3000/tickets ดูว่ารูปขึ้นและคอลัมน์บริษัทถูกต้อง" -ForegroundColor Gray
    Write-Host "    7. กดเปลี่ยนสถานะเป็น 'แก้ไขแล้ว' -> ต้องได้ข้อความแจ้งเตือนกลับเข้า LINE" -ForegroundColor Gray
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
