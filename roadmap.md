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
- [x] Panel de métricas honestas por indicador, estrategia, par y hora del día
      (página `/metricas`), con el registro de qué señal produjo cada operación
      (migración `20261022000000`) y el bloque "lo que estas cifras NO demuestran"
- [x] `types.ts` con `user_id` en las 17 tablas que lo tienen (y las 6 tablas/vistas
      que faltaban): el compilador ahora **exige** el dueño en cada insert y en cada
      filtro, y un test guardián cubre los inserts con `as never`
- [x] Indicador y estrategia **por bot** (migración `20261021000000`): cada bot usa
      sus indicadores y su estrategia de tamaño, con su estado de rachas
- [x] Aviso de riesgo obligatorio antes de activar bots reales (queda auditado con
      su versión; si el texto cambia, hay que volver a aceptarlo)
- [x] Take-profit que debe cubrir el coste de ida y vuelta (comisiones + slippage) con
      margen: se rechaza al configurarlo y el motor para el bot que no lo cumple
- [x] Realismo de ejecución: tamaño por riesgo con ATR, filtro de régimen de mercado,
      límite de operaciones por par y enfriamiento tras rachas de pérdidas
      (migración `20261023000000`)
- [x] Backtest que funciona **sin internet** (`--archivo` + `scripts/guardar-velas.ts` + dataset de ejemplo en `datos/`)
- [x] Referencia aleatoria (la misma estrategia con la señal al azar, mismo motor) y
      sensibilidad de parámetros: la estrategia por defecto solo gana al 3 % de las
      aleatorias, o sea, no se distingue del azar
- [x] **Diario del motor**: una línea por bot y ciclo con el motivo (sin señal, filtro
      de régimen, enfriamiento, límite por par, sin sesión, dry-run, límites de
      riesgo…) y la tarjeta que lo muestra en la pestaña Motor (migración
      `20261025000000`)
- [x] Interfaz: sistema visual propio (fondo con halo, superficies con sombra, tokens
      `surface`/`row-subtle`/`kicker`/`metric`), panel rediseñado con bloque de cifras,
      tira de salud y "siguientes pasos", cabeceras con sección y barra superior ligera
- [x] Interfaz amigable e intuitiva: navegación por tareas con el grupo visible,
      glosario con "?" en cada término técnico, estados vacíos que explican qué pasa
      y qué hacer, formularios con ayuda y el panel diciendo qué hacer cuando algo falla
- [ ] Alertas por Telegram ya están (opcional); falta el canal de correo con dominio
      verificado
- [ ] Idempotencia y reintentos con backoff en el envío de órdenes (parcial: ya hay
      clave de idempotencia, manejo del 23505 y reconciliación de la posición; falta
      reconciliar órdenes pendientes)
- [ ] Cron 24/7: **resuelto en dos partes** — en el PC del dueño ya corre (tarea
      programada de Windows, `scripts/cron-local.ps1`, instalada y probada) y para
      24/7 de verdad queda el cron en la nube (`.github/workflows/tick.yml` +
      URL pública del despliegue)
- [x] Prueba de escenario con DOS usuarios: el segundo usuario ya existía en Supabase y
      se comprobó con su sesión real — ve solo su bot, ni `app_settings` (ni el
      secreto del cron) ni las credenciales de Binance (403)
- [x] El motor aguanta que falten las migraciones: todo lo nuevo degrada sin romperse
      (insert de `bot_executions` con reintentos, lectura de `engine_strategies` sin
      columnas nuevas) y la app dice exactamente qué migración falta
- [x] Secreto del cron generable desde la app (`app_settings.cron_secret`), con
      comparación en tiempo constante y endpoints que responden 401 en vez de 500
- [x] La app comprueba el esquema real y muestra qué migraciones faltan (tarjeta
      "Estado de la base de datos") en vez de una lista fija
- [x] Arreglado el bug que hacía pasar las credenciales de Binance por inexistentes
      (la tabla está bloqueada por RLS y se leía desde el navegador)
- [ ] Fase 7: re-cifrar credenciales reales con la clave nueva y apagar flags
