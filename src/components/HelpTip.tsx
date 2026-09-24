import { useState } from "react";
import { CircleHelp } from "lucide-react";

import { cn } from "@/lib/utils";

/** Glosario en lenguaje simple para principiantes. */
export const GLOSARIO: Record<string, string> = {
  "win rate": "De cada 100 operaciones, cuántas ganan dinero. 60% = 60 ganan, 40 pierden. Más de 50% ya es bueno.",
  drawdown: "Cuánto bajó tu dinero desde su punto más alto. Si tenías 1000 y ahora 900, el drawdown es 10%.",
  "stop-loss": "Freno de emergencia: si pierdes este %, el bot vende solo. Ej.: 1.5% = con 1000, vende al perder 15.",
  "take-profit": "Meta de ganancia: al llegar a este %, el bot vende y asegura. Ej.: 3% = con 1000, vende al ganar 30.",
  "kill switch": "Botón rojo de pánico: detiene TODOS los bots y mineros de golpe. Queda registrado quién lo pulsó.",
  "piloto automático": "El motor que deja a tus bots operar solos día y noche sin que tu PC esté encendida.",
  demo: "Dinero de mentira para practicar sin riesgo. No ganas ni pierdes de verdad.",
  real: "Dinero DE VERDAD. Requiere tu confirmación + Binance + código del celular. Empieza con poco.",
  testnet: "Copia de Binance para practicar con dinero falso pero precios reales.",
  "par / activo": "Qué monedas compra y vende el bot. BTCUSDT = comprar Bitcoin con dólares digitales (USDT).",
  estrategia: "La 'receta' del bot para decidir cuándo comprar y vender. Ej.: momentum = comprar lo que sube.",
  "campo de entrenamiento": "Simulador rápido con datos pasados, sin arriesgar dinero. Si le va bien aquí, quizá le vaya bien en vivo.",
  "escuadrón de reconocimiento": "Bots espías que solo MIRAN el mercado y avisan. Nunca compran ni venden.",
  "hash rate": "Potencia de tu minero. Más hash = más probabilidad de ganar. Se mide en TH/s, GH/s.",
  pool: "Grupo de mineros que juntan potencia y reparten ganancias. Solo es casi imposible ganar.",
  "pnl / p&l": "Ganancia o pérdida total. Verde = ganando, rojo = perdiendo.",
  capital: "Cuánto dinero le diste a ese bot. No puede usar más que eso.",
  "fondo / tesorería": "Tu caja principal: dinero disponible aún no asignado a bots.",
  "en uso": "Dinero asignado a bots operando. Paúsalos para liberarlo.",
  "2fa / segundo factor": "Código de 6 dígitos de tu celular. Sin esto no retiras ni activas modo real.",
  auditoría: "Libro de registro: quién hizo qué y cuándo.",
  "alerta crítica": "Aviso urgente (bot detenido, Binance bloqueado). Revísalo pronto.",
  "stopped vs paused": "Pausado = descanso, vuelve con 1 clic. Detenido = parado por seguridad; revísalo antes. Ambos pueden entrenar.",
  "al campo": "Mandar el bot al simulador a practicar sin riesgo.",
  "spot / futures": "Spot = compras la moneda de verdad. Futures = apuestas con apalancamiento (más riesgo). Empieza con Spot.",
  "api key": "Contraseña para que la app opere por ti. NUNCA con permiso de retirar: si la roban, no sacan tu dinero.",
  "whitelist de ip": "Solo ciertas computadoras pueden usar tu clave. Bloquea ladrones de otros países.",
  "reconocimiento / hallazgo": "El espía encontró algo (volumen raro, tendencia). Es un aviso, no orden de compra.",
  observaciones: "Datos crudos guardados (precio, volumen). Con miles se entrena a los bots.",
  "promover / aplicar": "Si le fue bien en el simulador, copia su configuración ganadora al bot real.",
  "drawdown semanal": "Si en una semana pierdes más de esto, TODO se detiene solo. Te salva de malas rachas.",
  "pérdida diaria máxima": "Tope de pérdida por día. Al llegar, el bot se apaga hasta mañana.",
  "operaciones demo mínimas": "Prácticas obligatorias en simulador antes del dinero real. Tu red de seguridad.",
};

export function HelpTip({ term, className }: { term: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const text = GLOSARIO[String(term).toLowerCase()] ?? String(term);
  return (
    <span className={cn("relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label={`¿Qué es ${term}?`}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="ml-1 inline-flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-primary"
      >
        <CircleHelp className="size-3.5" />
      </button>
      {open && (
        <span className="absolute left-0 top-5 z-50 w-64 rounded-md border border-border bg-popover p-3 text-xs font-normal normal-case leading-relaxed text-popover-foreground shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

export function FieldHelp({ label, term }: { label: string; term?: string }) {
  return (
    <span className="inline-flex items-center">
      {label}
      <HelpTip term={term ?? label} />
    </span>
  );
}
