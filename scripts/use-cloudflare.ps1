#Requires -Version 5.1
<#
    ย้ายทางเข้าจากอินเทอร์เน็ตมาใช้ Cloudflare Tunnel — https://it.thanakronpart-time.com
    แทน Tailscale Funnel (ที่เคยค้างที่ control plane จนบอทเงียบ — PROJECT.md §7)

    ดับเบิลคลิก use-cloudflare.bat ที่โฟลเดอร์หลักของโปรเจกต์ — รันซ้ำได้เสมอ ข้ามขั้นที่เสร็จแล้ว:
      1. รับ token ของ tunnel (วางแล้วไม่ขึ้นบนจอ) เก็บลง .env เป็น CLOUDFLARE_TUNNEL_TOKEN
      2. สตาร์ท container "tunnel" (cloudflared) แล้วรอจนต่อ Cloudflare ติด
      3. ตรวจจากข้างนอกจริง: https://<ชื่อเว็บ>/api/health ต้องเป็นแอปแอดมิน · /webhook ต้องเป็นบอท
      4. ให้ LINE ยิงทดสอบ "ลิงก์ใหม่" ก่อน แล้วค่อยเปลี่ยน Webhook URL — ทดสอบไม่ผ่าน = ไม่เปลี่ยน
         บอทใช้ลิงก์เดิมต่อ จึงไม่มีช่วงที่บอทเงียบระหว่างย้าย
      5. ปิด Tailscale Funnel + เอาตัวเปิด Funnel ออกจาก Startup — ทำหลังข้อ 4 ผ่านเท่านั้น

    token เอามาจาก: dash.cloudflare.com > Networking > Tunnels > IT-Support-Admin > Add a replica
    เลือก Docker แล้วกดปุ่มคัดลอกคำสั่ง — วางทั้งบรรทัดได้เลย สคริปต์ดึงเฉพาะ token ออกมาเอง
    token คือกุญแจของ tunnel ใครได้ไปก็ต่อเป็นเว็บนี้ได้ สคริปต์จึงไม่พิมพ์ออกจอและไม่เขียนลง log
    (หลุดเมื่อไหร่ ให้กด Rotate token ในหน้า Cloudflare แล้วรันไฟล์นี้ใหม่พร้อม -NewToken)

    exit code: 0 = ย้ายเสร็จครบ · 1 = ล้ม (ดูข้อความ) · 2 = ต่อ Cloudflare ติด แต่ยังเข้าจากข้างนอกไม่ได้
#>

param(
    # ชื่อเว็บใหม่ — ต้องตรงกับ Routes (Published application) ของ tunnel ในหน้า Cloudflare
    [string]$PublicHost = 'it.thanakronpart-time.com',
    # tunnel ของระบบนี้ — บัญชี Cloudflare เดียวกันมี tunnel ของงานอื่นอีกหลายตัว กันวาง token ผิดตัว
    [string]$TunnelId = 'aa9f3ecb-a4a0-49be-9677-cff5a845282b',
    # ใส่ token ใหม่ แม้ใน .env มีอยู่แล้ว (เช่น หลังกด Rotate token)
    [switch]$NewToken,
    # รอให้เข้าจากข้างนอกได้นานสุดกี่วินาที (ชื่อใหม่ต้องรอ DNS สักพัก)
    [int]$WaitSeconds = 300,
    # เชื่อม tunnel แล้วตรวจอย่างเดียว ไม่แตะ LINE และ Funnel
    [switch]$TunnelOnly
)

. (Join-Path $PSScriptRoot 'console-utf8.ps1')
Initialize-ThaiConsole

# docker/tailscale เขียนข้อความปกติลง stderr — ถ้าใช้ 'Stop' สคริปต์จะตายทั้งที่ทุกอย่างปกติ
# ทุกจุดที่ล้มได้จึงเช็คผลเองตรงๆ (แบบเดียวกับ enable-funnel.ps1)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $RepoRoot '.env'
$LineApi = 'https://api.line.me/v2/bot/channel/webhook'

# ---------------------------------------------------------------- แสดงผล

