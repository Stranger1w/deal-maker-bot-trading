import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "neutral";

const tones: Record<Tone, string> = {
  success: "bg-success/15 text-success border-success/40",
  warning: "bg-warning/15 text-warning border-warning/40",
  danger: "bg-destructive/15 text-destructive border-destructive/40",
  neutral: "bg-muted text-muted-foreground border-border",
};

export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 tracking-wide",
        tones[tone],
        className,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current opacity-80" />
      {children}
    </span>
  );
}

export const statusTone = (status: string): Tone => {
  if (["running", "mining", "completed", "ok"].includes(status)) return "success";
  if (["paused", "training", "pending", "idle", "ready", "untested"].includes(status))
    return "warning";
  if (["failed", "offline", "stopped"].includes(status)) return "danger";
  return "neutral";
};
