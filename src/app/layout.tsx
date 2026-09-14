import type { Metadata } from "next";
import { Sarabun, Space_Mono } from "next/font/google";
import "./globals.css";

const sarabun = Sarabun({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sarabun",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "IT Admin",
  description: "ระบบจัดการ IT Support Ticket, ทรัพย์สิน และสต็อกอุปกรณ์",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`${sarabun.variable} ${spaceMono.variable}`}>
      <body className="bg-page text-ink antialiased">{children}</body>
    </html>
  );
}