$script:Failed = $false
function Write-Step { param($m) Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Pass { param($m) Write-Host "  [ผ่าน] $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "  [เตือน] $m" -ForegroundColor Yellow }
function Write-Fail { param($m) Write-Host "  [ไม่ผ่าน] $m" -ForegroundColor Red; $script:Failed = $true }
function Write-Info { param($m) Write-Host "  $m" -ForegroundColor Gray }

# ---------------------------------------------------------------- .env

function Read-DotEnv {
    param([string]$Name)
    if (-not (Test-Path $EnvFile)) { return $null }
    $line = Get-Content $EnvFile -Encoding UTF8 | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -Last 1
    if (-not $line) { return $null }
    return (($line -replace "^\s*$Name\s*=\s*", '') -replace '^["'']|["'']$', '').Trim()
}

# แก้/เพิ่มค่าเดียวใน .env โดยไม่แตะบรรทัดอื่น — ไฟล์นี้มีความลับทุกตัวของระบบ
# เขียนเป็น UTF-8 ไม่มี BOM: BOM ที่หัวไฟล์ทำให้ docker compose อ่านชื่อตัวแปรบรรทัดแรกเพี้ยน
function Set-DotEnv {
    param([string]$Name, [string]$Value)
    $raw = ''
    if (Test-Path $EnvFile) { $raw = [IO.File]::ReadAllText($EnvFile) }
    $nl = "`n"
    if ($raw -match "`r`n") { $nl = "`r`n" }
    $lines = New-Object System.Collections.Generic.List[string]
    if ($raw.Length -gt 0) { $lines.AddRange([string[]]($raw -split "\r?\n")) }
    while ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq '') { $lines.RemoveAt($lines.Count - 1) }
    $pattern = '^\s*' + [regex]::Escape($Name) + '\s*='
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $pattern) { $lines[$i] = "$Name=$Value"; $found = $true }
    }
    if (-not $found) { $lines.Add("$Name=$Value") }
    [IO.File]::WriteAllText($EnvFile, (($lines -join $nl) + $nl), (New-Object Text.UTF8Encoding($false)))
}

# ---------------------------------------------------------------- token

# ดึง token ออกจากสิ่งที่วาง — ส่วนใหญ่คนกดคัดลอกมาทั้งคำสั่ง
# (docker run ... --token eyJ... / cloudflared.exe service install eyJ...)
function Get-TokenFromText {
    param([string]$Text)
    if (-not $Text) { return $null }
    $found = [regex]::Matches($Text, 'eyJ[A-Za-z0-9_\-+/=]{40,}')
    if ($found.Count -eq 0) { return $null }
    return ($found | Sort-Object { $_.Value.Length } -Descending | Select-Object -First 1).Value
}

# token คือ base64 ของ JSON { a: บัญชี, t: tunnel id, s: รหัสลับ } — แกะดูได้ว่าเป็นของ tunnel ไหน
function Get-TokenTunnelId {
    param([string]$Token)
    if (-not $Token) { return $null }
    try {
        $b64 = $Token.Replace('-', '+').Replace('_', '/')
        switch ($b64.Length % 4) { 2 { $b64 += '==' } 3 { $b64 += '=' } }
        $obj = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64)) | ConvertFrom-Json
        if ($obj.a -and $obj.t -and $obj.s) { return [string]$obj.t }
    } catch { }
    return $null
}

function Read-SecretLine {
    param([string]$Prompt)
    $sec = Read-Host -AsSecureString $Prompt
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# ---------------------------------------------------------------- เครือข่าย

# คืน @{ Status; Body } เสมอ ไม่ throw — Status 0 = ต่อไม่ได้เลย
# body อ่านเป็น UTF-8 เอง เพราะ PowerShell 5.1 เดา charset ผิดเมื่อ header ไม่บอก (ดู deploy.ps1)
function Invoke-Http {
    param([string]$Url, [int]$TimeoutSec = 15)
    try {
        $r = Invoke-WebRequest -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop
        $body = $r.Content
        try { $body = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) } catch { }
        return @{ Status = [int]$r.StatusCode; Body = [string]$body }
    } catch {
        $status = 0
        try { $status = [int]$_.Exception.Response.StatusCode } catch { }
        return @{ Status = $status; Body = [string]$_.Exception.Message }
    }
}

