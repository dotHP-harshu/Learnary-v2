"use client";

import React, { useRef } from "react";
import Header from "./Header";
import HomeMain from "./HomeMain";
import FeatureContainer from "./FeatureContainer";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

function Home() {
  const footerRef = useRef();

  useGSAP(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.from(footerRef.current, {
      y: 16,
      opacity: 0,
      duration: 0.6,
      ease: "power2.out",
      scrollTrigger: {
        trigger: footerRef.current,
        start: "top bottom",
        toggleActions: "play none none reverse",
      },
    });
  });

  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <HomeMain />
      <FeatureContainer />

      <footer className="border-t border-border py-6 text-center">
        <p className="text-sm text-fg-muted">
          Built by <span className="font-medium text-accent">DotHP</span>
        </p>
      </footer>
    </div>
  );
}

export default Home;
