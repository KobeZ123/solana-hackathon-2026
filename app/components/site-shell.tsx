"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PropsWithChildren } from "react";
import { GridBackground } from "./grid-background";
import { ThemeToggle } from "./theme-toggle";
import { ClusterSelect } from "./cluster-select";
import { WalletButton } from "./wallet-button";

export const NAV_ITEMS = [
  { href: "/", label: "Events", match: (p: string) => p === "/" },
  {
    href: "/events/new",
    label: "Create",
    match: (p: string) => p === "/events/new",
  },
  {
    href: "/network",
    label: "Network",
    match: (p: string) => p.startsWith("/network"),
  },
  {
    href: "/vendor",
    label: "Vendor",
    match: (p: string) => p.startsWith("/vendor"),
  },
  {
    href: "/tickets",
    label: "My tickets",
    match: (p: string) => p.startsWith("/tickets"),
  },
] as const;

function Logo() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 text-sm font-semibold tracking-tight"
    >
      <span
        aria-hidden
        className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-black text-primary-foreground"
      >
        SS
      </span>
      SOLSocial
    </Link>
  );
}

/** Product shell: header, desktop nav, mobile bottom tab bar. */
export function SiteShell({ children }: PropsWithChildren) {
  const pathname = usePathname() ?? "/";

  return (
    <div className="relative min-h-dvh bg-background text-foreground">
      <GridBackground />

      <div className="relative z-10 flex min-h-dvh flex-col">
        <header className="sticky top-0 z-30 border-b border-border-low bg-background/80 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-6">
              <Logo />
              <nav
                className="hidden items-center gap-1 sm:flex"
                aria-label="Main"
              >
                {NAV_ITEMS.map((item) => {
                  const active = item.match(pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition hover:bg-cream ${
                        active ? "bg-cream text-foreground" : "text-muted"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <ClusterSelect />
              <WalletButton />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 sm:px-6 sm:pb-16 sm:pt-10">
          {children}
        </main>

        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border-low bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
        >
          <ul className="mx-auto grid max-w-md grid-cols-5">
            {NAV_ITEMS.map((item) => {
              const active = item.match(pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex h-14 items-center justify-center text-xs font-medium transition ${
                      active ? "text-foreground" : "text-muted"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