function Get-LineWebhook {
    param([hashtable]$Headers)
    try { return Invoke-RestMethod -Uri "$LineApi/endpoint" -Headers $Headers -TimeoutSec 15 -ErrorAction Stop }
    catch { return $null }
}

# ให้เซิร์ฟเวอร์ LINE ยิง webhook ทดสอบไปที่ URL ที่ระบุ — ไม่ต้องตั้ง URL นั้นก่อน และไม่กินโควตา push
function Test-LineWebhook {
    param([hashtable]$Headers, [string]$Url)
    try {
        return Invoke-RestMethod -Uri "$LineApi/test" -Method Post -Headers $Headers -ContentType 'application/json' `
            -Body (@{ endpoint = $Url } | ConvertTo-Json) -TimeoutSec 30 -ErrorAction Stop
    } catch {
        return [pscustomobject]@{ success = $false; statusCode = 0; reason = 'เรียก LINE ไม่ได้'; detail = $_.Exception.Message }
    }
}

# tunnel ต่อ Cloudflare ติดหรือยัง — cloudflared ตอบ 200 ที่ /ready (TUNNEL_METRICS ใน docker-compose.yml)
# ถามจากในเครือข่ายของ compose ผ่าน container app (มี node) แทนการเปิดพอร์ตออกมาที่เครื่อง:
# cloudflared ของงานอื่นที่ติดตั้งบนเครื่องนี้จองพอร์ต 20241-20245 ไว้แล้ว (เจอจริง 8 ต.ค. 2026)
function Test-TunnelReady {
    $js = "fetch('http://tunnel:20241/ready').then(r=>process.exit(r.status==200?0:1),()=>process.exit(1))"
    try {
        docker compose exec -T app node -e $js 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}

# ---------------------------------------------------------------- Tailscale (ไว้ปิด Funnel เดิม)

function Find-Tailscale {
    $c = Get-Command tailscale.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return $c.Source }
    $guess = 'C:\Program Files\Tailscale\tailscale.exe'
    if (Test-Path $guess) { return $guess }
    return $null
}

# เรียก tailscale แบบมี timeout — บางสถานะของ tailnet ทำให้คำสั่งรอไม่มีวันจบ (enable-funnel.ps1 ข้อ 4)
function Invoke-Ts {
    param([string]$Exe, [string[]]$TsArgs, [int]$TimeoutSec = 30)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.Arguments = ($TsArgs -join ' ')
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    try { $p = [System.Diagnostics.Process]::Start($psi) }
    catch { return @{ Code = -1; Out = $_.Exception.Message } }
    $o = $p.StandardOutput.ReadToEndAsync()
    $e = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        try { $p.Kill() } catch { }
        return @{ Code = -1; Out = 'หมดเวลารอ tailscale' }
    }
    $p.WaitForExit()
    return @{ Code = $p.ExitCode; Out = ($o.Result + "`n" + $e.Result).Trim() }
}

# ================================================================ เริ่มทำงาน

Set-Location $RepoRoot
Write-Host ""
Write-Host "  ย้ายทางเข้าจากอินเทอร์เน็ตไปที่ Cloudflare Tunnel — https://$PublicHost" -ForegroundColor White
Write-Host "  เวลา: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor DarkGray

# ---- 0. เครื่องมือ ----
Write-Step '0. ตรวจเครื่องมือ'
docker version --format '{{.Server.Version}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Fail 'ต่อ Docker ไม่ได้ — เปิด Docker Desktop แล้วรอจนไอคอนขึ้นเขียว จากนั้นรันไฟล์นี้ใหม่'
    exit 1
}
if (-not (Test-Path $EnvFile)) { Write-Fail "ไม่พบไฟล์ .env ที่ $RepoRoot"; exit 1 }
Write-Pass 'Docker ทำงานอยู่ · พบไฟล์ .env'

