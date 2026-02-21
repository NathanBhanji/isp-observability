"use client";

import { usePathname } from "next/navigation";

const PAGE_TITLES: Record<string, string> = {
  "/": "Overview",
  "/insights": "Insights",
  "/latency": "Latency",
  "/throughput": "Throughput",
  "/correlation": "Correlation",
  "/traceroute": "Network Path",
  "/evidence": "Evidence",
  "/router": "Network Status",
  "/outages": "Outages",
};

export function PageBreadcrumb() {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] || "Dashboard";

  return (
    <span className="text-sm text-muted-foreground">{title}</span>
  );
}
