"use client";

import { usePathname } from "next/navigation";

const PAGE_TITLES: Record<string, string> = {
  "/": "Overview",
  "/latency": "Latency",
  "/throughput": "Speed Tests",
  "/congestion": "Congestion",
  "/traceroute": "Network Path",
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
