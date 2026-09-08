# Roadmap

- [x] Empaquetado Electron: configuración, scripts dev/build, ventana nativa segura (contextIsolation, sin Node en la UI)
- [x] Distribución nativa: instalador NSIS (Windows) con accesos directos y desinstalador; DMG (macOS) con arrastre a /Applications
- [x] Iconos, appId y nombres de producto
- [x] README con requisitos, comandos por plataforma y limitación de compilación cruzada
- [x] Web sigue funcionando sin cambios
- [x] Riesgo por bot (stop-loss/take-profit obligatorios, drawdown diario y semanal, topes de capital, máx. operaciones)
- [x] Riesgo global del Escuadrón: capital total, concentración por par, drawdown semanal
- [x] Kill switch global persistente con confirmación, auditoría y estado en Dashboard
- [x] Alertas in-app + reportes diario/semanal (email honesto: pendiente de dominio verificado)
- [x] Autenticación con 2FA real; retiros y Demo→Real bloqueados sin `aal2`
- [x] Validación Demo→Real con criterios y benchmark buy-and-hold
- [x] Política de capital: reinversión o reserva semanal vía cron de mantenimiento
- [x] Tablas ordenables con búsqueda en Fondos, Escuadrón y Enjambre
- [x] Escuadrón de Reconocimiento (bots, dataset compartido, hallazgos, alertas y auditoría)
- [x] Capa de IA multi-plataforma modular con fuentes y rangos en el reporte de entrenamiento
