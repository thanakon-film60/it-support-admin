#Requires -Version 5.1
<#
    เปิดเว็บแอดมิน + webhook ของบอท LINE ออกอินเทอร์เน็ตผ่าน Tailscale Funnel
    แล้ว "พิสูจน์จากข้างนอก" ว่าคนนอกเข้าได้จริง — ไม่ใช่แค่ดูว่า funnel status ขึ้นเขียว

    เส้นทางที่ตั้ง (ต้องเป็นแบบนี้เท่านั้น):
      https://<เครื่อง>.<tailnet>.ts.net/          -> http://127.0.0.1:3000  เว็บแอดมิน (ต้องล็อกอิน)
      https://<เครื่อง>.<tailnet>.ts.net/webhook   -> http://127.0.0.1:8000  บอท LINE (ตรวจลายเซ็น HMAC)

    วิธีใช้:
      enable-funnel.bat                                  ดับเบิลคลิก — ตรวจก่อน ซ่อมเฉพาะเมื่อเสีย
      .\scripts\enable-funnel.ps1 -Force                 ล้างแล้วตั้งใหม่เสมอ
      .\scripts\enable-funnel.ps1 -InstallAutostart      ตั้งให้รันเองทุกครั้งที่ล็อกอิน Windows ด้วย
      .\scripts\enable-funnel.ps1 -Unattended -WaitSeconds 300   (ตัวที่ Startup เรียก — เขียน log แทนจอ)

    exit code:  0 = คนนอกเข้าได้จริง
                1 = เข้าไม่ได้ / ตั้งไม่สำเร็จ / หน้าที่ต้องล็อกอินกลับเปิดโล่ง
                2 = ตั้งเรียบร้อย แต่พิสูจน์จากข้างนอกไม่ได้ (เช่น เครื่องนี้ออกเน็ตไม่ได้ชั่วคราว)

    ทำไมต้องมีไฟล์นี้ แทนที่จะพิมพ์ tailscale funnel เอง — บทเรียนที่เจอจริงทั้งหมด:
      1. Funnel ค้างที่ control plane ได้ทั้งที่ `funnel status` ขึ้น "Funnel on" ครบ (2026-09-21, 09-26)
         สั่ง `funnel --bg` ซ้ำไม่ช่วย ต้อง off ให้เกลี้ยงก่อนแล้วตั้งใหม่ — ไฟล์นี้ทำให้อัตโนมัติ
         แต่ "เฉพาะเมื่อพิสูจน์แล้วว่าข้างนอกเข้าไม่ได้" เพราะการ off คือทำให้ระบบดับไปหลายวินาที
      2. ทดสอบด้วย curl จากเครื่องตัวเองไม่พิสูจน์อะไร — MagicDNS ลัด *.ts.net เข้าเครื่องตรงๆ
         (แม้สั่ง Resolve-DnsName -Server 8.8.8.8) ไฟล์นี้จึงถาม DNS สาธารณะผ่าน HTTPS
         แล้วบังคับยิงเข้า IP ของ ingress สาธารณะด้วย curl --resolve = เส้นทางเดียวกับคนนอกจริง
      3. เผลอใช้ `serve` แทน `funnel` จะสลับเป็น "tailnet only" เงียบๆ — ตรวจจาก AllowFunnel ใน JSON
      4. ครั้งแรกที่ tailnet ยังไม่เปิดสิทธิ์ Funnel คำสั่ง tailscale จะ "รอ" ให้ไปกดในเว็บไม่มีวันจบ
         ถ้ารันตอนล็อกอินจะค้างอยู่เบื้องหลังตลอดไป จึงเรียก tailscale ผ่าน Invoke-Ts ที่มี timeout เสมอ
#>

param(
    # ล้าง config แล้วตั้งใหม่ แม้ตรวจแล้วว่าใช้ได้อยู่
    [switch]$Force,
    # รอให้ Docker (app/bot) ขึ้นก่อนไม่เกินกี่วินาที — ตอนล็อกอิน Docker Desktop สตาร์ทช้ากว่าเรา
    [int]$WaitSeconds = 0,
    # โหมดไม่มีคนเฝ้า: เขียนทุกอย่างลง logs\funnel.log ไม่หยุดรอ
    [switch]$Unattended,
    # ไม่ต้องให้ LINE ยิงทดสอบ webhook (ใช้ตอนยังไม่ได้ตั้ง LINE หรือ token ยังไม่พร้อม)
    [switch]$SkipLineTest,
    # วางตัวเรียกไฟล์นี้ไว้ใน Startup ของ Windows ด้วย
    [switch]$InstallAutostart,
    # ระบุ tailscale.exe เอง (ปกติหาเจอเอง — มีไว้สำหรับเทสต์)
    [string]$TailscalePath
)

