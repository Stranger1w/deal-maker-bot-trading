' ============================================================================
'  LANZADOR SIN VENTANA del ciclo del motor (Deal Maker).
'
'  POR QUE EXISTE
'  La tarea programada de Windows lanzaba powershell.exe cada minuto. Aunque
'  se le pasara -WindowStyle Hidden, la ventana de consola SE CREA y se OCULTA:
'  en el escritorio del usuario eso es un parpadeo de ventanita cada minuto,
'  sin motivo aparente ("aparece de la nada").
'
'  La solucion: ejecutar la tarea con wscript.exe, que es una aplicacion de
'  GUI (no de consola) y por tanto NO crea ninguna ventana. El 0 del final de
'  shell.Run significa "ejecutar sin ventana".
'
'  El script de PowerShell sigue escribiendo su diario en
'  C:\Users\Usuario\secrets\deal-maker-cron.log, asi que no se pierde nada.
' ============================================================================
Option Explicit

Dim shell, fso, rutaScript, comando

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

rutaScript = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "cron-local.ps1")

If Not fso.FileExists(rutaScript) Then
  WScript.Echo "cron-local.vbs: no se encuentra cron-local.ps1 en " & rutaScript
  WScript.Quit 1
End If

' 0 = sin ventana, False = no esperar a que termine.
comando = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & rutaScript & """"
shell.Run comando, 0, False
