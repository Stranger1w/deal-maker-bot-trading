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
- [x] Multiusuario Fase 3 (código): `user_id` en todas las escrituras, lecturas siempre por
      dueño, `engine_sessions` por usuario, topes propios por usuario y test guardián que
      impide volver a leer una tabla "una fila por usuario" sin filtrar
- [x] Alertas, motor y reportes reparados tras `user_id NOT NULL` (el 14-oct los dejó rotos)
- [x] Motor de backtesting con las mismas funciones que el motor en vivo (indicadores y
      estrategias puras), con comisiones, slippage, `stepSize`/`minNotional`, métricas
      honestas, benchmark comprar-y-mantener y walk-forward
- [x] Los indicadores mandan de verdad: el motor calcula la señal con `senalDe` (antes solo
      se usaba en los tests) y el modo Demo pasa a ser paper trading con precio real
- [x] Configuración del motor en la UI (indicadores, estrategia, horizonte, importe)
- [ ] Compuerta de promoción (gate) demo → testnet → real con umbrales mínimos
- [ ] Idempotencia y reconciliación de órdenes contra el exchange
- [ ] Panel de métricas honestas por indicador, estrategia, par y hora
- [ ] CI que corra `tsc`, `eslint` y los tests antes de cada push
- [ ] Empaquetado Electron (`.exe`): falta la carpeta `desktop/` en el repo

