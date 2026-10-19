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
- [x] Compuerta de promoción (gate) demo → testnet → real: exige evidencia (P&L neto
      positivo en demo, drawdown dentro del límite, mínimo de operaciones cerradas,
      superar al benchmark), no solo tiempo
- [x] Reconciliación contra el exchange antes de vender: si la posición no cuadra, no se
      manda ninguna orden y queda auditada
- [x] CI (`.github/workflows/ci.yml`): `tsc` + `eslint` + tests en cada push y PR
- [x] Empaquetado Electron en el repo (`desktop/`, `installer.nsh`, `public/icon.ico`,
      scripts `desktop:build` / `dist:win`): el `.exe` se reconstruye desde aquí
- [x] Registro público de usuarios cerrado por defecto (interruptor en `app_settings`
      o variable `PUBLIC_SIGNUP`), con lista cerrada de funciones públicas
- [x] Selector automático de par enganchado al tick (solo testnet) y "Aplicar" manual
- [ ] Panel de métricas honestas por indicador, estrategia, par y hora del día
      (necesita registrar qué señal produjo cada operación: migración + campo)
- [ ] Idempotencia y reintentos con backoff en el envío de órdenes (parcial: ya hay
      clave de idempotencia y manejo del 23505; falta reconciliar órdenes pendientes)
- [ ] Regenerar `types.ts` con `user_id` (ahora mismo el compilador no puede avisar de
      un `user_id` que falte: todo va con `as never`)
- [ ] Cron 24/7 y alternativa de nube gratuita para el motor
- [ ] Fase 7: re-cifrar credenciales reales con la clave nueva y apagar flags
