/**
 * Central de textos de la seccion Motor.
 *
 * Todos los textos visibles de indicadores, estrategias y avisos viven aqui
 * para poder ajustarlos sin tocar la logica ni los componentes.
 */

export const TEXTOS = {
  motor: {
    titulo: "Motor",
    cuenta: "Cuenta",
    cuentaDemo: "Demo / Testnet",
    cuentaReal: "Real",
    saldoDisponible: "Saldo disponible",
    saldoEnUso: "Saldo en uso por bots",
    cantidadPorOperacion: "Cantidad por operación (USD)",
    modoEjecucion: "Modo de ejecución",
    modoTemporizador: "Temporizador",
    modo247: "24/7",
    horizonte: "Horizonte por trade",
    activo: "Activo de trading",
    autoSeleccion: "Selección automática",
    indicadores: "Indicador técnico",
    riesgo: "Gestión del riesgo",
    estrategia: "Estrategia",
    limiteGanancias: "Límite de ganancias",
    limitePerdidas: "Límite de pérdidas",
    pararConSaldo: "El motor se detendrá con un saldo de",
    empezar: "Empezar a operar",
    detener: "Detener motor",
    cuentaRegresiva: "Queda",
    ultimoTick: "Último tick hace",
    sinTick: "Sin tick recientes",
    tickAtrasado: "Sin tick desde hace más de 2 intervalos",
  },
  confirmaciones: {
    iniciarReal:
      "Vas a operar con dinero real en la cuenta Real. ¿Confirmas que entiendes el riesgo?",
    iniciarDemo: "El motor empezará a simular operaciones.",
    detener: "¿Seguro que quieres detener el motor?",
    pairMissing: "No hay ningún par válido disponible en este momento.",
  },
  estrategias: {
    fixed: {
      nombre: "Cantidad fija",
      riesgo: "bajo",
      descripcionCorta:
        "Opera siempre el mismo monto, sin importar si ganas o pierdes. Es la más predecible y fácil de controlar.",
    },
    conservative: {
      nombre: "Conservadora",
      riesgo: "bajo",
      descripcionCorta:
        "Mantiene el monto base y lo reduce tras pérdidas consecutivas (-25% por cada 2 seguidas, mínimo 25% del base). Vuelve al base tras una ganancia. Prioriza proteger el capital.",
    },
    optimal: {
      nombre: "Óptima",
      riesgo: "medio",
      descripcionCorta:
        "Ajusta el monto según una fracción del capital disponible y el rendimiento reciente: sube un poco tras rachas ganadoras (tope +50%) y baja tras pérdidas. Equilibra crecimiento y protección.",
    },
    aggressive: {
      nombre: "Agresiva",
      riesgo: "alto",
      descripcionCorta:
        "Aumenta el monto tras cada pérdida para recuperarla más rápido (escalado tipo martingala limitado). Una mala racha puede consumir gran parte del capital.",
    },
  },
  estrategiaUI: {
    mostrarDetalles: "Mostrar detalles",
    ocultarDetalles: "Ocultar detalles",
    riesgoNivel: "Riesgo",
    candado: "Requiere aceptación",
    candadoDesbloquear: "Escribe ACEPTO para desbloquear",
    candadoAceptado: "Agresiva desbloqueada",
    requiereTestnet:
      "Solo se puede activar en Demo / Testnet. Pruébala allí antes de usarla en Real.",
    maximoRacha: "Pérdida máxima posible con una racha de 5 pérdidas:",
    suggestedNotRequired: "Sugerido, no obligatorio",
    tablaRacha: "Monto en una racha de pérdidas",
  },
  aiIndicator: {
    titulo: "AI Indicator",
    insufficientData: "Datos insuficientes",
    insufficientDataDetail:
      "Necesita al menos 30 operaciones históricas del bot antes de proponer nada.",
    disclaimer:
      "El rendimiento pasado no garantiza resultados futuros. Esta herramienta no predice precios: resume lo que ya pasó en tus propias operaciones.",
    notPredictive:
      "No es IA predictiva. Lee la tabla de operaciones del propio bot y calcula, por par, indicador, hora del día y horizonte: tasa de acierto, P&L medio, drawdown y número de muestras.",
    samples: "muestras",
    winRate: "acierto",
    avgPnl: "P&L medio",
    drawdown: "drawdown",
    filteredOut: "filtrado por rendimiento negativo",
    suggested: "sugerido",
  },
  indicadores: {
    activar: "Activar",
    seleccionados: "Seleccionados",
    combinacion: "La señal solo se emite si todos los indicadores coinciden en dirección.",
    detalles: {
      queMide: "Qué mide",
      comoSenala: "Cómo genera la señal",
      cuandoFalla: "Cuándo falla",
      parametros: "Parámetros",
      aviso: "Aviso",
    },
    probando: "Probar con historial",
    backtest: {
      titulo: "Probar con historial",
      operaciones: "operaciones",
      retorno: "retorno",
      drawdown: "drawdown",
      acierto: "acierto",
      sinDatos: "No hay historial suficiente para este par y horizonte.",
      enEjecucion: "Procesando historial…",
    },
    common: {
      masDetalles: "Mostrar detalles",
      seleccionar: "Seleccionar",
      seleccionado: "Seleccionado",
    },
  },
  mercados: {
    titulo: "Mercados",
    categorias: "Categorías",
    todos: "Todos",
    cripto: "Cripto",
    forex: "Forex",
    materias: "Materias primas",
    acciones: "Acciones",
    buscador: "Buscar par",
    favoritos: "Favoritos",
    sinFavoritos: "Sin favoritos todavía. Toca la estrella de un par para guardarlo.",
    sinResultados: "Ningún par coincide con el filtro.",
    ordenaPor: "Ordenar por",
    volumen: "Volumen 24h",
    variacion: "Variación 24h",
    puntuacion: "Puntuación",
    lanzarNoDisponible: "Este exchange no ofrece esta categoría de instrumento.",
    grafico: "Gráfico",
    vender: "Vender",
    comprar: "Comprar",
    manualWarning:
      "La compra y venta manual pasan por los mismos límites de riesgo que el motor automático.",
  },
} as const;

export type Textos = typeof TEXTOS;
