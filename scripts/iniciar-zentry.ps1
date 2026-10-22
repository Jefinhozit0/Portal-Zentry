# Liga o portal e o túnel do Cloudflare e mantém os dois rodando: se um cair, volta sozinho em até 15 s.
# Roda escondido quando o Windows inicia (veja instalar-inicio-automatico.ps1), mas também pode ser
# usado à mão:  powershell -ExecutionPolicy Bypass -File scripts\iniciar-zentry.ps1
# Os registros ficam na pasta logs\ do projeto.

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logs = Join-Path $root "logs"
New-Item -ItemType Directory -Force $logs | Out-Null
function Log($text) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $text" | Out-File -Append -Encoding utf8 (Join-Path $logs "inicio.log") }

# Outro vigia desta mesma pasta já rodando (a tarefa também roda a cada 5 minutos)? Então não faz nada:
# dois brigariam pelo portal. O vigia de outro portal no mesmo notebook (outra pasta) não conta.
$otherWatcher = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match [regex]::Escape($PSCommandPath) } | Select-Object -First 1
if ($otherWatcher) { exit 0 }

# Porta, métricas do cloudflared e nó próprio do Tailscale vêm do .env. Assim este portal roda no
# mesmo notebook que outro sem brigar pela porta, pelo túnel ou pelo endereço.
function EnvValue($name, $default) {
  $line = Get-Content (Join-Path $root ".env") -ErrorAction SilentlyContinue | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -Last 1
  if ($line) { $value = ($line -split "=", 2)[1].Trim(); if ($value) { return $value } }
  return $default
}
$port = EnvValue "PORT" "3000"
$metrics = EnvValue "CLOUDFLARED_METRICS" "127.0.0.1:20241"
$tsHostname = EnvValue "TAILSCALE_HOSTNAME" ""

# Com TAILSCALE_HOSTNAME, este portal tem o próprio nó do Tailscale (outro tailscaled, sem placa de rede,
# com o estado em %LOCALAPPDATA%\Tailscale-<nome>), e o endereço fica https://<nome>.<tailnet>.ts.net.
# Sem ele, usa o serviço normal do Tailscale.
$tailscale = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $tailscale) { $tailscale = "C:\Program Files\Tailscale\tailscale.exe" }
$tailscaled = Join-Path (Split-Path -Parent $tailscale) "tailscaled.exe"
$tsArgs = @()
$tsDaemon = $null
if ($tsHostname) {
  $tsSocket = "\\.\pipe\tailscaled-$tsHostname"
  $tsArgs = @("--socket=$tsSocket")
}
function StartTailscaleNode {
  $existing = Get-CimInstance Win32_Process -Filter "Name='tailscaled.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match [regex]::Escape("tailscaled-$tsHostname") } | Select-Object -First 1
  if ($existing) { return Get-Process -Id $existing.ProcessId -ErrorAction SilentlyContinue }
  $state = Join-Path $env:LOCALAPPDATA "Tailscale-$tsHostname"
  New-Item -ItemType Directory -Force $state | Out-Null
  $process = Start-Process -FilePath $tailscaled -ArgumentList @("--tun=userspace-networking", "--statedir=$state", "--socket=$tsSocket", "--port=0", "--windows-mode=dev") -WindowStyle Hidden -RedirectStandardError (Join-Path $logs "tailscaled.log") -PassThru
  Start-Sleep -Seconds 5
  return $process
}
$useTailscale = $false
if (Test-Path $tailscale) {
  if ($tsHostname) { $tsDaemon = StartTailscaleNode }
  $funnel = & $tailscale @tsArgs funnel status 2>$null | Out-String
  $useTailscale = $funnel -match "Funnel on" -and $funnel -match ":$port\b"
}

$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) { $cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe" }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node -or (-not $useTailscale -and -not (Test-Path $cloudflared))) {
  Log "Node ou cloudflared não encontrado. Instale os dois e tente de novo."
  exit 1
}

if (-not (Test-Path (Join-Path $root "dist\index.js"))) {
  Log "Gerando o build de produção..."
  & pnpm build *>> (Join-Path $logs "build.log")
}

$env:NODE_ENV = "production"
$env:PORT = $port
$tunnel = $null
$portal = $null
$tunnelDownSince = $null

