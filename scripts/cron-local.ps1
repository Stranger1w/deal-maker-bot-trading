<#
.SYNOPSIS
  Un ciclo del motor + watchdog: si la app no esta viva, la levanta.

.DESCRIPTION
  La app de escritorio (Deal Maker) levanta el servidor en
  http://127.0.0.1:3127 y expone el motor en
  POST /api/public/automation-tick con la cabecera
  Authorization: Bearer <secreto>.

  Este script (lo llama la tarea programada "DealMaker Motor" cada minuto):
    1) comprueba si el motor esta escuchando; si no, arranca el servidor
       compilado (.output) con el entorno del fichero de secretos,
    2) lee el secreto del cron (entorno o app_settings en la base),
    3) llama al endpoint e imprime el resultado.

  ASI el motor se recupera solo: si cierras la app, se reinicia en el
  siguiente minuto. Lo que NO cubre es que el PC este apagado: para eso hace
  falta la nube (ver PARA-TI.md, seccion 5).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\cron-local.ps1
#>
param(
  # URL de la app local (si cambiaste el PORT al arrancar la app, cambialo aqui)
  [string]$Url = "http://127.0.0.1:3127/api/public/automation-tick",
  # Fichero de secretos (fuera del repo, nunca se commitea)
  [string]$Secretos = "C:\Users\Usuario\secrets\deal-maker.env",
  # Diario de este script (la tarea programada corre en segundo plano: sin
  # esto no habria forma de saber que ha pasado)
  [string]$Log = "C:\Users\Usuario\secrets\deal-maker-cron.log",
  # No arrancar el servidor si no esta vivo (por si el owner lo gestiona a mano)
  [switch]$NoArrancar
)

$ErrorActionPreference = "Stop"

# Todo lo que se imprime va tambien al diario (con la hora).
function Escribir([string]$linea) {
  $sello = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  Write-Output $linea
  try {
    Add-Content -LiteralPath $Log -Value "$sello $linea" -Encoding utf8
  } catch {
    # Si el diario no se puede escribir, no es motivo para parar el motor.
  }
}

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

# La raiz del repo es la carpeta que contiene scripts/.
$raiz = Split-Path $PSScriptRoot -Parent
$envVars = Leer-Entorno $Secretos

# ── 1) ¿Esta el motor escuchando? Si no, se levanta ──────────────────────
function Motor-Vivo {
  try {
    $null = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    return $true
  } catch {
    # Un 404 tambien significa "el servidor esta vivo" (solo hay POST).
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -ne 0) { return $true }
    return $false
  }
}

if (-not (Motor-Vivo)) {
  if ($NoArrancar) {
    Escribir "cron-local: el motor no esta vivo y -NoArrancar esta activo."
    exit 3
  }
  $salida = Join-Path $raiz ".output\server\index.mjs"
  if (-not (Test-Path $salida)) {
    Escribir "cron-local: no esta compilado el servidor ($salida). Compila con 'bun run desktop:build'."
    exit 3
  }
  foreach ($clave in $envVars.Keys) {
    if ($clave -eq "VITE_SUPABASE_PUBLISHABLE_KEY") { continue }
    Set-Item -Path "Env:\$clave" -Value $envVars[$clave]
  }
  if (-not (Test-Path "Env:\SUPABASE_PUBLISHABLE_KEY") -and $envVars.ContainsKey("VITE_SUPABASE_PUBLISHABLE_KEY")) {
    $env:SUPABASE_PUBLISHABLE_KEY = $envVars["VITE_SUPABASE_PUBLISHABLE_KEY"]
  }
  $env:PORT = "3127"
  $env:HOST = "127.0.0.1"
  $env:DESKTOP = "1"

  Escribir "cron-local: el motor no estaba vivo; lo arranco."
  Start-Process -FilePath "node" -ArgumentList "`"$salida`"" -WorkingDirectory $raiz -WindowStyle Hidden | Out-Null

  $esperado = 0
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    if (Motor-Vivo) { $esperado = 1; break }
  }
  if ($esperado -eq 0) {
    Escribir "cron-local: el servidor no arranco (mira dist o los logs)."
    exit 3
  }
  Escribir "cron-local: servidor arriba."
}

# ── 2) El secreto del cron ────────────────────────────────────────────────
$secreto = $env:LOVABLE_CRON_SECRET

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
      Escribir "cron-local: no se pudo leer el secreto de la base ($($_.Exception.Message))"
    }
  }
}

if (-not $secreto) {
  Escribir "cron-local: no hay secreto del cron. Genera uno en la app (Ajustes -> Automatizacion -> Motor 24/7) o pon LOVABLE_CRON_SECRET en el entorno."
  exit 2
}

# ── 3) Un ciclo del motor (con reintentos) ─────────────────────────────────
for ($intento = 1; $intento -le 3; $intento++) {
  try {
    $respuesta = Invoke-RestMethod -Uri $Url -Method Post -Headers @{ Authorization = "Bearer $secreto" } -TimeoutSec 120
    $resumen = "estado=$($respuesta.status) bots=$($respuesta.botsProcessed) ordenes=$($respuesta.ordersCreated) errores=$($respuesta.errors)"
    Escribir "cron-local: $resumen"
    if ($respuesta.notes) { Escribir "cron-local: $($respuesta.notes)" }
    if ($respuesta.status -eq "failed") { exit 1 }
    break
  } catch {
    if ($intento -lt 3) {
      Escribir "cron-local: fallo la llamada ($($_.Exception.Message)); reintento en 5 s."
      Start-Sleep -Seconds 5
    } else {
      Escribir "cron-local: fallo la llamada al motor ($($_.Exception.Message))"
      exit 1
    }
  }
}

# ── 4) Y el enjambre de mineria (mide el hash rate real de la maquina) ─────
$urlMineria = $Url -replace "/automation-tick$", "/mining-tick"
try {
  $mineria = Invoke-RestMethod -Uri $urlMineria -Method Post -Headers @{ Authorization = "Bearer $secreto" } -TimeoutSec 120
  Escribir ("cron-local: mineria equipos=$($mineria.workersActualizados) hash=$([math]::Round($mineria.hashRateMaquina)) H/s pagos=$($mineria.payoutsGenerados) errores=$($mineria.errores.Count)")
} catch {
  # La mineria no es critica: si falla, el trading sigue.
  Escribir "cron-local: el tick de mineria fallo ($($_.Exception.Message))"
}
