#Requires -Version 5.1
<#
    ตรวจว่า "คนนอก" เข้าเว็บแอดมินผ่านโดเมน DuckDNS ได้จริงไหม — จบในคำสั่งเดียว ไม่ต้องใช้มือถือ

    ทำไมต้องมีไฟล์นี้ (เจอจริง 2 ต.ค. 2026 ตอนตั้ง port forward ที่เราเตอร์ AIS จากระยะไกล):
      1. ทดสอบจากเครื่องนี้/ในออฟฟิศพิสูจน์อะไรไม่ได้ — เราเตอร์บางรุ่นทำ NAT loopback บางรุ่นไม่ทำ
         ผลจึงหลอกได้ทั้งสองทาง (ข้างในเข้าได้แต่ข้างนอกเข้าไม่ได้ หรือกลับกัน)
      2. ดู IP ใน log ของ Caddy ก็แยกไม่ได้ — Docker Desktop บน Windows ไม่ส่ง IP ต้นทางจริง
         เข้า container ทุก request (ทั้งในเครื่องและจากอินเทอร์เน็ต) จึงเห็นเป็น 172.x เหมือนกันหมด
      3. ทดสอบหลายขั้นด้วยมือ (เปิดเว็บตรวจ แล้วค่อยมาดู log) จังหวะเวลาไม่ตรงกัน สรุปผิดง่าย

    สิ่งที่ทำ:
      1. เทียบ IP สาธารณะของออฟฟิศกับ DNS ของโดเมน (ถาม DNS ผ่าน HTTPS ไม่ผ่าน resolver ในเครื่อง)
      2. ตรวจว่า Caddy ในเครื่องตอบด้วยใบรับรองที่ถูกต้อง
      3. ให้ check-host.net ยิงจากหลายประเทศ ทั้ง TCP (พอร์ตเปิดไหม) และ HTTPS (ถึงแอปไหม)
      4. นับ request ใน log ของ Caddy ก่อน-หลัง → รู้ว่าที่ตอบกลับไปคือ Caddy ของเราจริง ไม่ใช่ตัวเราเตอร์
      5. สรุปว่าพังตรงไหน และต้องแก้ที่ใด

    ใช้: ดับเบิลคลิก check-public.bat · หรือ .\scripts\check-public.ps1 [-Domain x.duckdns.org]
    exit code: 0 = คนนอกเข้าได้ · 1 = ไม่ได้ หรือตรวจไม่สำเร็จ
#>

param(
    # ค่าตั้งต้นอ่านจาก DOMAIN ใน .env (ตัวเดียวกับที่ Caddyfile ใช้)
    [string]$Domain,
    # จำนวนเครื่องตรวจของ check-host.net — มากขึ้นแม่นขึ้นแต่ช้าลง
    [int]$Nodes = 6
)

. (Join-Path $PSScriptRoot 'console-utf8.ps1')
Initialize-ThaiConsole

# docker/curl เขียนข้อความปกติลง stderr ได้ — ถ้าใช้ 'Stop' สคริปต์จะตายกลางทาง ทุกจุดจึงเช็คผลเอง
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$RepoRoot = Split-Path -Parent $PSScriptRoot
$CheckHost = 'https://check-host.net'
$JsonHeaders = @{ Accept = 'application/json' }

