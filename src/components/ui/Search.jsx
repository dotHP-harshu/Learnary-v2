"use client";

import React, { useId, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { INPUT_CLASS } from "./Input";

/**
 * Accessible filter search. Controlled when `value`/`onValueChange` are
 * provided (so it can compose with other filters); otherwise it keeps its
 * own state and reports matches to `setArray` as before.
 */
function Search({ array, setArray, label = "Search", value, onValueChange }) {
  const [internal, setInternal] = useState("");
  const inputId = useId();
  const controlled = onValueChange !== undefined;
  const text = controlled ? (value ?? "") : internal;

  const handleSearch = (e) => {
    const input = e.target.value;
    if (controlled) {
      onValueChange(input);
      return;
    }
    setInternal(input);
    const updatedArr = array.filter((a) =>
      a.title.toLowerCase().includes(input.toLowerCase())
    );
    setArray(updatedArr);
  };

  return (
    <div className="relative w-full max-w-sm">
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <SearchIcon
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
        aria-hidden
      />
      <input
        id={inputId}
        type="search"
        onChange={handleSearch}
        value={text}
        placeholder={label}
        className={`${INPUT_CLASS} pl-9 pr-3`}
      />
    </div>
  );
}

export default Search;
