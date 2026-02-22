import { CheckCircle2, AlertTriangle, AlertCircle, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type VerdictStatus = "healthy" | "degraded" | "poor" | "critical";

interface VerdictMetric {
  label: string;
  value: string;
  subValue?: string;
}

interface VerdictFinding {
  text: string;
  severity?: "critical" | "warn" | "info";
}

interface VerdictCardProps {
  status: VerdictStatus;
  headline: string;
  description?: string;
  findings?: VerdictFinding[];
  metrics?: VerdictMetric[];
  className?: string;
}

const STATUS_CONFIG: Record<
  VerdictStatus,
  { label: string; icon: typeof CheckCircle2; border: string; bg: string; dot: string; text: string; badgeBg: string; badgeBorder: string }
> = {
  healthy: {
    label: "All Clear",
    icon: CheckCircle2,
    border: "border-l-verdict-healthy",
    bg: "bg-verdict-healthy/5",
    dot: "bg-verdict-healthy",
    text: "text-verdict-healthy",
    badgeBg: "bg-verdict-healthy/10",
    badgeBorder: "border-verdict-healthy/20",
  },
  degraded: {
    label: "Minor Issues",
    icon: AlertTriangle,
    border: "border-l-verdict-degraded",
    bg: "bg-verdict-degraded/5",
    dot: "bg-verdict-degraded",
    text: "text-verdict-degraded",
    badgeBg: "bg-verdict-degraded/10",
    badgeBorder: "border-verdict-degraded/20",
  },
  poor: {
    label: "Performance Issues",
    icon: AlertCircle,
    border: "border-l-verdict-poor",
    bg: "bg-verdict-poor/5",
    dot: "bg-verdict-poor",
    text: "text-verdict-poor",
    badgeBg: "bg-verdict-poor/10",
    badgeBorder: "border-verdict-poor/20",
  },
  critical: {
    label: "Action Needed",
    icon: XCircle,
    border: "border-l-verdict-critical",
    bg: "bg-verdict-critical/5",
    dot: "bg-verdict-critical animate-pulse",
    text: "text-verdict-critical",
    badgeBg: "bg-verdict-critical/10",
    badgeBorder: "border-verdict-critical/20",
  },
};

const FINDING_DOT: Record<string, string> = {
  critical: "bg-verdict-critical",
  warn: "bg-verdict-poor",
  info: "bg-muted-foreground/50",
};

export function VerdictCard({ status, headline, description, findings, metrics, className }: VerdictCardProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <Card className={cn("border-l-4 overflow-hidden", config.border, config.bg, className)}>
      <CardContent className="pt-3 pb-3">
        <div className="flex items-start gap-3">
          {/* Left: badge + headline + findings */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[10px] font-medium border", config.text, config.badgeBg, config.badgeBorder)}>
                <Icon className="h-2.5 w-2.5" />
                {config.label}
              </span>
            </div>
            <h2 className="text-base font-semibold tracking-tight">
              {headline}
            </h2>

            {/* Structured findings list */}
            {findings && findings.length > 0 ? (
              <ul className="mt-1.5 space-y-0.5">
                {findings.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground leading-snug">
                    <span className={cn("mt-[5px] h-1.5 w-1.5 rounded-full shrink-0", FINDING_DOT[f.severity ?? "info"])} />
                    {f.text}
                  </li>
                ))}
              </ul>
            ) : description ? (
              <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                {description}
              </p>
            ) : null}
          </div>

          {/* Right: metrics inline */}
          {metrics && metrics.length > 0 && (
            <div className="hidden sm:flex gap-5 shrink-0 border-l border-border/50 pl-5">
              {metrics.map((m) => (
                <div key={m.label} className="text-right">
                  <div className="text-[10px] text-muted-foreground">{m.label}</div>
                  <div className="text-lg font-bold font-mono tracking-tight leading-tight">{m.value}</div>
                  {m.subValue && (
                    <div className="text-[10px] text-muted-foreground font-mono">{m.subValue}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Mobile: metrics below */}
        {metrics && metrics.length > 0 && (
          <div className="flex sm:hidden flex-wrap gap-4 mt-2 pt-2 border-t border-border/50">
            {metrics.map((m) => (
              <div key={m.label}>
                <div className="text-[10px] text-muted-foreground">{m.label}</div>
                <div className="text-base font-bold font-mono tracking-tight">{m.value}</div>
                {m.subValue && (
                  <div className="text-[10px] text-muted-foreground font-mono">{m.subValue}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
