import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Trainwell Portal",
  description: "Your workout history and AI insights",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
        <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100 antialiased">
          <header className="border-b border-zinc-800 sticky top-0 z-50 bg-zinc-950/90 backdrop-blur">
            <nav className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-6">
              <Link href="/sessions" className="font-semibold text-sky-400 hover:text-sky-300 transition-colors">
                Trainwell
              </Link>
              <div className="flex items-center gap-4 text-sm">
                <Link href="/sessions" className="text-zinc-400 hover:text-zinc-100 transition-colors">
                  Sessions
                </Link>
                <Link href="/ask" className="text-zinc-400 hover:text-zinc-100 transition-colors">
                  Ask AI
                </Link>
              </div>
              <div className="ml-auto">
                <UserButton />
              </div>
            </nav>
          </header>
          <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">
            {children}
          </main>
        </body>
      </html>
    </ClerkProvider>
  );
}
