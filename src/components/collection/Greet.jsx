"use client";

import React from "react";

/**
 * Personalized greeting text (no heading markup — the page's PageHeader owns
 * the <h1>). Used as the title of the Collection and Dashboard pages.
 */
function Greet({ user }) {
  const name =
    user?.user_metadata?.display_name || user?.user_metadata?.name;
  return name ? `Hi, ${name}` : "Hi there";
}

export default Greet;
