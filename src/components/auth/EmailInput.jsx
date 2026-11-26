"use client";

import React from "react";
import Input from "../ui/Input";

function EmailInput({ email, setEmail }) {
  return (
    <Input
      id="email"
      label="Email"
      value={email}
      type="email"
      name="email"
      placeholder="you@example.com"
      autoComplete="email"
      required
      onChange={(e) => setEmail(e.target.value)}
    />
  );
}

export default EmailInput;
