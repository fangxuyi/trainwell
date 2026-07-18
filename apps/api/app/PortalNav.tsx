"use client";

import { UserButton } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/sessions", label: "Sessions" },
  { href: "/ask", label: "Ask AI" },
  { href: "/credits", label: "Credits" },
];

export function PortalNav() {
  const pathname = usePathname();
  if (pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up")) return null;

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#070A11]/82 backdrop-blur-xl">
      <nav className="mx-auto flex h-[4.5rem] max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/sessions" className="group flex shrink-0 items-center gap-3">
          <Image
            src="/trainwell-icon.svg"
            alt=""
            width={36}
            height={36}
            priority
            className="size-9 rounded-[13px] shadow-[0_0_30px_rgba(199,243,107,0.14)]"
          />
          <span className="hidden sm:block">
            <span className="block text-[0.68rem] font-black tracking-[0.22em] text-[#C7F36B]">TRAINWELL</span>
            <span className="mt-0.5 block text-[0.63rem] font-medium text-[#667085]">Training intelligence</span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-1 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-1 sm:ml-6">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-xl px-3 py-2 text-xs font-bold transition sm:px-4 ${
                  active
                    ? "bg-[#202736] text-[#F5F7FA] shadow-sm"
                    : "text-[#9CA7B8] hover:bg-white/[0.04] hover:text-[#F5F7FA]"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="ml-1 flex size-10 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.035]">
          <UserButton
            appearance={{
              elements: {
                avatarBox: "size-7",
              },
            }}
          />
        </div>
      </nav>
    </header>
  );
}
