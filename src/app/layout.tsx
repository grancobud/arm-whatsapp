import type { Metadata } from "next";
import { headers } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Space_Grotesk } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { DevTools } from "@/components/dev-tools";
import { brandStyleOverride } from "@/lib/branding";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ARM WhatsApp",
  description:
    "ARM (Agent Relationship Management) para WhatsApp: un agente de IA y tu equipo trabajan juntos la relación con cada cliente — memoria con fuentes, aprobación humana y reactivación con consentimiento.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const brand = brandStyleOverride();
  // Leer el encabezado vuelve dinámicas todas las páginas: una estática saldría sin
  // nonce y sus scripts no correrían. next-themes también escribe un script propio.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="es" suppressHydrationWarning>
      {brand && (
        <head>
          {/* Inline so the brand tint lands on first paint, before hydration. */}
          <style dangerouslySetInnerHTML={{ __html: brand }} />
        </head>
      )}
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} ${spaceGrotesk.variable} font-body antialiased`}
      >
        <ThemeProvider
          nonce={nonce}
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
          <DevTools />
        </ThemeProvider>
      </body>
    </html>
  );
}
