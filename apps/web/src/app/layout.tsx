import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AutoRefresh } from "@/components/layout/auto-refresh";
import { TimeframeSelector } from "@/components/layout/timeframe-selector";
import { PageBreadcrumb } from "@/components/layout/page-breadcrumb";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ISP Observatory",
    template: "%s | ISP Observatory",
  },
  description:
    "Continuous ISP speed, latency, and congestion monitoring — holding Hyperoptic accountable with real data.",
  metadataBase: new URL("https://isp.bhanji.dev"),
  openGraph: {
    type: "website",
    siteName: "ISP Observatory",
    title: "ISP Observatory",
    description:
      "Continuous ISP speed, latency, and congestion monitoring — holding Hyperoptic accountable with real data.",
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    title: "ISP Observatory",
    description:
      "Continuous ISP speed, latency, and congestion monitoring — holding Hyperoptic accountable with real data.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <header className="flex h-12 shrink-0 items-center justify-between border-b border-sidebar-border px-3 sm:px-4">
                <div className="flex items-center gap-2">
                  <SidebarTrigger className="-ml-1" />
                  <Separator orientation="vertical" className="mr-2 h-4" />
                  <PageBreadcrumb />
                </div>
                <Suspense>
                  <TimeframeSelector />
                </Suspense>
              </header>
              <main className="flex-1 overflow-auto">
                {children}
              </main>
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
        <AutoRefresh intervalMs={30000} />
      </body>
    </html>
  );
}
