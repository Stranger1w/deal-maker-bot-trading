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

# ── 0) Si el codigo en disco es mas nuevo que el servidor que corre, se
#      reinicia. Sin esto, despues de un build nuevo el navegador carga el JS
#      nuevo y el servidor sigue con el viejo -> "Server function info not
#      found" y la pagina de error.
function Servidor-Desactualizado {
  $salida = Join-Path $raiz ".output\server\index.mjs"
  if (-not (Test-Path $salida)) { return $false }
  $build = (Get-Item $salida).LastWriteTime
  $procesos = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -like "*index.mjs*"
  }
  foreach ($proc in $procesos) {
    try {
      $inicio = (Get-Process -Id $proc.ProcessId -ErrorAction Stop).StartTime
      if ($build -gt $inicio) {
        Escribir "cron-local: hay build nuevo (el servidor lleva el viejo); lo reinicio."
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        return $true
      }
    } catch {
      # El proceso ya no existe: nada que hacer.
    }
  }
  return $false
}

$hayBuildNuevo = Servidor-Desactualizado

# ── 1) ¿Esta el motor escuchando? Si no, se levanta ──────────────────────
# Comprobamos el PUERTO (no una URL): el endpoint del motor solo acepta POST,
# y ademas el puerto abierto es lo que de verdad importa.
function Motor-Vivo {
  $puerto = 3127
  if ($Url -match ":(\d+)/") { $puerto = [int]$Matches[1] }
  $cliente = New-Object System.Net.Sockets.TcpClient
  try {
    $cliente.Connect("127.0.0.1", $puerto)
    return $true
  } catch {
    return $false
  } finally {
    $cliente.Close()
  }
}

if ($hayBuildNuevo -or -not (Motor-Vivo)) {
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

  if ($hayBuildNuevo) {
    Escribir "cron-local: habia build nuevo; he reiniciado el servidor con el codigo de ahora."
  } else {
    Escribir "cron-local: el motor no estaba vivo; lo arranco con el codigo de ahora."
  }  # La salida del servidor va a su propio fichero: si el servidor heredase la
  # salida de esta tarea, el pipeline de quien la lanzo se quedaria colgado
  # esperando al servidor (y asi pasaba).
  $dirLog = Join-Path $raiz "logs"
  if (-not (Test-Path $dirLog)) { New-Item -ItemType Directory -Path $dirLog -Force | Out-Null }
  Start-Process -FilePath "node" -ArgumentList "`"$salida`"" -WorkingDirectory $raiz -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $dirLog "servidor.log") `
    -RedirectStandardError (Join-Path $dirLog "servidor-error.log") | Out-Null

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

# ── 5) Y el escuadron de reconocimiento (mira el mercado y mide su acierto) ─
# El endpoint respeta el ritmo de cada bot (su interval_seconds), asi que
# llamarlo cada minuto no gastan mas API de la que toca.
$urlRecon = $Url -replace "/automation-tick$", "/recon-tick"
try {
  $recon = Invoke-RestMethod -Uri $urlRecon -Method Post -Headers @{ Authorization = "Bearer $secreto" } -TimeoutSec 180
  if ($recon.status -ne "skipped") {
    Escribir "cron-local: reconocimiento bots=$($recon.bots) senales=$($recon.findings) evaluados=$($recon.evaluated) estado=$($recon.status)"
    if ($recon.errors -and $recon.errors.Count -gt 0) {
      Escribir "cron-local: errores del reconocimiento: $($recon.errors -join ' | ')"
    }
  }
} catch {
  # El reconocimiento no es critico: si falla, el trading sigue.
  Escribir "cron-local: el tick de reconocimiento fallo ($($_.Exception.Message))"
}