. (Join-Path $PSScriptRoot 'console-utf8.ps1')
Initialize-ThaiConsole

# tailscale/curl เขียนข้อความปกติลง stderr ได้ ถ้าใช้ 'Stop' สคริปต์จะตายทั้งที่ทุกอย่างปกติ
# ทุกจุดที่ล้มได้จึงเช็คผลเองตรงๆ แทน
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$RepoRoot = Split-Path -Parent $PSScriptRoot
$WebPort = 3000
$BotPort = 8000

if ($Unattended) {
    $logDir = Join-Path $RepoRoot 'logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $logFile = Join-Path $logDir 'funnel.log'
    # กัน log โตไม่หยุด — รันทุกครั้งที่ล็อกอิน ปีหนึ่งหลายร้อยรอบ
    if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1MB)) {
        Move-Item $logFile "$logFile.old" -Force
    }
    try { Start-Transcript -Path $logFile -Append | Out-Null } catch { }
}

# ---------------------------------------------------------------- แสดงผล

$script:Failed = $false
function Write-Step { param($m) Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Pass { param($m) Write-Host "  [ผ่าน] $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "  [เตือน] $m" -ForegroundColor Yellow }
function Write-Fail { param($m) Write-Host "  [ไม่ผ่าน] $m" -ForegroundColor Red; $script:Failed = $true }
function Write-Info { param($m) Write-Host "  $m" -ForegroundColor Gray }

function Exit-Script {
    param([int]$Code)
    if ($Unattended) { try { Stop-Transcript | Out-Null } catch { } }
    exit $Code
}

# ---------------------------------------------------------------- ตัวช่วย

function Find-Tailscale {
    if ($TailscalePath) { return $TailscalePath }
    $c = Get-Command tailscale.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return $c.Source }
    $guess = 'C:\Program Files\Tailscale\tailscale.exe'
    if (Test-Path $guess) { return $guess }
    $c = Get-Command tailscale -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return $c.Source }
    return $null
}

# ต้องเป็น curl.exe ตัวจริง — ใน Windows PowerShell 5.1 คำว่า `curl` คือ alias ของ Invoke-WebRequest
# ซึ่งไม่มี --resolve จึงบังคับยิงเข้า ingress สาธารณะไม่ได้
function Find-Curl {
    foreach ($n in 'curl.exe', 'curl') {
        $c = Get-Command $n -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($c) { return $c.Source }
    }
    return $null
}

# เรียก tailscale แบบมี timeout — เหตุผลอยู่ข้อ 4 หัวไฟล์
function Invoke-Ts {
    param([string[]]$TsArgs, [int]$TimeoutSec = 30)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $script:Ts
    $psi.Arguments = ($TsArgs -join ' ')
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    try { $p = [System.Diagnostics.Process]::Start($psi) }
    catch { return @{ Code = -1; Out = $_.Exception.Message; TimedOut = $false } }
    # อ่านแบบ async ทั้งสองท่อ — ถ้าอ่านทีละท่อแล้วอีกท่อเต็ม buffer โปรเซสจะค้างรอเราตลอดไป
    $o = $p.StandardOutput.ReadToEndAsync()
    $e = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        try { $p.Kill() } catch { }
        return @{ Code = -1; Out = ($o.Result + $e.Result); TimedOut = $true }
    }
    $p.WaitForExit()
    return @{ Code = $p.ExitCode; Out = ($o.Result + "`n" + $e.Result).Trim(); TimedOut = $false }
}

# อ่าน property ที่ชื่อมี ':' หรือ '/' (เช่น "host:443", "/webhook") ได้ทั้ง PS 5.1 และ 7
function Get-Prop {
    param($Obj, [string]$Name)
    if ($null -eq $Obj) { return $null }
    $p = $Obj.PSObject.Properties[$Name]
    if ($p) { return $p.Value }
    return $null
}

