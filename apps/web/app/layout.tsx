import "./globals.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { CommandPalette } from "@/components/command-palette";
import { ShortcutsModal } from "@/components/shortcuts-modal";
import { DemoBanner } from "@/components/demo-banner";
import { TooltipProvider } from "@/components/ui/tooltip";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "NexusAI — Autonomous AI Agent OS", template: "%s · NexusAI" },
  description: "Build, deploy, and orchestrate autonomous AI agents with enterprise-grade safety.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="font-sans">
        <TooltipProvider delayDuration={250}>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
              <DemoBanner />
              <Topbar />
              <main className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-7xl px-8 py-8 animate-fade-in">
                  {children}
                </div>
              </main>
            </div>
          </div>
          <CommandPalette />
          <ShortcutsModal />
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              style: {
                background: "hsl(240 5% 10%)",
                border: "1px solid hsl(240 4% 16%)",
                color: "hsl(0 0% 98%)",
              },
            }}
          />
        </TooltipProvider>
      </body>
    </html>
  );
}
