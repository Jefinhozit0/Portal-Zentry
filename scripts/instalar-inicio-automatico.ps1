# Faz o portal e o túnel ligarem sozinhos quando você entra no Windows, e impede o notebook de
# suspender (ou desligar ao fechar a tampa) enquanto estiver na tomada.
# Rodar uma vez:  powershell -ExecutionPolicy Bypass -File scripts\instalar-inicio-automatico.ps1
# Para desfazer: scripts\remover-inicio-automatico.ps1

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "iniciar-zentry.ps1"
$state = Join-Path $PSScriptRoot "energia-anterior.json"

# 1. Tarefa agendada: roda o iniciar-zentry.ps1 escondido a cada logon deste usuário e, de novo, a
#    cada 5 minutos. Enquanto o vigia estiver vivo, o Windows ignora as novas execuções; se ele morrer
#    (já aconteceu depois de uma suspensão), outro assume o portal em até 5 minutos.
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$every5min = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Portal Zentry" -Action $action -Trigger @($atLogon, $every5min) -Settings $settings -Description "Liga o portal Zentry ao entrar no Windows e o religa se o vigia parar." -Force | Out-Null
Write-Output "Tarefa 'Portal Zentry' criada: o portal liga sozinho no próximo logon."

# 2. Energia (só na tomada): nunca suspender e não fazer nada ao fechar a tampa.
#    Guarda os valores atuais para o script de remoção conseguir voltar como estava.
function Read-AcValue($sub, $setting) {
  # powercfg prints the AC value and then the DC value as the last two "0x" lines, in any Windows language.
  $values = @(powercfg /query SCHEME_CURRENT $sub $setting | Select-String "0x[0-9a-fA-F]{8}\s*$")
  if ($values.Count -lt 2) { return $null }
  if ($values[$values.Count - 2].Line -match "0x([0-9a-fA-F]{8})") { return [Convert]::ToInt32($Matches[1], 16) }
  return $null
}
if (-not (Test-Path $state)) {
  @{ standbySeconds = Read-AcValue "SUB_SLEEP" "STANDBYIDLE"; lidAction = Read-AcValue "SUB_BUTTONS" "LIDACTION" } | ConvertTo-Json | Out-File -Encoding utf8 $state
}
powercfg /change standby-timeout-ac 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
Write-Output "Energia na tomada: sem suspensão e sem ação ao fechar a tampa."
