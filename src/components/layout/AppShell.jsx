"use client";

import React, { useContext } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import userContext from "../../context/userContext";
import {
  CalendarCheck,
  Layers,
  MessageCircle,
  TrendingUp,
  UserRound,
} from "lucide-react";
import UserMenu from "./UserMenu";
import Logo from "../ui/Logo";

// Shared shell for every authenticated page: fixed sidebar with primary
// navigation on desktop (lg+), top bar plus bottom tab bar on mobile.
const NAV_ITEMS = [
  { href: "/today", label: "Today", Icon: CalendarCheck },
  { href: "/collection", label: "Learning", Icon: Layers },
  { href: "/tutor", label: "Assistant", Icon: MessageCircle },
  { href: "/progress", label: "Progress", Icon: TrendingUp },
];

const PROFILE_ITEM = { href: "/profile", label: "My Profile", Icon: UserRound };

function isActive(pathname, href) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ href, label, Icon, active }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${
        active
          ? "bg-accent-soft text-accent"
          : "text-fg-muted hover:bg-accent-soft hover:text-fg"
      }`}
    >
      <Icon size={18} aria-hidden />
      <span>{label}</span>
    </Link>
  );
}

function Sidebar() {
  const { user } = useContext(userContext);
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-surface lg:flex">
      <div className="px-4 pb-2 pt-5">
        <Link
          href="/today"
          className="flex select-none items-center px-2"
          aria-label="Learnary home"
        >
          <Logo className="h-9 w-auto" />
        </Link>
      </div>

      <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
        {NAV_ITEMS.map(({ href, label, Icon }) => (
          <NavLink
            key={href}
            href={href}
            label={label}
            Icon={Icon}
            active={isActive(pathname, href)}
          />
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <nav aria-label="Secondary" className="mb-2">
          <NavLink
            href={PROFILE_ITEM.href}
            label={PROFILE_ITEM.label}
            Icon={PROFILE_ITEM.Icon}
            active={isActive(pathname, PROFILE_ITEM.href)}
          />
        </nav>
        <UserMenu user={user} align="left" />
      </div>
    </aside>
  );
}

function TopBar() {
  const { user } = useContext(userContext);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-md lg:hidden">
      <div className="flex h-14 w-full items-center justify-between px-4">
        <Link href="/today" className="flex shrink-0 select-none items-center" aria-label="Learnary home">
          <Logo className="h-9 w-auto" />
        </Link>
        <UserMenu user={user} />
      </div>
    </header>
  );
}

function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-4">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 transition-colors duration-200 ${
                active ? "text-accent" : "text-fg-muted"
              }`}
            >
              <Icon size={20} aria-hidden />
              <span className="text-xs font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function AppShell({ children }) {
  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-accent-fg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>
      <Sidebar />
      <div className="flex min-h-dvh flex-col lg:pl-60">
        <TopBar />
        <main
          id="main-content"
          className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-10 lg:pt-8"
        >
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}

export default AppShell;