function Get-FunnelConfig {
    $r = Invoke-Ts @('funnel', 'status', '--json')
    if ($r.Code -ne 0 -or -not $r.Out) { return $null }
    try { return ($r.Out | ConvertFrom-Json) } catch { return $null }
}

# คืนรายการ "สิ่งที่ผิด" — ว่างแปลว่า config ถูกครบ
function Test-FunnelConfig {
    param($Cfg, [string]$HostName)
    $problems = @()
    $key = "${HostName}:443"
    if ($null -eq $Cfg) { return @('อ่าน config ของ funnel ไม่ได้') }

    if ((Get-Prop (Get-Prop $Cfg 'AllowFunnel') $key) -ne $true) {
        $problems += "พอร์ต 443 ไม่ได้เปิดเป็น Funnel (ว่าง หรือเป็น 'tailnet only' จากการเผลอใช้ serve)"
    }
    $handlers = Get-Prop (Get-Prop (Get-Prop $Cfg 'Web') $key) 'Handlers'
    $root = Get-Prop (Get-Prop $handlers '/') 'Proxy'
    $hook = Get-Prop (Get-Prop $handlers '/webhook') 'Proxy'
    if (-not ($root -match ":$WebPort(/|$)")) { $problems += "/ ไม่ได้ชี้ไปเว็บแอดมิน :$WebPort (ตอนนี้: $root)" }
    if (-not ($hook -match ":$BotPort(/|$)")) { $problems += "/webhook ไม่ได้ชี้ไปบอท :$BotPort (ตอนนี้: $hook)" }
    return $problems
}

function Show-FunnelHint {
    param([string]$Out)
    if ($Out -match '(https://login\.tailscale\.com/\S+)') {
        Write-Info "Tailscale ขอให้เปิดสิทธิ์ Funnel ก่อน — เปิดลิงก์นี้ด้วยบัญชีแอดมินของ tailnet แล้วกดอนุญาต:"
        Write-Host "    $($Matches[1])" -ForegroundColor White
        Write-Info "(หรือที่ admin console → Access controls → เพิ่ม nodeAttrs ที่มี attr: [""funnel""])"
    }
}

# off ให้เกลี้ยงแล้วตั้งใหม่ — บังคับให้ลงทะเบียนกับ control plane รอบใหม่ (ข้อ 1 หัวไฟล์)
function Repair-Funnel {
    Write-Info "ล้าง config เดิม..."
    Invoke-Ts @('funnel', '--https=443', 'off') | Out-Null
    $left = Get-FunnelConfig
    if ($left -and ((Get-Prop $left 'Web') -or (Get-Prop $left 'TCP'))) {
        # มีเส้นทางอื่นค้าง (เช่นพอร์ตอื่นจากการทดลอง) — reset ทั้งหมด
        Invoke-Ts @('serve', 'reset') | Out-Null
    }

    Write-Info "ตั้งเส้นทางใหม่..."
    # ต้องเป็น funnel ทั้งสองบรรทัด ห้าม serve — สองคำสั่งเขียนทับ config ตัวเดียวกัน
    # /webhook ใช้ --set-path ซึ่ง "ตัด prefix ทิ้ง" บอทจึงได้ POST / — main.py รับทั้ง / และ /webhook ไว้แล้ว (บั๊กที่ 5)
    foreach ($a in @(@('funnel', '--bg', "$WebPort"), @('funnel', '--bg', '--set-path=/webhook', "$BotPort"))) {
        $r = Invoke-Ts $a 45
        if ($r.TimedOut) {
            Write-Fail "tailscale $($a -join ' ') ค้างไม่จบภายใน 45 วินาที"
            Show-FunnelHint $r.Out
            return $false
        }
        if ($r.Code -ne 0) {
            Write-Fail "tailscale $($a -join ' ') ล้มเหลว: $($r.Out)"
            Show-FunnelHint $r.Out
            return $false
        }
    }
    return $true
}

function Test-Local {
    param([string]$Url)
    try {
        $r = Invoke-WebRequest -Uri $Url -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        return ([int]$r.StatusCode -eq 200)
    } catch { return $false }
}

