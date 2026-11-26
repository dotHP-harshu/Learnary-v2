"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, UserRound } from "lucide-react";
import Signout from "./Signout";
import ThemeToggler from "../ui/ThemeToggler";
import IconButton from "../ui/IconButton";

// Avatar button in the app shell: dropdown with account details, theme
// toggle, "My Profile" shortcut and sign-out. /settings redirects to /profile.
function UserMenu({ user, align = "right" }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const displayName =
    user?.user_metadata?.display_name || user?.user_metadata?.name || "";
  const email = user?.email || "";
  const initial = (displayName || email || "?").charAt(0).toUpperCase();

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-label="Open account menu"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded-full border border-transparent p-1 pr-1.5 transition-colors duration-200 hover:border-border"
      >
        <span
          aria-hidden
          className="flex h-8 w-8 select-none items-center justify-center rounded-full bg-accent-strong text-sm font-semibold text-accent-fg"
        >
          {initial}
        </span>
        <ChevronDown
          size={14}
          className={`text-fg-muted transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      {isOpen && (
        <div
          role="group"
          aria-label="Account"
          className={`absolute bottom-full z-50 mb-2 w-56 rounded-lg border border-border bg-surface-raised p-2 shadow-lg ${
            align === "left" ? "left-0" : "right-0"
          }`}
        >
          <div className="border-b border-border px-3 py-3">
            <p className="truncate text-sm font-semibold capitalize text-fg">
              {displayName || "Your account"}
            </p>
            <p className="truncate text-xs text-fg-muted">
              {email || "Signed in"}
            </p>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-sm text-fg-muted">Theme</span>
            <ThemeToggler />
          </div>
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              router.push("/profile");
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-fg transition-colors duration-200 hover:bg-accent-soft"
          >
            <UserRound size={16} aria-hidden />
            My Profile
          </button>
          <Signout />
        </div>
      )}
    </div>
  );
}

export default UserMenu;
