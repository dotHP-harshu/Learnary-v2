"use client";

import React, { useContext } from "react";
import { themeContext } from "../../context/ThemeContext";
import { Moon, Sun } from "lucide-react";
import IconButton from "./IconButton";

/**
 * Light/dark toggle (redesign): a real button with `aria-pressed` instead of
 * the sr-only checkbox hack. Icon shows the mode you'll switch *to*, and
 * doubles as the accessible name.
 */
const ThemeToggler = () => {
  const { theme, setTheme } = useContext(themeContext);
  const isDark = theme !== "light";

  return (
    <IconButton
      label="Dark theme"
      aria-pressed={isDark}
      variant="ghost"
      size="md"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun size={20} /> : <Moon size={20} />}
    </IconButton>
  );
};

export default ThemeToggler;