# ถาม DNS สาธารณะผ่าน HTTPS — ห้ามใช้ Resolve-DnsName เพราะ MagicDNS ดักไว้ (ข้อ 2 หัวไฟล์)
function Resolve-PublicIPv4 {
    param([string]$HostName)
    $urls = @(
        "https://cloudflare-dns.com/dns-query?name=$HostName&type=A",
        "https://dns.google/resolve?name=$HostName&type=A"
    )
    foreach ($u in $urls) {
        try {
            $r = Invoke-WebRequest -Uri $u -Headers @{ accept = 'application/dns-json' } -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
            $j = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json
            $ips = @($j.Answer | Where-Object { $_.type -eq 1 } | ForEach-Object { $_.data })
            if ($ips.Count -gt 0) { return $ips }
        } catch { }
    }
    return @()
}

function Get-PublicStatus {
    param([string]$HostName, [string]$Ip, [string]$Path)
    $nul = if ($env:OS -eq 'Windows_NT') { 'NUL' } else { '/dev/null' }
    # --ssl-no-revoke: curl.exe ของ Windows (Schannel) ตรวจ revocation แล้วล้มได้เองบางเครือข่าย
    # ทำให้รายงานว่า "เข้าไม่ได้" ทั้งที่ Funnel ปกติ — นี่คือการตรวจเส้นทาง ไม่ใช่การส่งข้อมูลลับ
    $code = & $script:Curl -s -o $nul -w '%{http_code}' --max-time 20 --ssl-no-revoke `
        --resolve "${HostName}:443:$Ip" "https://$HostName$Path" 2>$null
    try { return [int]("$code".Trim()) } catch { return 0 }
}

# ตรวจจากมุมคนนอก: 'ok' | 'fail' | 'unknown' (เครื่องนี้ออกเน็ตไม่ได้ → ตัดสินไม่ได้)
$Checks = @(
    @{ Path = '/api/health'; Expect = @(200);               Name = 'เว็บแอดมินตอบ' },
    @{ Path = '/login';      Expect = @(200);               Name = 'หน้า login' },
    @{ Path = '/webhook';    Expect = @(200);               Name = 'webhook ของบอท LINE' },
    # ระบบเปิดสาธารณะ — ถ้าหน้านี้ได้ 200 แปลว่าใครก็ดึงทะเบียนพนักงานได้ (เคยเกิดจริงก่อน 2 ต.ค. 2026)
    @{ Path = '/employees';  Expect = @(302, 303, 307, 308); Name = 'หน้าข้อมูลพนักงานต้องเด้งไป login'; Security = $true }
)

function Test-Public {
    param([string]$HostName, [switch]$Quiet)
    if (-not $script:Curl) { if (-not $Quiet) { Write-Warn 'ไม่พบ curl.exe — ตรวจจากข้างนอกไม่ได้' }; return 'unknown' }
    $ips = Resolve-PublicIPv4 $HostName
    if ($ips.Count -eq 0) {
        if (-not $Quiet) { Write-Warn "ถาม DNS สาธารณะของ $HostName ไม่ได้ (เครื่องนี้ออกเน็ตไม่ได้ หรือ Funnel ยังไม่ประกาศ DNS)" }
        return 'unknown'
    }

    # ingress มีหลาย IP — ผ่านตัวใดตัวหนึ่งครบทุกข้อก็พอ
    foreach ($ip in $ips) {
        $results = @()
        foreach ($c in $Checks) {
            $results += @{ Check = $c; Status = (Get-PublicStatus $HostName $ip $c.Path) }
        }
        $reachable = @($results | Where-Object { -not $_.Check.Security -and ($_.Check.Expect -contains $_.Status) }).Count
        if ($reachable -lt ($Checks.Count - 1)) {
            if (-not $Quiet) {
                $detail = ($results | ForEach-Object { "$($_.Check.Path)=$($_.Status)" }) -join ' · '
                Write-Info "ingress $ip : $detail"
            }
            continue
        }
        if (-not $Quiet) {
            Write-Info "ยิงผ่าน ingress สาธารณะ $ip (ไม่ผ่าน MagicDNS):"
            foreach ($r in $results) {
                if ($r.Check.Expect -contains $r.Status) { Write-Pass "$($r.Check.Name) — $($r.Check.Path) → $($r.Status)" }
                elseif ($r.Check.Security -and $r.Status -eq 200) {
                    Write-Fail "$($r.Check.Path) เปิดได้โดยไม่ต้องล็อกอิน! ใครมี URL ก็ดึงข้อมูลพนักงานได้ — ตรวจ AUTH_DISABLED=false ใน .env แล้ว docker compose up -d --build app"
                }
                else { Write-Fail "$($r.Check.Name) — $($r.Check.Path) → $($r.Status)" }
            }
        }
        # เข้าได้แต่ "เข้าได้มากเกินไป" = ปัญหาที่ตัวแอป ไม่ใช่ Funnel — ห้ามไปล้าง Funnel ซ่อม
        $insecure = @($results | Where-Object { $_.Check.Security -and $_.Status -eq 200 }).Count -gt 0
        if ($insecure) { return 'insecure' }
        if ($script:Failed) { return 'fail' }
        return 'ok'
    }
    return 'fail'
}

# Funnel ใช้เวลาลงทะเบียนกับ control plane ราว 1-2 นาทีหลังตั้งใหม่ — ถามซ้ำแบบทิ้งช่วง
function Wait-Public {
    param([string]$HostName, [int[]]$Delays)
    foreach ($d in $Delays) {
        if ($d -gt 0) { Write-Info "รอ $d วินาทีให้ Funnel ลงทะเบียน..."; Start-Sleep -Seconds $d }
        $s = Test-Public $HostName -Quiet
        # 'unknown' ก็รอต่อ — หลังตั้งใหม่ DNS สาธารณะอาจยังไม่ประกาศ ไม่ได้แปลว่าไม่มีเน็ต
        if ($s -eq 'ok' -or $s -eq 'insecure') { break }
    }
    # รอบสุดท้ายพิมพ์รายละเอียดให้เห็นว่าผ่าน/ไม่ผ่านตรงไหน
    return (Test-Public $HostName)
}

function Read-DotEnv {
    param([string]$Name)
    $f = Join-Path $RepoRoot '.env'
    if (-not (Test-Path $f)) { return $null }
    $line = Get-Content $f -Encoding UTF8 | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -Last 1
    if (-not $line) { return $null }
    return (($line -replace "^\s*$Name\s*=\s*", '') -replace '^["'']|["'']$', '').Trim()
}

# ตัวชี้ขาดที่เชื่อได้ที่สุด: ให้เซิร์ฟเวอร์ LINE ยิง webhook เข้ามาเอง (LINE_SETUP.md §3.1)
# ไม่กินโควตา push
function Test-LineWebhook {
    param([string]$HostName)
    $token = Read-DotEnv 'LINE_CHANNEL_ACCESS_TOKEN'
    if (-not $token) { Write-Warn 'ไม่พบ LINE_CHANNEL_ACCESS_TOKEN ใน .env — ข้ามการให้ LINE ทดสอบ'; return }
    $h = @{ Authorization = "Bearer $token" }
    $want = "https://$HostName/webhook"

    try {
        $ep = Invoke-RestMethod -Uri 'https://api.line.me/v2/bot/channel/webhook/endpoint' -Headers $h -TimeoutSec 15
        if ($ep.endpoint -ne $want) {
            Write-Warn "Webhook URL ใน LINE Developers Console คือ '$($ep.endpoint)' ไม่ใช่ '$want'"
        } elseif (-not $ep.active) {
            Write-Warn 'Webhook URL ถูกต้อง แต่ "Use webhook" ยังปิดอยู่ใน LINE Developers Console'
        }
    } catch { Write-Warn "อ่าน Webhook URL จาก LINE ไม่ได้: $($_.Exception.Message)" }

    try {
        $t = Invoke-RestMethod -Uri 'https://api.line.me/v2/bot/channel/webhook/test' -Method Post -Headers $h `
            -ContentType 'application/json' -Body (@{ endpoint = $want } | ConvertTo-Json) -TimeoutSec 30
        if ($t.success) { Write-Pass "LINE ยิง webhook เข้ามาได้จริง (statusCode $($t.statusCode))" }
        else { Write-Fail "LINE ยิงเข้ามาไม่สำเร็จ: $($t.reason) $($t.detail)" }
    } catch { Write-Warn "เรียก LINE webhook test ไม่ได้: $($_.Exception.Message)" }
}

