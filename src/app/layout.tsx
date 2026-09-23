import type { Metadata, Viewport } from "next";
import { Inter, IBM_Plex_Sans_Thai, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Inter = ตัวหลักตามที่ต้องการ (ละติน + ตัวเลข)
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

// Inter ไม่มีชุดตัวอักษรไทย ถ้าใส่ตัวเดียวเบราว์เซอร์จะไปหยิบฟอนต์ไทยของระบบมาแทน
// (แต่ละเครื่องหน้าตาไม่เหมือนกัน) จึงคู่ไว้กับ IBM Plex Sans Thai ซึ่งทรงใกล้ Inter ที่สุด
const plexThai = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-plex-thai",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "IT Admin",
  description: "ระบบจัดการ IT Support Ticket, ทรัพย์สิน และสต็อกอุปกรณ์",
};

// ให้เต็มจอบนมือถือจริงๆ และสีแถบ address bar กลืนกับพื้นแอป
export const viewport: Viewport = {
  themeColor: "#060910",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${inter.variable} ${plexThai.variable} ${jetbrains.variable}`}
    >
      <body className="bg-page text-ink antialiased">{children}</body>
    </html>
  );
}