# Portal já rodando sem vigia (aberto à mão, ou o vigia anterior morreu)? Passa a vigiar esse mesmo,
# em vez de abrir outro: duas cópias brigariam pela sessão do WhatsApp.
$running = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($running) {
  $portal = Get-Process -Id $running.OwningProcess -ErrorAction SilentlyContinue
  Log "Portal já estava rodando (processo $($running.OwningProcess)). Vigiando esse."
}
Log $(if ($useTailscale) { "Iniciando portal (endereço fixo pelo Tailscale Funnel)." } else { "Iniciando portal e túnel." })

# O cloudflared avisa em /ready se está ligado ao Cloudflare (200) ou não (503).
function TunnelReady {
  try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://$metrics/ready").StatusCode -eq 200 } catch { $false }
}

# Fora da tomada o Windows põe o notebook para dormir e o portal sai do ar. A cada volta grava a
# situação em logs\energia.json: o portal mostra "em manutenção" para os clientes e avisa a equipe.
$wasOnline = $true
function CheckPower {
  $online = $true
  try { $online = [bool](Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus -ErrorAction Stop | Select-Object -First 1).PowerOnline } catch {}
  $battery = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
  $minutes = if ($battery -and $battery.EstimatedRunTime -and $battery.EstimatedRunTime -lt 6000) { [int]$battery.EstimatedRunTime } else { $null }
  @{ naTomada = $online; bateria = if ($battery) { [int]$battery.EstimatedChargeRemaining } else { $null }; minutosRestantes = $minutes; em = (Get-Date).ToUniversalTime().ToString("o") } |
    ConvertTo-Json -Compress | Out-File -Encoding utf8 (Join-Path $logs "energia.json")
  if ($online -ne $script:wasOnline) { Log $(if ($online) { "Carregador ligado de volta." } else { "Notebook saiu da tomada (bateria $($battery.EstimatedChargeRemaining)%)." }) }
  $script:wasOnline = $online
}

while ($true) {
  # O túnel temporário pode sumir do lado do Cloudflare ("Tunnel not found"): o cloudflared continua
  # aberto tentando para sempre e o endereço deixa de existir. Sem conexão por 2 minutos: religa.
  if ($tunnel -and -not $tunnel.HasExited -and ((Get-Date) - $tunnel.StartTime).TotalSeconds -gt 60) {
    if (TunnelReady) {
      $tunnelDownSince = $null
    } elseif (-not $tunnelDownSince) {
      $tunnelDownSince = Get-Date
    } elseif (((Get-Date) - $tunnelDownSince).TotalSeconds -ge 120) {
      Log "Túnel sem conexão há 2 minutos. Religando (o endereço vai mudar)."
      Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
      $tunnel.WaitForExit(10000) | Out-Null
      $tunnel = $null
      $tunnelDownSince = $null
    }
  }
  if (-not $useTailscale -and (-not $tunnel -or $tunnel.HasExited)) {
    if ($tunnel) { Log "Túnel caiu (código $($tunnel.ExitCode)). Religando." }
    # --metrics fixo: é por ele que o portal descobre o endereço atual do túnel (APP_URL=auto).
    $tunnel = Start-Process -FilePath $cloudflared -ArgumentList @("tunnel", "--url", "http://localhost:$port", "--metrics", $metrics, "--logfile", (Join-Path $logs "cloudflared.log")) -WindowStyle Hidden -PassThru
  }
  # O nó próprio do Tailscale caiu? Religa: o Funnel volta sozinho, ele fica salvo no estado do nó.
  if ($tsHostname -and $useTailscale -and (-not $tsDaemon -or $tsDaemon.HasExited)) {
    if ($tsDaemon) { Log "Tailscale do portal caiu (código $($tsDaemon.ExitCode)). Religando." }
    $tsDaemon = StartTailscaleNode
  }
  if (-not $portal -or $portal.HasExited) {
    if ($portal) { Log "Portal caiu (código $($portal.ExitCode)). Religando." }
    $out = Join-Path $logs "portal.log"
    $err = Join-Path $logs "portal-erros.log"
    # Guarda o registro da execução anterior antes de começar um novo.
    if (Test-Path $out) { Move-Item -Force $out (Join-Path $logs "portal-anterior.log") }
    if (Test-Path $err) { Move-Item -Force $err (Join-Path $logs "portal-erros-anterior.log") }
    $portal = Start-Process -FilePath $node -ArgumentList "dist/index.js" -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  }
  CheckPower
  Start-Sleep -Seconds 15
}
