<#
.SYNOPSIS
  Llama al motor (un ciclo) en la app de escritorio local.

.DESCRIPTION
  La app de escritorio (Deal Maker) levanta el servidor en
  http://127.0.0.1:3127 y expone el motor en
  POST /api/public/automation-tick con la cabecera
  Authorization: Bearer <secreto>.

  Este script:
    1) lee el secreto del cron (variable de entorno o app_settings en la base),
    2) llama al endpoint e imprime el resultado.

  Es lo que usa la tarea programada de Windows (ver instalar-cron-local.ps1)
  para que el motor avance solo mientras la app este abierta.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\cron-local.ps1
#>
param(
  # URL de la app local (si cambiaste el PORT al arrancar la app, cambialo aqui)
  [string]$Url = "http://127.0.0.1:3127/api/public/automation-tick",
  # Fichero de secretos (fuera del repo, nunca se commitea)
  [string]$Secretos = "C:\Users\Usuario\secrets\deal-maker.env"
)

$ErrorActionPreference = "Stop"

function Leer-Entorno([string]$ruta) {
  if (-not (Test-Path $ruta)) { return @{} }
  $salida = @{}
  foreach ($linea in Get-Content $ruta) {
    if ($linea -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $salida[$Matches[1]] = $Matches[2].Trim()
    }
  }
  return $salida
}

# 1) El secreto: primero el entorno, luego la base (app_settings.cron_secret).
$secreto = $env:LOVABLE_CRON_SECRET
$envVars = Leer-Entorno $Secretos

if (-not $secreto) {
  # OJO: en PowerShell los nombres de variable NO distinguen mayusculas, asi que
  # esta variable no puede llamarse $url (pisaria el parametro $Url del motor).
  $supabaseUrl = $envVars["SUPABASE_URL"]
  $clave = $envVars["SUPABASE_SERVICE_ROLE_KEY"]
  if ($supabaseUrl -and $clave) {
    $cabeceras = @{ apikey = $clave; Authorization = "Bearer $clave" }
    try {
      # User-Agent propio: con el de PowerShell la pasarela de Supabase
      # responde 401 a las claves nuevas (sb_secret_...).
      $fila = Invoke-RestMethod -Uri "$supabaseUrl/rest/v1/app_settings?key=eq.cron_secret&select=value" -Headers $cabeceras -UserAgent "DealMaker/1.0 (cron-local)" -Method Get
      if ($fila -and $fila.Count -gt 0) { $secreto = [string]$fila[0].value }
    } catch {
      Write-Output "cron-local: no se pudo leer el secreto de la base ($($_.Exception.Message))"
    }
  }
}

if (-not $secreto) {
  Write-Output "cron-local: no hay secreto del cron. Genera uno en la app (Ajustes -> Automatizacion -> Motor 24/7) o pon LOVABLE_CRON_SECRET en el entorno."
  exit 2
}

# 2) Un ciclo del motor (con dos reintentos: si la app se esta reiniciando,
#    el primer intento puede fallar).
$ok = $false
for ($intento = 1; $intento -le 3 -and -not $ok; $intento++) {
  try {
    $respuesta = Invoke-RestMethod -Uri $Url -Method Post -Headers @{ Authorization = "Bearer $secreto" } -TimeoutSec 120
    $resumen = "estado=$($respuesta.status) bots=$($respuesta.botsProcessed) ordenes=$($respuesta.ordersCreated) errores=$($respuesta.errors)"
    Write-Output "cron-local: $resumen"
    if ($respuesta.notes) { Write-Output "cron-local: $($respuesta.notes)" }
    if ($respuesta.status -eq "failed") { exit 1 }
    $ok = $true
  } catch {
    if ($intento -lt 3) {
      Start-Sleep -Seconds 5
    } else {
      Write-Output "cron-local: fallo la llamada al motor ($($_.Exception.Message))"
      exit 1
    }
  }
}
