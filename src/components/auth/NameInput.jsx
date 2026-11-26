"use client";

import React from "react";
import Input from "../ui/Input";

function NameInput({ name, setName }) {
  return (
    <Input
      id="name"
      label="Name"
      value={name}
      type="text"
      name="name"
      placeholder="Your name"
      autoComplete="name"
      required
      onChange={(e) => setName(e.target.value)}
    />
  );
}

export default NameInput;
