import type { Metadata, Viewport } from "next";
import { Geist, Noto_Serif_Thai, IBM_Plex_Sans_Thai, IBM_Plex_Mono } from "next/font/google";
import RegisterSW from "@/components/pwa/RegisterSW";
import { getAppUrl } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const notoSerifThai = Noto_Serif_Thai({
  subsets: ["thai", "latin"],
  weight: ["500", "600", "700"],
  variable: "--font-serif-th",
});

const plexSansThai = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans-th",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-th",
});

export const metadata: Metadata = {
  title: "Rizance — ผู้ช่วยบัญชีอัจฉริยะสำหรับร้านค้าและบูธ",
  description:
    "บันทึกรายรับ-รายจ่าย สแกนใบเสร็จ วิเคราะห์กำไร ด้วย Rizq AI — รองรับร้านค้า บูธ และส่วนตัว",
  keywords: [
    "บัญชีร้านค้า",
    "AI บัญชี",
    "สแกนใบเสร็จ",
    "บูธขายของ",
    "บันทึกรายรับรายจ่าย",
    "rizance",
    "rizq",
  ],
  openGraph: {
    title: "Rizance — ผู้ช่วยบัญชีอัจฉริยะสำหรับร้านค้าและบูธ",
    description:
      "บันทึกรายรับ-รายจ่าย สแกนใบเสร็จ วิเคราะห์กำไร ด้วย Rizq AI — รองรับร้านค้า บูธ และส่วนตัว",
    type: "website",
  },
  metadataBase: new URL(getAppUrl()),
  alternates: {
    canonical: "/",
  },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Rizance",
  },
};

export const viewport: Viewport = {
  themeColor: "#0e1525",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${geistSans.variable} ${notoSerifThai.variable} ${plexSansThai.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