# ---- 1. token ----
Write-Step '1. token ของ tunnel'
$token = Read-DotEnv 'CLOUDFLARE_TUNNEL_TOKEN'
if ($token -and -not $NewToken) {
    $tid = Get-TokenTunnelId $token
    if ($tid -ne $TunnelId) {
        Write-Fail "token ใน .env ไม่ใช่ของ tunnel IT-Support-Admin (ได้ '$tid') — รันใหม่พร้อม -NewToken"
        exit 1
    }
    Write-Pass 'มี token ใน .env แล้ว (ใส่ใหม่ได้ด้วย -NewToken)'
} else {
    Write-Info 'เปิด dash.cloudflare.com > Networking > Tunnels > IT-Support-Admin > Add a replica'
    Write-Info 'เลือก Docker แล้วกดปุ่มคัดลอกคำสั่ง จากนั้นกลับมาวางที่นี่ (คลิกขวา หรือ Ctrl+V) แล้วกด Enter'
    Write-Info 'ตัวอักษรจะไม่ขึ้นบนจอ — เป็นเรื่องปกติ'
    $token = $null
    for ($try = 1; $try -le 3 -and -not $token; $try++) {
        $candidate = Get-TokenFromText (Read-SecretLine '  วาง token หรือทั้งบรรทัดคำสั่ง')
        if (-not $candidate) { Write-Warn 'ไม่เจอ token ในสิ่งที่วาง (token ขึ้นต้นด้วย eyJ) — ลองใหม่'; continue }
        $tid = Get-TokenTunnelId $candidate
        if (-not $tid) { Write-Warn 'token อ่านไม่ออก — คัดลอกมาไม่ครบหรือเปล่า? ลองใหม่'; continue }
        if ($tid -ne $TunnelId) { Write-Warn "นี่เป็น token ของ tunnel อื่น ($tid) ไม่ใช่ IT-Support-Admin — ลองใหม่"; continue }
        $token = $candidate
    }
    if (-not $token) { Write-Fail 'ยังไม่ได้ token ที่ถูกต้อง — รันไฟล์นี้ใหม่อีกครั้ง'; exit 1 }
    Set-DotEnv 'CLOUDFLARE_TUNNEL_TOKEN' $token
    Write-Pass 'บันทึก token ลง .env แล้ว (ไม่แสดงบนจอ)'
}
if (-not (Read-DotEnv 'PUBLIC_HOST')) { Set-DotEnv 'PUBLIC_HOST' $PublicHost }

# ---- 2. สตาร์ท tunnel ----
Write-Step '2. สตาร์ท Cloudflare Tunnel'
# token เปลี่ยน = env ของ container เปลี่ยน → compose สร้าง container ใหม่ให้เอง
# --no-deps: ไม่แตะ app/bot ที่รันอยู่ — ถ้า docker-compose.yml ของ app เปลี่ยนตั้งแต่ deploy รอบก่อน
# compose จะสร้าง app ใหม่จาก image เก่าให้เงียบๆ (เว็บดับไปช่วงหนึ่งโดยไม่จำเป็น) ให้ deploy.bat ทำหน้าที่นั้น
docker compose up -d --no-deps tunnel
if ($LASTEXITCODE -ne 0) { Write-Fail 'สตาร์ท container "tunnel" ไม่สำเร็จ — อ่าน error ด้านบน'; exit 1 }
$ready = $false
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
    if (Test-TunnelReady) { $ready = $true; break }
    Start-Sleep -Seconds 3
}
if (-not $ready) {
    Write-Fail 'tunnel ยังต่อ Cloudflare ไม่ติดใน 60 วินาที'
    Write-Info 'ดูสาเหตุ: docker compose logs tunnel --tail 30'
    Write-Info 'ถ้า container app ไม่ได้รันอยู่ ให้รัน deploy.bat ก่อน (ใช้ app เป็นตัวถามสถานะ tunnel)'
    Write-Info 'ถ้าเจอ "Unauthorized" หรือ "Invalid tunnel secret" = token ผิด → use-cloudflare.bat -NewToken'
    exit 1
}
Write-Pass 'ต่อ Cloudflare ติดแล้ว'

