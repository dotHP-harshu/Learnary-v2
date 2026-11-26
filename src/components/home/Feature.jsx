"use client";

import { useGSAP } from "@gsap/react";
import React, { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Card from "../ui/Card";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * Landing feature card (redesign): clean icon + title + description card,
 * replacing the hover slide-up overlay (which hid the description by default
 * and used a novelty cursor).
 */
function Feature({ icon, heading, description }) {
  const cardRef = useRef();

  useGSAP(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.from(cardRef.current, {
      y: 24,
      duration: 0.6,
      opacity: 0,
      ease: "power2.out",
      scrollTrigger: {
        trigger: cardRef.current,
        start: "top 95%",
        toggleActions: "play none none reverse",
      },
    });
  });

  return (
    <div ref={cardRef}>
      <Card interactive className="flex h-full flex-col gap-3 p-6 text-left">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft">
          {icon}
        </span>
        <h2 className="text-base font-semibold text-fg">{heading}</h2>
        <p className="text-sm leading-relaxed text-fg-muted">{description}</p>
      </Card>
    </div>
  );
}

export default Feature;
