import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BFX AURUM v18 — بوت الذهب XAUUSD",
  description: "بوت تداول الذهب XAUUSD وفق دليل هندسة الهيكل الفني: 15 استراتيجية (A-O)، محرك هيكل سوقي، باك تيست على شموع MT5 الحقيقية",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className="antialiased bg-[#0a0e17] text-[#e9edf4]" style={{ fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