# ---- 3. ตรวจจากข้างนอก ----
Write-Step "3. ตรวจจากข้างนอก: https://$PublicHost"
# ยิงจากเครื่องนี้ก็พิสูจน์ได้จริง — ชื่อนี้ resolve ไปที่ Cloudflare แล้ววิ่งกลับเข้ามาทาง tunnel
# (ต่างจาก *.ts.net ที่ MagicDNS ลัดเข้าเครื่องตรงๆ จน "ผ่าน" ทั้งที่คนนอกเข้าไม่ได้)
$webOk = $false
$botOk = $false
$web = @{ Status = 0 }
$bot = @{ Status = 0 }
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$nextNote = (Get-Date).AddSeconds(20)
while (-not ($webOk -and $botOk)) {
    if (-not $webOk) {
        $web = Invoke-Http "https://$PublicHost/api/health" 20
        if ($web.Status -eq 200 -and $web.Body -match '"ok"\s*:\s*true') {
            $webOk = $true
            Write-Pass "เว็บแอดมินเปิดได้จากข้างนอก"
        }
    }
    if (-not $botOk) {
        $bot = Invoke-Http "https://$PublicHost/webhook" 20
        if ($bot.Status -eq 200 -and $bot.Body -match 'line-bot-python') {
            $botOk = $true
            Write-Pass "/webhook ถึงบอท LINE"
        }
    }
    if ($webOk -and $botOk) { break }
    if ((Get-Date) -gt $deadline) { break }
    if ((Get-Date) -gt $nextNote) {
        Write-Info "ยังเข้าไม่ได้ (เว็บ: $($web.Status) · บอท: $($bot.Status)) — รอ DNS ของชื่อใหม่อยู่ ไม่ต้องปิดหน้าต่าง..."
        $nextNote = (Get-Date).AddSeconds(30)
    }
    Start-Sleep -Seconds 5
}
if (-not ($webOk -and $botOk)) {
    if (-not $webOk) { Write-Fail "https://$PublicHost/api/health ยังไม่ตอบเป็นแอปแอดมิน (สถานะล่าสุด $($web.Status))" }
    if (-not $botOk) { Write-Fail "https://$PublicHost/webhook ยังไม่ถึงบอท (สถานะล่าสุด $($bot.Status))" }
    Write-Info 'ตรวจ Routes ของ tunnel ในหน้า Cloudflare (ลำดับสำคัญ — ตัวบนชนะ):'
    Write-Info "  1. $PublicHost  path ^/webhook  -> http://bot:8000"
    Write-Info "  2. $PublicHost                  -> http://app:3000"
    Write-Info 'ยังไม่ได้แตะ LINE และ Funnel — บอทยังรับข้อความทางเดิมอยู่ ไม่มีอะไรเสีย'
    exit 2
}

if ($TunnelOnly) {
    Write-Host ""
    Write-Host "  เชื่อม tunnel เรียบร้อย — ข้ามการย้าย LINE และการปิด Funnel ตามที่สั่ง (-TunnelOnly)" -ForegroundColor Green
    exit 0
}

# ---- 4. ย้าย webhook ของ LINE ----
Write-Step '4. ย้าย Webhook URL ของ LINE'
$lineToken = Read-DotEnv 'LINE_CHANNEL_ACCESS_TOKEN'
if (-not $lineToken) { Write-Fail 'ไม่พบ LINE_CHANNEL_ACCESS_TOKEN ใน .env — ย้ายเองที่ LINE Developers Console'; exit 1 }
$lineHeaders = @{ Authorization = "Bearer $lineToken" }
$want = "https://$PublicHost/webhook"
$current = Get-LineWebhook $lineHeaders
if (-not $current) { Write-Fail 'อ่าน Webhook URL ปัจจุบันจาก LINE ไม่ได้ (เครื่องนี้ออก api.line.me ได้ไหม?)'; exit 1 }

