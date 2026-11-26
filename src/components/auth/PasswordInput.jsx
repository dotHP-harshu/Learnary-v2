"use client";

import React, { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import IconButton from "../ui/IconButton";
import { INPUT_CLASS } from "../ui/Input";

/**
 * Password field with an accessible reveal toggle. The toggle keeps a stable
 * accessible name ("Show password") and uses aria-pressed for its state —
 * the name must not flip, or the pressed state reads as a contradiction.
 *
 * `type` is derived from state on purpose. Mutating `input.type` directly and
 * calling setState looks like it works, but React re-applies the rendered
 * `type` prop on the resulting re-render and the field snaps back to
 * `password` — the reveal never sticks.
 */
function PasswordInput({
  password,
  setPassword,
  label = "Password",
  autoComplete = "current-password",
  ...props
}) {
  const inputId = useId();
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-fg">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          className={`${INPUT_CLASS} pr-11`}
          value={password}
          type={isVisible ? "text" : "password"}
          name="password"
          placeholder="Your password"
          autoComplete={autoComplete}
          required
          onChange={(e) => setPassword(e.target.value)}
          {...props}
        />
        <IconButton
          label="Show password"
          aria-pressed={isVisible}
          variant="ghost"
          size="sm"
          className="absolute right-1.5 top-1/2 -translate-y-1/2"
          onClick={() => setIsVisible((visible) => !visible)}
        >
          {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
        </IconButton>
      </div>
    </div>
  );
}

export default PasswordInput;
