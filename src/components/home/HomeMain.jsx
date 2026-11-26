"use client";

import { useGSAP } from "@gsap/react";
import React, { useRef } from "react";
import { TextPlugin } from "gsap/TextPlugin";
import gsap from "gsap";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import Button from "../ui/Button";

gsap.registerPlugin(useGSAP, TextPlugin);

function HomeMain() {
  const heading = useRef();
  const paragraph = useRef();
  const button = useRef();
  const glow = useRef();

  useGSAP(() => {
    // All hero motion is skipped for users who prefer reduced motion.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timeline = gsap.timeline({ delay: 0.3 });
    timeline
      .from(heading.current, {
        y: 40,
        opacity: 0,
        duration: 0.8,
        ease: "power2.out",
      })
      .from(paragraph.current, {
        opacity: 0,
        duration: 0.6,
        ease: "power2.out",
      })
      .from(button.current, {
        opacity: 0,
        y: 20,
        duration: 0.6,
        ease: "power2.out",
      });

    gsap.to(glow.current, {
      scale: 1.15,
      duration: 4,
      ease: "sine.inOut",
      repeat: -1,
      yoyo: true,
    });
  });

  return (
    <main className="relative flex min-h-dvh w-full flex-col items-center justify-center gap-6 px-6 pb-16 pt-20 text-center max-sm:px-4">
      {/* Subtle brand glow behind the hero */}
      <div
        ref={glow}
        aria-hidden
        className="absolute left-1/2 top-1/2 -z-10 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-3xl max-sm:h-56 max-sm:w-56"
      />

      <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-fg-muted">
        Personal learning tracker
      </span>

      <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight text-fg max-sm:text-3xl">
        Master your learning.{" "}
        <span className="text-accent">One task at a time.</span>
      </h1>

      <p ref={paragraph} className="max-w-lg text-base leading-relaxed text-fg-muted">
        Learnary is your personal learning tracker. Create topic-based
        collections, track progress, and stay focused.
      </p>

      <div ref={button} className="flex items-center gap-3">
        <Button as={Link} href="/signup" size="lg">
          Get started
          <ArrowRight size={16} aria-hidden />
        </Button>
        <Button as={Link} href="/signin" size="lg" variant="secondary">
          Sign in
        </Button>
      </div>
    </main>
  );
}

export default HomeMain;
