import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  badge?: { text: string; variant: "default" | "destructive" | "secondary" | "outline" };
  trend?: "up" | "down" | "stable";
  className?: string;
}

export function KpiCard({ title, value, subtitle, badge, trend, className }: KpiCardProps) {
  return (
    <Card className={cn("relative overflow-hidden", className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {badge && (
          <Badge variant={badge.variant} className="text-[10px] px-1.5 py-0">
            {badge.text}
          </Badge>
        )}
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
