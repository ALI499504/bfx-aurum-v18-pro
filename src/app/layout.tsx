import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BFX AURUM v18 — بوت الذهب XAUUSD",
  description: "بوت تداول الذهب XAUUSD وفق دليل هندسة الهيكل الفني: 15 استراتيجية (A-O)، محرك هيكل سوقي، باك تيست على شموع MT5 الحقيقية",
  // الشعار المعتمد: رأس الثور — متجهي أولاً (حاد في كل المقاسات) مع PNG احتياطي
  // للمتصفحات التي لا تدعم SVG في التبويب
  icons: {
    icon: [
      { url: "/bull.svg", type: "image/svg+xml" },
      { url: "/icon.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
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
