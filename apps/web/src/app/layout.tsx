import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppSessionProvider } from "@/components/session-provider";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";
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
  title: "Shadow-Cloud",
  description: "A web-based PBEM game manager for Shadow Empires",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shadowOverrideEnabled = await getShadowOverrideEnabled();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className={`min-h-full flex flex-col font-mono ${shadowOverrideEnabled ? "terminal-override-active" : ""}`}
      >
        {/* CRT scanlines overlay */}
        <div
          aria-hidden="true"
          className="fixed inset-0 pointer-events-none z-50 opacity-10"
          style={{
            background:
              "linear-gradient(to bottom, transparent 50%, var(--terminal-scanline-color) 50%)",
            backgroundSize: "100% 4px",
          }}
        />
        <AppSessionProvider>{children}</AppSessionProvider>
      </body>
    </html>
  );
}