function Install-Autostart {
    $startup = [Environment]::GetFolderPath('Startup')
    if (-not $startup) { Write-Warn 'หาโฟลเดอร์ Startup ไม่เจอ'; return }
    $dst = Join-Path $startup 'it-support-funnel.bat'
    $self = Join-Path $PSScriptRoot 'enable-funnel.ps1'
    # เขียน path เต็มลงไป — ไฟล์นี้อยู่ใน Startup ไม่ใช่ในโปรเจกต์ %~dp0 จึงชี้ผิดที่
    # ภาษาไทยในไฟล์ .bat ไม่ปลอดภัย (cmd อ่านตาม OEM code page) จึงใช้ภาษาอังกฤษเฉพาะไฟล์นี้
    $content = @(
        '@echo off',
        'REM Generated by scripts\enable-funnel.ps1 -InstallAutostart. Edit that script, not this file.',
        "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$self`" -Unattended -WaitSeconds 300"
    )
    try {
        Set-Content -Path $dst -Value $content -Encoding ASCII -Force
        Write-Pass "ตั้งให้รันเองทุกครั้งที่ล็อกอิน Windows แล้ว ($dst)"
        Write-Info "log ของแต่ละรอบอยู่ที่ $RepoRoot\logs\funnel.log"
    } catch { Write-Fail "เขียนไฟล์ Startup ไม่ได้: $($_.Exception.Message)" }
}

