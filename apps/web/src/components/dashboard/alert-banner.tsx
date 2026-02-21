import { AlertTriangle, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import Link from "next/link";

export interface AlertItem {
  severity: "warning" | "critical";
  title: string;
  description: string;
  action?: string;
  actionHref?: string;
  items?: string[];
}

interface AlertBannerProps extends AlertItem {
  className?: string;
}

interface AlertGroupProps {
  alerts: AlertItem[];
  className?: string;
}

const SEVERITY_CONFIG = {
  warning: {
    icon: AlertTriangle,
    border: "border-warning/30",
    bg: "bg-warning/5",
    title: "text-warning",
    iconColor: "text-warning",
  },
  critical: {
    icon: AlertCircle,
    border: "border-destructive/30",
    bg: "bg-destructive/5",
    title: "text-destructive",
    iconColor: "text-destructive",
  },
};

function AlertRow({ severity, title, description, action, actionHref, items }: AlertItem) {
  const config = SEVERITY_CONFIG[severity];
  const Icon = config.icon;

  return (
    <div className="flex items-start gap-2.5">
      <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", config.iconColor)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className={cn("text-xs font-semibold", config.title)}>{title}</p>
          {action && actionHref && (
            <Link
              href={actionHref}
              className={cn(
                "inline-flex items-center gap-0.5 text-[11px] font-medium hover:underline",
                config.title
              )}
            >
              {action} &rarr;
            </Link>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          {description}
        </p>
        {items && items.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
            {items.map((item, i) => (
              <span key={i} className="text-[11px] text-muted-foreground flex items-center gap-1">
                <span className="text-muted-foreground/50">&#8226;</span>
                {item}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Single alert card — use when you have exactly one alert */
export function AlertBanner({
  severity,
  title,
  description,
  action,
  actionHref,
  items,
  className,
}: AlertBannerProps) {
  const config = SEVERITY_CONFIG[severity];

  return (
    <Card className={cn("border", config.border, config.bg, className)}>
      <CardContent className="pt-3 pb-3">
        <AlertRow severity={severity} title={title} description={description} action={action} actionHref={actionHref} items={items} />
      </CardContent>
    </Card>
  );
}

/** Multiple alerts merged into one card with dividers — use when 2+ alerts */
export function AlertGroup({ alerts, className }: AlertGroupProps) {
  if (alerts.length === 0) return null;
  if (alerts.length === 1) {
    return <AlertBanner {...alerts[0]} className={className} />;
  }

  // Use the most severe alert's styling for the card border
  const hasCritical = alerts.some((a) => a.severity === "critical");
  const cardConfig = SEVERITY_CONFIG[hasCritical ? "critical" : "warning"];

  return (
    <Card className={cn("border", cardConfig.border, cardConfig.bg, className)}>
      <CardContent className="pt-3 pb-3">
        <div className="space-y-2.5">
          {alerts.map((alert, i) => (
            <div key={i} className={cn(i > 0 && "pt-2.5 border-t border-border/40")}>
              <AlertRow {...alert} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
