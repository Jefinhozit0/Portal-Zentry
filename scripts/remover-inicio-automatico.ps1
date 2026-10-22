# Desfaz o instalar-inicio-automatico.ps1: apaga a tarefa e volta a energia como estava antes.
# powershell -ExecutionPolicy Bypass -File scripts\remover-inicio-automatico.ps1

$state = Join-Path $PSScriptRoot "energia-anterior.json"
Unregister-ScheduledTask -TaskName "Portal Zentry" -Confirm:$false -ErrorAction SilentlyContinue
Write-Output "Tarefa 'Portal Zentry' removida."

if (Test-Path $state) {
  $previous = Get-Content $state -Raw | ConvertFrom-Json
  if ($null -ne $previous.standbySeconds) { powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP STANDBYIDLE $previous.standbySeconds }
  if ($null -ne $previous.lidAction) { powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION $previous.lidAction }
  powercfg /setactive SCHEME_CURRENT
  Remove-Item $state
  Write-Output "Energia voltou como estava antes."
}