# ================================================================ เริ่มทำงาน

Write-Host ""
Write-Host "  เปิดระบบ IT Support ออกอินเทอร์เน็ตผ่าน Tailscale Funnel  ($(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))" -ForegroundColor White

if ($InstallAutostart) {
    Write-Step '0. รันเองหลังล็อกอิน'
    Install-Autostart
}

# ---- 1. Tailscale พร้อมไหม ----
Write-Step '1. Tailscale'
$script:Ts = Find-Tailscale
$script:Curl = Find-Curl
if (-not $script:Ts) {
    Write-Fail 'ไม่พบ tailscale.exe — ติดตั้งจาก https://tailscale.com/download/windows แล้วล็อกอินก่อน'
    Exit-Script 1
}

# ตอนล็อกอิน service ของ Tailscale อาจยังไม่ขึ้น — รอได้ตาม WaitSeconds
$deadline = (Get-Date).AddSeconds([Math]::Max($WaitSeconds, 0))
do {
    $st = $null
    $r = Invoke-Ts @('status', '--json')
    if ($r.Code -eq 0) { try { $st = $r.Out | ConvertFrom-Json } catch { } }
    if ($st -and $st.BackendState -eq 'Running') { break }
    if ((Get-Date) -lt $deadline) { Start-Sleep -Seconds 5 }
} while ((Get-Date) -lt $deadline)

if (-not $st -or $st.BackendState -ne 'Running') {
    $state = if ($st) { $st.BackendState } else { 'ติดต่อ service ไม่ได้' }
    Write-Fail "Tailscale ไม่ได้ทำงานอยู่ (สถานะ: $state)"
    if ($state -eq 'NeedsLogin') { Write-Info 'เปิดแอป Tailscale ที่ถาดข้างนาฬิกาแล้วล็อกอิน' }
    elseif ($state -eq 'Stopped') { Write-Info "เปิดแอป Tailscale แล้วกด Connect (หรือรัน: tailscale up)" }
    Exit-Script 1
}

$HostName = "$($st.Self.DNSName)".TrimEnd('.')
if (-not $HostName) { Write-Fail 'ไม่รู้ชื่อเครื่องใน tailnet (เปิด MagicDNS ใน admin console หรือยัง?)'; Exit-Script 1 }
Write-Pass "เชื่อมต่ออยู่ในชื่อ $HostName"

# ---- 2. ของที่จะเปิดออกไปขึ้นอยู่หรือยัง ----
Write-Step '2. เว็บแอดมินและบอทในเครื่อง'
$deadline = (Get-Date).AddSeconds([Math]::Max($WaitSeconds, 0))
do {
    $webUp = Test-Local "http://127.0.0.1:$WebPort/api/health"
    $botUp = Test-Local "http://127.0.0.1:$BotPort/health"
    if ($webUp -and $botUp) { break }
    if ((Get-Date) -lt $deadline) { Start-Sleep -Seconds 10 }
} while ((Get-Date) -lt $deadline)