if ($current.endpoint -eq $want) {
    Write-Pass "LINE ส่ง webhook มาที่ $want อยู่แล้ว"
} else {
    Write-Info "ตอนนี้ LINE ส่งไปที่: $($current.endpoint)"
    $test = Test-LineWebhook $lineHeaders $want
    if (-not $test.success) {
        Write-Fail "LINE ยิงทดสอบลิงก์ใหม่ไม่ผ่าน ($($test.statusCode) $($test.reason) $($test.detail)) — ยังไม่เปลี่ยน บอทใช้ลิงก์เดิมต่อ"
        exit 1
    }
    Write-Pass "LINE ยิงทดสอบลิงก์ใหม่ผ่าน (statusCode $($test.statusCode))"
    try {
        Invoke-RestMethod -Uri "$LineApi/endpoint" -Method Put -Headers $lineHeaders -ContentType 'application/json' `
            -Body (@{ endpoint = $want } | ConvertTo-Json) -TimeoutSec 15 -ErrorAction Stop | Out-Null
    } catch {
        Write-Fail "เปลี่ยน Webhook URL ไม่สำเร็จ: $($_.Exception.Message) — บอทยังใช้ลิงก์เดิม"
        exit 1
    }
    $after = Get-LineWebhook $lineHeaders
    if (-not $after -or $after.endpoint -ne $want) { Write-Fail 'สั่งเปลี่ยนแล้วแต่อ่านกลับมาไม่ตรง — ตรวจใน LINE Developers Console'; exit 1 }
    Write-Pass "เปลี่ยน Webhook URL เป็น $want แล้ว"
}
if (-not $current.active) { Write-Warn '"Use webhook" ปิดอยู่ใน LINE Developers Console — บอทจะไม่ได้รับข้อความจนกว่าจะเปิด' }

# ---- 5. ปิด Tailscale Funnel ----
Write-Step '5. ปิด Tailscale Funnel (ทางเข้าเดิม)'
$startup = [Environment]::GetFolderPath('Startup')
$launcher = $null
if ($startup) { $launcher = Join-Path $startup 'it-support-funnel.bat' }
if ($launcher -and (Test-Path $launcher)) {
    try {
        Remove-Item $launcher -Force -ErrorAction Stop
        Write-Pass 'เอาตัวเปิด Funnel ออกจาก Startup แล้ว (ล็อกอินครั้งหน้าจะไม่เปิดกลับมา)'
    } catch {
        Write-Warn "ลบ $launcher ไม่ได้: $($_.Exception.Message) — ลบเองด้วยมือ ไม่งั้นล็อกอินครั้งหน้า Funnel จะเปิดกลับมา"
    }
} else {
    Write-Pass 'ไม่มีตัวเปิด Funnel ใน Startup'
}

$ts = Find-Tailscale
if (-not $ts) {
    Write-Pass 'ไม่พบ tailscale.exe — ไม่มี Funnel ให้ปิด'
} else {
    $off = Invoke-Ts $ts @('funnel', '--https=443', 'off') 30
    $status = Invoke-Ts $ts @('funnel', 'status', '--json') 15
    if ($status.Out -match '"AllowFunnel"\s*:\s*\{\s*"[^"]+"\s*:\s*true') {
        Write-Warn "Funnel ยังเปิดอยู่ — สั่งเองในหน้าต่าง admin: tailscale funnel --https=443 off ($($off.Out))"
    } else {
        Write-Pass 'ปิด Funnel แล้ว — ลิงก์ *.ts.net เดิมเข้าจากข้างนอกไม่ได้อีก'
    }
}

# ---- สรุป ----
Write-Host ""
Write-Host "============================================================" -ForegroundColor White
if ($script:Failed) {
    Write-Host "  ยังไม่ครบ — ดูรายการ [ไม่ผ่าน] ด้านบน" -ForegroundColor Red
    Write-Host "============================================================" -ForegroundColor White
    exit 1
}
Write-Host "  ย้ายเสร็จแล้ว" -ForegroundColor Green
Write-Host "    เว็บแอดมิน:   https://$PublicHost" -ForegroundColor White
Write-Host "    LINE webhook: $want" -ForegroundColor White
Write-Host "  ลิงก์ *.ts.net เดิมใช้ไม่ได้แล้ว — แจ้งทีมให้เปลี่ยน bookmark" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor White
exit 0
