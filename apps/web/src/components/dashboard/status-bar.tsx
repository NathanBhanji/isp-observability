import { Badge } from "@/components/ui/badge";

interface StatusBarProps {
  collectorStatus: any;
}

export function StatusBar({ collectorStatus }: StatusBarProps) {
  const isOnline = collectorStatus !== null;
  const uptime = collectorStatus?.uptime
    ? formatUptime(collectorStatus.uptime)
    : "N/A";

  const collectors = collectorStatus?.collectors || {};
  const totalCollectors = Object.keys(collectors).length;
  const activeCollectors = Object.values(collectors).filter(
    (c: any) => c.lastRun !== null
  ).length;
  const errorCollectors = Object.values(collectors).filter(
    (c: any) => c.errorCount > 0
  ).length;

  return (
    <div className="flex items-center gap-4 px-6 py-3 border-b border-border bg-card/50">
      <div className="flex items-center gap-2">
        <div
          className={`h-2 w-2 rounded-full ${
            isOnline ? "bg-success animate-pulse" : "bg-destructive"
          }`}
        />
        <span className="text-xs font-medium">
          {isOnline ? "Collector Online" : "Collector Offline"}
        </span>
      </div>

      <div className="h-3 w-px bg-border" />

      <span className="text-xs text-muted-foreground font-mono">
        Uptime: {uptime}
      </span>

      <div className="h-3 w-px bg-border" />

      <span className="text-xs text-muted-foreground">
        {activeCollectors}/{totalCollectors} collectors active
      </span>

      {errorCollectors > 0 && (
        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
          {errorCollectors} errors
        </Badge>
      )}

      <div className="ml-auto text-xs text-muted-foreground font-mono">
        {new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </div>
    </div>
  );
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
