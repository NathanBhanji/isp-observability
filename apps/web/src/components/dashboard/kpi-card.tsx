import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  badge?: { text: string; variant: "default" | "destructive" | "secondary" | "outline" | "warning" };
  trend?: "up" | "down" | "stable";
  className?: string;
  metric?: string; // e.g. "P50", "Mean", "Latest"
}

function BadgeComponent({ badge }: { badge: NonNullable<KpiCardProps["badge"]> }) {
  // Map warning variant to a custom style since shadcn Badge doesn't have "warning"
  if (badge.variant === "warning") {
    return (
      <span className="inline-flex items-center rounded-md px-1.5 py-0 text-[10px] font-medium bg-warning/15 text-warning border border-warning/30">
        {badge.text}
      </span>
    );
  }
  return (
    <Badge variant={badge.variant as any} className="text-[10px] px-1.5 py-0">
      {badge.text}
    </Badge>
  );
}

export function KpiCard({ title, value, subtitle, badge, trend, className, metric }: KpiCardProps) {
  return (
    <Card className={cn("relative overflow-hidden", className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          {metric && (
            <span className="text-[10px] font-mono text-muted-foreground/60">
              ({metric})
            </span>
          )}
        </div>
        {badge && <BadgeComponent badge={badge} />}
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono tracking-tight">
            {value}
          </span>
          {trend && (
            <span
              className={cn(
                "text-xs font-medium",
                trend === "up" && "text-destructive",
                trend === "down" && "text-success",
                trend === "stable" && "text-muted-foreground"
              )}
            >
              {trend === "up" ? "\u2191" : trend === "down" ? "\u2193" : "\u2192"}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
