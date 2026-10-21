<#
.SYNOPSIS
  Recordatorio: poner la RESEND_API_KEY para que los avisos del motor
  lleguen al correo de la cuenta.

.DESCRIPTION
  Muestra un aviso de Windows con los pasos. Se intenta primero como
  notificacion (toast) y, si eso no va, como ventana propia.

  IMPORTANTE: nada puede quedarse esperando. La notificacion se intenta en
  un proceso aparte con un tiempo maximo (en una tarea programada sin
  escritorio, la llamada a la API de notificaciones se queda colgada), y la
  ventana de respaldo se cierra sola a los 45 segundos. La tarea siempre
  termina sola.

  Se instala como tarea programada "DealMaker Recordatorio Correo" para
  manana a las 10:00. Para quitarla:

    powershell -NoProfile -Command "Unregister-ScheduledTask -TaskName 'DealMaker Recordatorio Correo' -Confirm:`$false"

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\recordatorio-correo.ps1
#>
param(
  # Texto del aviso (se puede cambiar al probarlo).
  [string]$Titulo = "Deal Maker: falta la clave del correo",
  [string]$Mensaje = "Para que los avisos del motor (limites de riesgo, reportes) lleguen a tu Gmail, pon RESEND_API_KEY en C:\Users\Usuario\secrets\deal-maker.env. La clave se saca gratis en resend.com -> API keys. Detalle en PARA-TI.md seccion 10.",
  # Fichero donde se anota que el recordatorio se mostro.
  [string]$Log = "C:\Users\Usuario\secrets\recordatorio-correo.log"
)

$ErrorActionPreference = "Continue"
$mostrado = $false

# ── 1) Notificacion de Windows, con tiempo maximo (nunca se queda colgada) ─
try {
  $trabajo = Start-Job -ScriptBlock {
    param($t, $m)
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
    $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
      [Windows.UI.Notifications.ToastTemplateType]::ToastText02
    )
    $xml = [Windows.Data.Xml.Dom.XmlDocument]::new()
    $xml.LoadXml($template.OuterXml)
    $textos = $xml.GetElementsByTagName("text")
    $textos.Item(0).AppendChild($xml.CreateTextNode($t)) | Out-Null
    $textos.Item(1).AppendChild($xml.CreateTextNode($m)) | Out-Null
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Deal Maker").Show($toast)
    "ok"
  } -ArgumentList $Titulo, $Mensaje

  if (Wait-Job $trabajo -Timeout 8) {
    $r = Receive-Job $trabajo -ErrorAction SilentlyContinue
    if ($r -eq "ok") { $mostrado = $true }
  }
  Remove-Job $trabajo -Force -ErrorAction SilentlyContinue
} catch {
  $mostrado = $false
}

# ── 2) Respaldo: ventana propia que se cierra sola ──────────────────────
if (-not $mostrado) {
  try {
    Add-Type -AssemblyName PresentationFramework | Out-Null
    $ventana = New-Object System.Windows.Window
    $ventana.Title = $Titulo
    $ventana.Width = 560
    $ventana.Height = 210
    $ventana.WindowStyle = "ToolWindow"
    $ventana.Content = New-Object System.Windows.Controls.TextBlock -Property @{
      Text         = $Mensaje
      Margin       = 16
      TextWrapping = "Wrap"
    }
    $temporizador = New-Object System.Windows.Threading.DispatcherTimer
    $temporizador.Interval = [TimeSpan]::FromSeconds(45)
    $temporizador.Add_Tick({
      $temporizador.Stop()
      $ventana.Close()
    }.GetNewClosure())
    $temporizador.Start()
    $ventana.ShowDialog() | Out-Null
    $mostrado = $true
  } catch {
    $mostrado = $false
  }
}

# ── 3) Diario (siempre: para saber que paso) ─────────────────────────────
try {
  $sello = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  Add-Content -LiteralPath $Log -Value "$sello recordatorio: $Titulo (visible: $mostrado)" -Encoding utf8
} catch {
  # El diario es un extra: si no se puede escribir, no pasa nada.
}

if ($mostrado) {
  Write-Output "Recordatorio mostrado."
} else {
  Write-Output "No se pudo mostrar el aviso grafico (queda escrito en el diario)."
}
