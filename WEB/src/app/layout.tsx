import type { Metadata } from "next";
// БЫЛО: import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";


// const geistSans = Geist({
//   variable: "--font-geist-sans",
//   subsets: ["latin"],
// });
// const geistMono = Geist_Mono({
//   variable: "--font-geist-mono",
//   subsets: ["latin"],
// });

export const metadata: Metadata = {
  title: "Samba AD Panel — Управление Active Directory",
  description: "Современная панель управления Samba AD DC — аутентификация, пользователи, группы, DNS, терминал, конструктор задач",
  icons: {
    icon: "/logo_1.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body

        className="antialiased bg-background text-foreground"
      >
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