function Write-Step { param($m) Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Pass { param($m) Write-Host "  [ผ่าน] $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "  [เตือน] $m" -ForegroundColor Yellow }
function Write-Fail { param($m) Write-Host "  [ไม่ผ่าน] $m" -ForegroundColor Red }
function Write-Info { param($m) Write-Host "  $m" -ForegroundColor Gray }

# ---------------------------------------------------------------- ตัวช่วย

function Read-DotEnv {
    param([string]$Name)
    $f = Join-Path $RepoRoot '.env'
    if (-not (Test-Path $f)) { return $null }
    $line = Get-Content $f -Encoding UTF8 | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -Last 1
    if (-not $line) { return $null }
    return (($line -replace "^\s*$Name\s*=\s*", '') -replace '^["'']|["'']$', '').Trim()
}

# ต้องเป็น curl.exe ตัวจริง — ใน Windows PowerShell 5.1 คำว่า `curl` คือ alias ของ Invoke-WebRequest
function Find-Curl {
    foreach ($n in 'curl.exe', 'curl') {
        $c = Get-Command $n -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($c) { return $c.Source }
    }
    return $null
}

# ยิง https://<โดเมน>/api/health โดยบังคับให้วิ่งไปที่ IP ที่กำหนด (ไม่สน DNS)
# ไม่ใส่ -k = ตรวจใบรับรองจริงด้วย · --ssl-no-revoke กัน curl.exe ของ Windows ล้มเพราะตรวจ revocation ไม่ได้
function Get-HealthCode {
    param([string]$Ip, [switch]$Insecure)
    $nul = if ($env:OS -eq 'Windows_NT') { 'NUL' } else { '/dev/null' }
    $a = @('-s', '-o', $nul, '-w', '%{http_code}', '--max-time', '15', '--ssl-no-revoke',
        '--resolve', "${Domain}:443:$Ip", "https://$Domain/api/health")
    if ($Insecure) { $a = @('-k') + $a }
    $code = & $script:Curl @a 2>$null
    try { return [int]("$code".Trim()) } catch { return 0 }
}

function Get-PublicIp {
    foreach ($u in 'https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com') {
        try {
            $ip = "$(Invoke-RestMethod -Uri $u -TimeoutSec 10)".Trim()
            if ($ip -match '^\d{1,3}(\.\d{1,3}){3}$') { return $ip }
        } catch { }
    }
    return $null
}

# ถาม DNS ผ่าน HTTPS — resolver ในเครื่องอาจถูก Tailscale/เราเตอร์ดักตอบเอง
function Resolve-PublicIPv4 {
    param([string]$HostName)
    foreach ($u in "https://cloudflare-dns.com/dns-query?name=$HostName&type=A", "https://dns.google/resolve?name=$HostName&type=A") {
        try {
            $r = Invoke-WebRequest -Uri $u -Headers @{ accept = 'application/dns-json' } -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
            $j = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json
            $ips = @($j.Answer | Where-Object { $_.type -eq 1 } | ForEach-Object { $_.data })
            if ($ips.Count -gt 0) { return $ips }
        } catch { }
    }
    return @()
}

# นับจาก "จำนวนบรรทัดก่อน-หลัง" ไม่ใช่ --since เวลา — นาฬิกาใน VM ของ Docker Desktop (WSL2)
# เพี้ยนจากเครื่องจริงได้เป็นชั่วโมงหลังเครื่อง sleep ทำให้ --since ตัดผิดช่วงแบบเงียบๆ
function Get-CaddyCounts {
    $lines = docker compose logs --no-log-prefix caddy 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return @{
        Requests  = @($lines | Select-String -SimpleMatch 'handled request').Count
        TlsErrors = @($lines | Select-String -SimpleMatch 'TLS handshake error').Count
    }
}

function Start-ExternalCheck {
    param([string]$Type, [string]$Target)
    # ${Type} ต้องมีปีกกา — PowerShell ถือว่า ? เป็นส่วนหนึ่งของชื่อตัวแปรได้ ("$Type?host" = ตัวแปรชื่อ Type?host)
    $u = "$CheckHost/check-${Type}?host=$([uri]::EscapeDataString($Target))&max_nodes=$Nodes"
    try {
        $r = Invoke-RestMethod -Uri $u -Headers $JsonHeaders -TimeoutSec 20
        if ("$($r.ok)" -eq '1' -and $r.request_id) { return $r }
    } catch { }
    return $null
}

function Get-ExternalResult {
    param([string]$Id)
    try { return Invoke-RestMethod -Uri "$CheckHost/check-result/$Id" -Headers $JsonHeaders -TimeoutSec 20 }
    catch { return $null }
}

# เครื่องตรวจบางตัวคืน null, [null] หรือ [[null]] = ยังไม่มีผล/ตรวจไม่ได้ ไม่ใช่ "ผลที่อ่านไม่ออก"
# (เจอจริง 3 ต.ค. 2026: เครื่องที่ Madrid คืนแบบนี้ รุ่นแรกเลยขึ้นสีแดงว่าอ่านผลไม่ออก ชวนเข้าใจผิดว่ามีปัญหา)
function Test-NoNodeData {
    param($Value)
    if ($null -eq $Value) { return $true }
    if (-not ($Value -is [array])) { return $false }
    foreach ($x in $Value) {
        if ($x -is [array]) { foreach ($y in $x) { if ($null -ne $y) { return $false } } }
        elseif ($null -ne $x) { return $false }
    }
    return $true
}

function Test-ResultComplete {
    param($Result)
    if ($null -eq $Result) { return $false }
    $props = @($Result.PSObject.Properties)
    if ($props.Count -eq 0) { return $false }
    foreach ($p in $props) { if (Test-NoNodeData $p.Value) { return $false } }
    return $true
}

function Get-NodeLabel {
    param($NodesInfo, [string]$Node)
    $i = $null
    if ($NodesInfo) { $p = $NodesInfo.PSObject.Properties[$Node]; if ($p) { $i = @($p.Value) } }
    if ($i -and $i.Count -ge 3) { return "$($i[1]) / $($i[2])" }
    return ($Node -replace '\.node\.check-host\.net$', '')
}

# check-http: แต่ละเครื่องได้ [[สำเร็จ(1/0), เวลา, ข้อความ, HTTP code, IP]]
function ConvertFrom-HttpResult {
    param($Result, $NodesInfo)
    $rows = @()
    if ($null -eq $Result) { return $rows }
    foreach ($p in $Result.PSObject.Properties) {
        $label = Get-NodeLabel $NodesInfo $p.Name
        $v = $p.Value
        if (Test-NoNodeData $v) { $rows += [pscustomobject]@{ Node = $label; Ok = $false; Pending = $true; Text = 'ไม่มีผลจากเครื่องตรวจนี้' }; continue }
        $r = $v
        if ($v -is [array] -and $v.Count -gt 0 -and $v[0] -is [array]) { $r = $v[0] }
        if (-not ($r -is [array]) -or $r.Count -lt 3) { $rows += [pscustomobject]@{ Node = $label; Ok = $false; Pending = $false; Text = 'อ่านผลไม่ออก' }; continue }
        $code = if ($r.Count -ge 4) { "$($r[3])" } else { '' }
        $ok = ("$($r[0])" -eq '1') -and ($code -eq '200')
        $text = if ($code) { "$($r[2]) ($code)" } else { "$($r[2])" }
        $rows += [pscustomobject]@{ Node = $label; Ok = $ok; Pending = $false; Text = $text }
    }
    return $rows
}

# check-tcp: แต่ละเครื่องได้ [{"time":..,"address":..}] ถ้าต่อได้ หรือ [{"error":".."}] ถ้าต่อไม่ได้
function ConvertFrom-TcpResult {
    param($Result, $NodesInfo)
    $rows = @()
    if ($null -eq $Result) { return $rows }
    foreach ($p in $Result.PSObject.Properties) {
        $label = Get-NodeLabel $NodesInfo $p.Name
        $v = $p.Value
        if (Test-NoNodeData $v) { $rows += [pscustomobject]@{ Node = $label; Ok = $false; Pending = $true; Text = 'ไม่มีผลจากเครื่องตรวจนี้' }; continue }
        $r = $v
        if ($v -is [array]) { $r = if ($v.Count -gt 0) { $v[0] } else { $null } }
        if ($r -and $r.PSObject.Properties['time']) {
            $ms = [math]::Round([double]$r.time * 1000)
            $rows += [pscustomobject]@{ Node = $label; Ok = $true; Pending = $false; Text = "ต่อพอร์ตได้ ($ms ms)" }
        } elseif ($r -and $r.PSObject.Properties['error']) {
            $rows += [pscustomobject]@{ Node = $label; Ok = $false; Pending = $false; Text = "$($r.error)" }
        } else {
            $rows += [pscustomobject]@{ Node = $label; Ok = $false; Pending = $false; Text = 'อ่านผลไม่ออก' }
        }
    }
    return $rows
}

# ตัดสินจากหลักฐานทั้งหมดรวมกัน — แยกเป็นฟังก์ชันล้วนเพื่อให้เทสต์ได้โดยไม่ต้องมีเน็ต
#   HttpOk / TcpOk   = จำนวนเครื่องตรวจที่ผ่าน (-1 = ตรวจไม่สำเร็จ)
#   Reached          = request ที่ Caddy ได้รับเพิ่มระหว่างตรวจ (-1 = อ่าน log ไม่ได้)
#   TlsErrors        = TLS handshake error ที่ Caddy เห็นเพิ่ม
#   Hairpin          = HTTP code ตอนยิงจากเครื่องนี้ผ่าน IP สาธารณะ (0 = ไม่ได้)
#   FirewallOk       = มีกฎ Windows Firewall ที่ใช้ได้จริงกับ Docker ไหม ($null = ไม่รู้)
function Get-Diagnosis {
    param([int]$HttpOk, [int]$TcpOk, [int]$Reached, [int]$TlsErrors, [int]$Hairpin, $FirewallOk = $null)

    # Firewall บล็อกให้อาการ "timeout จากข้างนอก" เหมือนเราเตอร์ไม่ forward ทุกประการ — ถ้ารู้ว่ากฎยังไม่พร้อม
    # ต้องแก้ข้อนี้ก่อน ไม่งั้นจะไปไล่แก้เราเตอร์/โทรหา AIS ทั้งที่ปัญหาอยู่ในเครื่องเราเอง
    $fwFirst = @()
    if ($FirewallOk -eq $false) {
        $fwFirst = @('ทำข้อนี้ก่อน: Windows Firewall ยังไม่เปิดพอร์ต 443 ให้ Docker — รันคำสั่งในหัวข้อ 4 ด้วย PowerShell แบบ Administrator แล้วรันไฟล์นี้ซ้ำ')
    }

    if ($HttpOk -gt 0) {
        return @{ Code = 'ok'; Title = 'คนนอกเข้าได้แล้ว'; Next = @() }
    }
    # ไม่มีผล HTTPS = สรุปไม่ได้ แม้ TCP จะต่อได้ — การต่อ TCP เปล่าๆ ไม่ทิ้งร่องรอยใน log ของ Caddy
    # จึงแยกไม่ออกว่าคนรับสายคือ Caddy หรือตัวเราเตอร์ ห้ามเดาว่าเป็นเราเตอร์
    if ($HttpOk -lt 0) {
        return @{ Code = 'unknown'; Title = 'ตรวจ HTTPS จากภายนอกไม่สำเร็จ (check-host.net ไม่ตอบ) — ยังสรุปไม่ได้'
            Next = @('ลองรันใหม่อีกครั้งในอีกสักครู่',
                     "หรือเปิด https://check-host.net/check-http?host=https://$Domain/api/health ในเบราว์เซอร์") }
    }
    if ($Reached -gt 0 -or $TlsErrors -gt 0) {
        return @{ Code = 'reached'; Title = 'request จากข้างนอกมาถึง Caddy ของเราแล้ว แต่ตอบไม่สำเร็จ'
            Next = @('ดูข้อความรายประเทศด้านบน — ถ้าเป็น 5xx ให้ดู docker compose logs app --tail 50',
                     'ถ้าเป็น TLS handshake error ให้ดู docker compose logs caddy --tail 50') }
    }
    if ($TcpOk -gt 0) {
        return @{ Code = 'router-owns-443'; Title = 'พอร์ต 443 เปิดอยู่ แต่คนที่ตอบไม่ใช่ Caddy ของเรา (log ไม่มี request เข้ามาเลย)'
            Next = @('ตัวเราเตอร์ (ONT) น่าจะจองพอร์ต 443 ไว้เป็นหน้าจัดการจากระยะไกล',
                     'เข้าเราเตอร์ → Security Configuration → หา WAN Access / ONT Access Control → ปิด HTTPS ฝั่ง WAN',
                     'แล้วรันไฟล์นี้ซ้ำ') }
    }
    if ($Hairpin -eq 200) {
        return @{ Code = 'blocked-upstream'; Title = 'เราเตอร์ส่งต่อพอร์ต 443 ถูกแล้ว (ยิงผ่าน IP สาธารณะจากในวงได้) แต่จากอินเทอร์เน็ตยังต่อไม่ติด'
            Next = $fwFirst + @('สาเหตุที่เหลือ: AIS บล็อกพอร์ต 443 ขาเข้า หรือ Windows Firewall บล็อกการเชื่อมต่อจากนอกวง LAN',
                     'ถ้า Firewall ผ่านแล้วยังไม่ได้ → โทร AIS 1175 แจ้งว่า "ขอเปิดพอร์ต 443 ขาเข้า สำหรับทำ port forward"') }
    }
    return @{ Code = 'not-forwarded'; Title = 'จากอินเทอร์เน็ตต่อพอร์ต 443 ไม่ติดเลย — traffic ไม่ถึงเครื่องนี้'
        Next = $fwFirst + @('ตรวจ Port Mapping ในเราเตอร์: Enable ติ๊กแล้ว · WAN Name ต้องเป็นตัวที่มีคำว่า INTERNET (ไม่ใช่ TR069/VOIP)',
                 'Internal Host = 192.168.1.125 · Internal/External Port = 443 · Protocol = TCP · กด Apply แล้ว',
                 'ถ้าตั้งถูกทุกช่องแล้วและ Firewall ผ่าน → โทร AIS 1175 ถามว่าบล็อกพอร์ต 443 ขาเข้าหรือไม่') }
}

# อ่านกฎ Windows Firewall ที่เกี่ยวกับพอร์ต 443 / Docker แบบดิบๆ — ตัดสินที่ Get-FirewallVerdict
function Get-FirewallInfo {
    $info = [pscustomobject]@{ Profiles = @(); Rules = @(); Readable = $true }
    try {
        $info.Profiles = @(Get-NetConnectionProfile -ErrorAction Stop | ForEach-Object {
            [pscustomobject]@{ Name = "$($_.InterfaceAlias)"; Category = "$($_.NetworkCategory)" } })
    } catch { }
    $allowIn = { "$($_.Enabled)" -eq 'True' -and "$($_.Direction)" -eq 'Inbound' -and "$($_.Action)" -eq 'Allow' }
    try {
        $byPort = @(Get-NetFirewallPortFilter -All -ErrorAction Stop |
            Where-Object { "$($_.Protocol)" -eq 'TCP' -and (@($_.LocalPort) -contains '443') } |
            Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object $allowIn)
        $byApp = @(Get-NetFirewallApplicationFilter -All -ErrorAction Stop |
            Where-Object { "$($_.Program)" -match 'docker' } |
            Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object $allowIn)
        $seen = @{}
        foreach ($r in (@($byPort) + @($byApp))) {
            if ($seen.ContainsKey("$($r.Name)")) { continue }
            $seen["$($r.Name)"] = $true
            $prog = "$((Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $r -ErrorAction SilentlyContinue).Program)"
            $info.Rules += [pscustomobject]@{ Name = "$($r.DisplayName)"; Profile = "$($r.Profile)"; Program = $prog }
        }
    } catch { $info.Readable = $false }
    return $info
}

# กฎที่ "ใช้ได้จริง" กับ Caddy ใน Docker ต้องครบ 2 ข้อ:
#   1. ครอบคลุมโปรไฟล์ของการ์ดแลนจริง — เครื่องนี้ Ethernet = Public กฎที่เปิดแค่ Private ไม่มีผล
#   2. ไม่ผูกกับโปรแกรมอื่น — เช่นกฎ "World Wide Web Services (HTTPS Traffic-In)" ของ IIS ผูกกับโปรแกรม
#      System จึงเปิด 443 ให้ IIS เท่านั้น ไม่ใช่ Docker (รุ่นแรกนับแค่ "มีกฎพอร์ต 443" เลยรายงานว่าผ่านได้ทั้งที่ไม่ผ่าน)
function Get-FirewallVerdict {
    param($Profiles, $Rules)
    $need = @($Profiles | Where-Object { $_.Name -notmatch 'Tailscale|vEthernet|WSL|Loopback' } |
        ForEach-Object { if ($_.Category -eq 'DomainAuthenticated') { 'Domain' } else { $_.Category } } |
        Select-Object -Unique)
    # ไม่รู้ว่าการ์ดแลนเป็นแบบไหน = ถือว่าแย่สุด (Public)
    if ($need.Count -eq 0) { $need = @('Public') }
    $rows = @()
    foreach ($r in @($Rules)) {
        $progOk = (-not $r.Program) -or ($r.Program -eq 'Any') -or ($r.Program -match 'docker')
        $missing = @($need | Where-Object { $r.Profile -notmatch 'Any' -and $r.Profile -notmatch $_ })
        $why = @()
        if (-not $progOk) { $why += "ผูกกับโปรแกรม $($r.Program) ไม่ใช่ Docker" }
        if ($missing.Count) { $why += "ไม่ครอบคลุมเครือข่ายแบบ $($missing -join '/')" }
        $rows += [pscustomobject]@{ Rule = $r; Usable = ($why.Count -eq 0); Why = ($why -join ' · ') }
    }
    return [pscustomobject]@{ Need = $need; Rows = $rows; AnyUsable = (@($rows | Where-Object Usable).Count -gt 0) }
}

function Show-Rows {
    param($Rows)
    foreach ($r in $Rows) {
        $line = "{0,-28} {1}" -f $r.Node, $r.Text
        if ($r.Ok) { Write-Host "    $line" -ForegroundColor Green }
        elseif ($r.Pending) { Write-Host "    $line" -ForegroundColor DarkGray }
        else { Write-Host "    $line" -ForegroundColor Red }
    }
}

# ================================================================ เริ่มทำงาน

Set-Location $RepoRoot
if (-not $Domain) { $Domain = Read-DotEnv 'DOMAIN' }
if (-not $Domain) { $Domain = 'it-support-admin.duckdns.org' }
$script:Curl = Find-Curl
if (-not $script:Curl) { Write-Fail 'ไม่พบ curl.exe (มีมากับ Windows 10/Server 2019 ขึ้นไป)'; exit 1 }

Write-Host ""
Write-Host "  ตรวจการเข้าถึงจากอินเทอร์เน็ต: https://$Domain/  ($(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))" -ForegroundColor White

# ---- 1. DNS ----
Write-Step '1. DNS ชี้มาที่ออฟฟิศนี้ไหม'
$publicIp = Get-PublicIp
$dnsIps = @(Resolve-PublicIPv4 $Domain)
if (-not $publicIp) { Write-Fail 'หา IP สาธารณะของออฟฟิศไม่ได้ — เครื่องนี้ออกอินเทอร์เน็ตได้ไหม?'; exit 1 }
Write-Info "IP สาธารณะของออฟฟิศ : $publicIp"
Write-Info "DNS ของ $Domain : $(if ($dnsIps.Count) { $dnsIps -join ', ' } else { '(ไม่มีคำตอบ)' })"
if ($dnsIps -contains $publicIp) { Write-Pass 'ตรงกัน' }
elseif ($dnsIps.Count -eq 0) { Write-Warn 'ถาม DNS ไม่ได้ — จะตรวจต่อด้วย IP โดยตรง' }
else { Write-Fail "DNS ชี้ไปที่อื่น — container duckdns ทำงานไหม? (docker compose up -d duckdns แล้วรอ 5 นาที)" }

# ---- 2. Caddy ในเครื่อง ----
Write-Step '2. Caddy ในเครื่องพร้อมไหม'
$local = Get-HealthCode '127.0.0.1'
if ($local -eq 200) {
    Write-Pass 'ตอบ 200 ด้วยใบรับรองที่ถูกต้อง'
} else {
    $insecure = Get-HealthCode '127.0.0.1' -Insecure
    if ($insecure -eq 200) { Write-Fail 'Caddy ตอบ แต่ใบรับรองไม่ถูกต้อง — ดู: docker compose logs caddy --tail 50' }
    else { Write-Fail "Caddy ไม่ตอบ (ได้ $local) — รัน: docker compose up -d caddy" }
    Write-Info 'แก้ข้อนี้ก่อน ตรวจจากภายนอกไปก็ไม่มีประโยชน์'
    exit 1
}

# ---- 3. ให้เครื่องทั่วโลกยิงเข้ามา ----
Write-Step "3. ให้ check-host.net ยิงเข้ามาจาก $Nodes ประเทศ"
$before = Get-CaddyCounts
if (-not $before) { Write-Warn 'อ่าน log ของ Caddy ไม่ได้ — จะยืนยันไม่ได้ว่าใครเป็นคนตอบ' }

$httpJob = Start-ExternalCheck 'http' "https://$Domain/api/health"
$tcpJob = Start-ExternalCheck 'tcp' "${publicIp}:443"
if (-not $httpJob -and -not $tcpJob) {
    Write-Fail 'เรียก check-host.net ไม่ได้'
}

$httpRes = $null; $tcpRes = $null
$deadline = (Get-Date).AddSeconds(60)
Write-Info 'รอผล (ไม่เกิน 1 นาที)...'
do {
    Start-Sleep -Seconds 4
    if ($httpJob) { $httpRes = Get-ExternalResult $httpJob.request_id }
    if ($tcpJob) { $tcpRes = Get-ExternalResult $tcpJob.request_id }
    $done = ((-not $httpJob) -or (Test-ResultComplete $httpRes)) -and ((-not $tcpJob) -or (Test-ResultComplete $tcpRes))
} while (-not $done -and (Get-Date) -lt $deadline)

# รอให้ Caddy เขียน log ของ request สุดท้ายให้เสร็จก่อนนับ
Start-Sleep -Seconds 2
$after = Get-CaddyCounts

$httpRows = @(ConvertFrom-HttpResult $httpRes $(if ($httpJob) { $httpJob.nodes }))
$tcpRows = @(ConvertFrom-TcpResult $tcpRes $(if ($tcpJob) { $tcpJob.nodes }))

Write-Host ""
Write-Info "TCP — ต่อพอร์ต ${publicIp}:443 ได้ไหม:"
if ($tcpRows.Count) { Show-Rows $tcpRows } else { Write-Info '    (ไม่มีผล)' }
Write-Info "HTTPS — เปิด https://$Domain/api/health ได้ไหม:"
if ($httpRows.Count) { Show-Rows $httpRows } else { Write-Info '    (ไม่มีผล)' }

$reached = -1; $tlsErr = 0
if ($before -and $after) {
    $reached = $after.Requests - $before.Requests
    $tlsErr = $after.TlsErrors - $before.TlsErrors
    Write-Host ""
    Write-Info "Caddy ของเราได้รับ request จากข้างนอกระหว่างตรวจ: $reached ครั้ง · TLS handshake error: $tlsErr ครั้ง"
}

# ---- 4. ข้อมูลประกอบ (ยิงหลังนับ log แล้ว จะได้ไม่ปนกับ request จากข้างนอก) ----
$hairpin = Get-HealthCode $publicIp

$httpOk = if ($httpJob) { @($httpRows | Where-Object Ok).Count } else { -1 }
$tcpOk = if ($tcpJob) { @($tcpRows | Where-Object Ok).Count } else { -1 }
$d = Get-Diagnosis -HttpOk $httpOk -TcpOk $tcpOk -Reached $reached -TlsErrors $tlsErr -Hairpin $hairpin

if ($d.Code -ne 'ok') {
    Write-Step '4. ข้อมูลประกอบ'
    if ($hairpin -eq 200) { Write-Info "ยิงจากเครื่องนี้ผ่าน IP สาธารณะ ($publicIp) ได้ 200 — เราเตอร์ส่งต่อพอร์ตให้ (อย่างน้อยจากในวง LAN)" }
    else { Write-Info "ยิงจากเครื่องนี้ผ่าน IP สาธารณะ ไม่ได้ (ได้ $hairpin) — สรุปอะไรไม่ได้ เราเตอร์หลายรุ่นไม่รองรับ NAT loopback" }

    $fw = Get-FirewallInfo
    if ($fw.Profiles.Count) {
        Write-Info ("ประเภทเครือข่ายของ Windows: " + (($fw.Profiles | ForEach-Object { "$($_.Name) = $($_.Category)" }) -join ' · '))
    }
    $firewallOk = $null
    if (-not $fw.Readable) {
        Write-Info 'Windows Firewall: อ่านกฎไม่ได้ (ลองรันแบบ Administrator)'
    } else {
        $fwv = Get-FirewallVerdict $fw.Profiles $fw.Rules
        $firewallOk = $fwv.AnyUsable
        if ($fwv.Rows.Count -eq 0) {
            Write-Warn 'Windows Firewall: ไม่มีกฎอนุญาตขาเข้าสำหรับพอร์ต 443 หรือ Docker เลย'
        } else {
            Write-Info 'Windows Firewall — กฎที่เกี่ยวกับพอร์ต 443 / Docker:'
            foreach ($row in $fwv.Rows) {
                $prog = if ($row.Rule.Program) { $row.Rule.Program } else { 'Any' }
                $desc = "$($row.Rule.Name) · โปรไฟล์: $($row.Rule.Profile) · โปรแกรม: $prog"
                if ($row.Usable) { Write-Host "    [ใช้ได้] $desc" -ForegroundColor Green }
                else { Write-Host "    [ใช้ไม่ได้] $desc — $($row.Why)" -ForegroundColor Yellow }
            }
        }
        if (-not $fwv.AnyUsable) {
            Write-Warn "ยังไม่มีกฎที่เปิดพอร์ต 443 ให้ Docker บนเครือข่ายแบบ $($fwv.Need -join '/') — เปิด PowerShell แบบ Administrator แล้วรัน:"
            Write-Host '    New-NetFirewallRule -DisplayName "IT Support HTTPS (443)" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -Profile Any' -ForegroundColor White
        }
    }

    # ตัดสินใหม่โดยรวมผล Firewall — ถ้ากฎยังไม่พร้อม ต้องแก้ข้อนั้นก่อนไปยุ่งกับเราเตอร์/AIS
    $d = Get-Diagnosis -HttpOk $httpOk -TcpOk $tcpOk -Reached $reached -TlsErrors $tlsErr -Hairpin $hairpin -FirewallOk $firewallOk
}

# ---- สรุป ----
Write-Host ""
Write-Host "============================================================" -ForegroundColor White
if ($d.Code -eq 'ok') {
    Write-Host "  $($d.Title)" -ForegroundColor Green
    Write-Host "    https://$Domain/" -ForegroundColor White
} else {
    Write-Host "  $($d.Title)" -ForegroundColor Red
    foreach ($n in $d.Next) { Write-Host "    - $n" -ForegroundColor Yellow }
}
if ($httpJob) { Write-Host "  ผลตรวจฉบับเต็ม (ส่งให้คนอื่นดูได้): $($httpJob.permanent_link)" -ForegroundColor Gray }
Write-Host "============================================================" -ForegroundColor White
if ($d.Code -eq 'ok') { exit 0 } else { exit 1 }