# ไม่หยุดตรงนี้ — Funnel ตั้งได้แม้ปลายทางยังไม่ขึ้น และพอ Docker ขึ้นทีหลังก็ใช้ได้ทันที
if ($webUp) { Write-Pass "เว็บแอดมิน :$WebPort ตอบ" } else { Write-Warn "เว็บแอดมิน :$WebPort ยังไม่ตอบ — Docker Desktop เปิดอยู่ไหม? (docker compose up -d)" }
if ($botUp) { Write-Pass "บอท LINE :$BotPort ตอบ" } else { Write-Warn "บอท LINE :$BotPort ยังไม่ตอบ — LINE จะยิง webhook เข้ามาไม่สำเร็จจนกว่าบอทจะขึ้น" }

# ---- 3. config ของ Funnel ----
Write-Step '3. Tailscale Funnel'
$problems = @(Test-FunnelConfig (Get-FunnelConfig) $HostName)
$changed = $false

if ($Force -or $problems.Count -gt 0) {
    if ($Force) { Write-Info 'สั่ง -Force — ตั้งใหม่ทั้งหมด' }
    foreach ($p in $problems) { Write-Info "ต้องแก้: $p" }
    if (-not (Repair-Funnel)) { Exit-Script 1 }
    $changed = $true
    $problems = @(Test-FunnelConfig (Get-FunnelConfig) $HostName)
    if ($problems.Count -gt 0) {
        foreach ($p in $problems) { Write-Fail $p }
        Exit-Script 1
    }
}
Write-Pass "/ → :$WebPort · /webhook → :$BotPort · เปิดสาธารณะ (Funnel on)"

# ---- 4. พิสูจน์จากข้างนอก ----
Write-Step '4. ตรวจจากมุมคนนอก'
$delays = if ($changed) { @(5, 15, 30, 45) } else { @(0) }
$script:Failed = $false
$result = Wait-Public $HostName $delays

if ($result -eq 'fail' -and -not $changed) {
    # config ถูกทุกตัวอักษร แต่ข้างนอกเข้าไม่ได้ = อาการ Funnel ค้างที่ control plane (ข้อ 1 หัวไฟล์)
    Write-Warn 'config ถูกแต่คนนอกเข้าไม่ได้ — อาการ Funnel ค้างที่เคยเจอ กำลังล้างแล้วตั้งใหม่'
    if (-not (Repair-Funnel)) { Exit-Script 1 }
    $script:Failed = $false
    $result = Wait-Public $HostName @(5, 15, 30, 45)
}

# ---- 5. ให้ LINE ยืนยัน ----
if (-not $SkipLineTest -and ($result -eq 'ok' -or $result -eq 'unknown') -and $botUp) {
    Write-Step '5. ให้ LINE ทดสอบยิง webhook'
    Test-LineWebhook $HostName
}

# ---- สรุป ----
Write-Host ""
Write-Host "============================================================" -ForegroundColor White
if ($result -eq 'ok' -and -not $script:Failed) {
    Write-Host "  คนนอกเข้าได้แล้ว" -ForegroundColor Green
    Write-Host "    เว็บแอดมิน : https://$HostName/" -ForegroundColor White
    Write-Host "    LINE webhook: https://$HostName/webhook" -ForegroundColor White
    Write-Host "  ใช้ได้จากทุกเครือข่าย ไม่ต้องลงแอป Tailscale · ทุกหน้าต้องล็อกอิน" -ForegroundColor Gray
    $code = 0
} elseif ($result -eq 'unknown' -and -not $script:Failed) {
    Write-Host "  ตั้ง Funnel เรียบร้อย แต่ยืนยันจากข้างนอกไม่ได้ในรอบนี้" -ForegroundColor Yellow
    Write-Host "  ลองเปิด https://$HostName/ จากมือถือที่ปิด Wi-Fi (ใช้เน็ตมือถือ)" -ForegroundColor Yellow
    $code = 2
} elseif ($result -eq 'insecure') {
    Write-Host "  คนนอกเข้าได้ แต่หน้าที่ต้องล็อกอินกลับเปิดโล่ง — แก้ AUTH_DISABLED ก่อนให้ใครใช้" -ForegroundColor Red
    $code = 1
} else {
    Write-Host "  คนนอกยังเข้าไม่ได้ — ดูรายการ [ไม่ผ่าน] ด้านบน" -ForegroundColor Red
    Write-Host "  ถ้าทุกอย่างในเครื่องเขียวหมด: LINE_SETUP.md §3.1 · หรือรันซ้ำด้วย -Force" -ForegroundColor Red
    $code = 1
}
Write-Host "============================================================" -ForegroundColor White
Exit-Script $code
