$out = @()

# 1) Port 3306
$p = Get-NetTCPConnection -LocalPort 3306 -State Listen -ErrorAction SilentlyContinue
if ($p) { $out += "PORT_3306_LISTENING" } else { $out += "PORT_3306_FREE" }

# 2) Services
$svc = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'mysql|maria' }
if ($svc) { $svc | ForEach-Object { $out += "SERVICE: $($_.Name) = $($_.Status)" } } else { $out += "NO_MYSQL_SERVICE" }

# 3) Common install paths
$paths = @("C:\Program Files\MySQL","C:\Program Files (x86)\MySQL","C:\xampp\mysql\bin","C:\ProgramData\MySQL","C:\laragon\bin\mysql")
$foundPath = $false
foreach ($pp in $paths) { if (Test-Path $pp) { $out += "PATH_FOUND: $pp"; $foundPath = $true } }
if (-not $foundPath) { $out += "NO_MYSQL_PATH" }

# 4) mysql/mysqld on PATH
$m = Get-Command mysql -ErrorAction SilentlyContinue
$md = Get-Command mysqld -ErrorAction SilentlyContinue
if ($m) { $out += "MYSQL_BIN: $($m.Source)" } else { $out += "MYSQL_BIN: none" }
if ($md) { $out += "MYSQLD_BIN: $($md.Source)" } else { $out += "MYSQLD_BIN: none" }

# 5) Docker
$d = Get-Command docker -ErrorAction SilentlyContinue
if ($d) { $out += "DOCKER: $($d.Source)" } else { $out += "DOCKER: none" }

# 6) winget (for possible install)
$w = Get-Command winget -ErrorAction SilentlyContinue
if ($w) { $out += "WINGET: yes" } else { $out += "WINGET: no" }

# 7) admin rights
$adm = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$out += "ADMIN: $adm"

$out | Set-Content -Path "d:\KR&BR\kr-br\backend\_envcheck.out" -Encoding UTF8
