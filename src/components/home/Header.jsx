"use client";

import React, { useRef } from "react";
import Link from "next/link";
import Logo from "../ui/Logo";
import Button from "../ui/Button";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);

function Header() {
  const header = useRef();

  useGSAP(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.from(header.current, {
      y: -40,
      duration: 0.6,
      ease: "power2.out",
      opacity: 0,
    });
  });

  return (
    <header
      ref={header}
      className="fixed left-0 top-0 z-20 w-full border-b border-border/60 bg-bg/70 backdrop-blur-md"
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6 max-sm:px-4">
        <Link href="/" className="flex select-none items-center" aria-label="Learnary home">
          <Logo className="h-10 w-auto" />
        </Link>
        <Button as={Link} href="/signin" variant="secondary" size="sm">
          Sign in
        </Button>
      </div>
    </header>
  );
}

export default Header;
