<#
.SYNOPSIS
  Instala (o quita) la tarea programada de Windows que llama al motor cada
  minuto mientras la app de escritorio este abierta.

.DESCRIPTION
  La app de escritorio (Deal Maker) levanta el servidor en 127.0.0.1:3127.
  Esta tarea llama a POST /api/public/automation-tick cada minuto, asi que el
  motor avanza solo mientras la app este abierta y el PC encendido.

  AVISO HONESTO: esto NO es 24/7 de verdad. Si el PC se apaga o la app se
  cierra, el motor deja de hablar. Para 24/7 de verdad, despliega la app en
  la nube y pon el cron ahi (ver PARA-TI.md, seccion 5).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-cron-local.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-cron-local.ps1 -Desinstalar
#>
param(
  [switch]$Desinstalar,
  [string]$NombreTarea = "DealMaker Motor",
  [string]$Script = (Join-Path $PSScriptRoot "cron-local.ps1")
)

$ErrorActionPreference = "Stop"

if ($Desinstalar) {
  if (Get-ScheduledTask -TaskName $NombreTarea -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $NombreTarea -Confirm:$false
    Write-Output "Tarea '$NombreTarea' borrada."
  } else {
    Write-Output "No habia ninguna tarea con ese nombre."
  }
  exit 0
}

if (-not (Test-Path $Script)) {
  Write-Output "No encuentro el script $Script"
  exit 1
}

$accion = New-ScheduledTaskAction -Execute "powershell.exe" -Argument (
  "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Script`""
)
$disparador = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $NombreTarea -Action $accion -Trigger $disparador -Settings $ajustes -Description "Deal Maker: llama al motor de trading cada minuto (la app debe estar abierta)" -Force | Out-Null

Write-Output "Tarea '$NombreTarea' creada: cada minuto llama al motor."
Write-Output ""
Write-Output "Para probarla ahora mismo:"
Write-Output "  powershell -NoProfile -ExecutionPolicy Bypass -File `"$Script`""
Write-Output ""
Write-Output "Para quitarla:"
Write-Output "  powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Desinstalar"
Write-Output ""
Write-Output "RECUERDA: la app de escritorio tiene que estar ABIERTA (y el PC encendido)."
