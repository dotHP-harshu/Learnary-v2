"use client";

import React, { useRef } from "react";
import { Download } from "lucide-react";
import IconButton from "../ui/IconButton";
import Menu from "../ui/Menu";

// Export dropdown on the shared Menu primitive: labeled IconButton trigger;
// closes on outside click and Escape. Downloads use a Blob + hidden anchor.
function ExportData({ tasks, collection_title }) {
  const downloadLink = useRef(null);
  const hasTasks = Array.isArray(tasks) && tasks.length > 0;

  // The title loads asynchronously and may be missing entirely (uncached /
  // deleted collection), so the filename falls back to a neutral base.
  const fileBase = () => {
    const title = collection_title?.[0]?.title?.trim() || "tasks";
    return (
      title
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "tasks"
    );
  };

  const download = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    downloadLink.current.href = url;
    downloadLink.current.download = fileName;
    downloadLink.current.click();
    downloadLink.current.href = "";
    // Release the blob once the browser has taken it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleJsonDownload = () => {
    if (!hasTasks) return;
    const jsonString = JSON.stringify(tasks, null, 2);
    download(new Blob([jsonString], { type: "application/json" }), `${fileBase()}.json`);
  };

  const handleCsvDownload = () => {
    if (!hasTasks) return;
    const headers = Object.keys(tasks[0]);
    const csvRows = [headers.join(",")];

    tasks.forEach((row) => {
      const values = headers.map((header) => {
        // CSV discipline: values, commas, and newlines must not break the
        // row structure; double quotes are CSV-escaped.
        const raw = row[header];
        if (raw === null || raw === undefined) return "";
        return `"${String(raw).replace(/"/g, '""')}"`;
      });
      csvRows.push(values.join(","));
    });

    const csvString = csvRows.join("\n");
    download(new Blob([csvString], { type: "text/csv" }), `${fileBase()}.csv`);
  };

  return (
    <>
      <Menu
        label="Export tasks"
        trigger={({ toggle, menuProps }) => (
          <IconButton
            label="Export tasks"
            variant="outline"
            size="md"
            {...menuProps}
            onClick={toggle}
          >
            <Download size={16} />
          </IconButton>
        )}
        items={[
          {
            label: "As JSON",
            onSelect: handleJsonDownload,
            disabled: !hasTasks,
          },
          {
            label: "As CSV",
            onSelect: handleCsvDownload,
            disabled: !hasTasks,
          },
        ]}
      />
      {/* Hidden download anchor lives outside the menu panel so the ref
          survives the panel unmounting; click() works on display:none. */}
      <a
        ref={downloadLink}
        href="/"
        aria-label="Download data"
        tabIndex={-1}
        className="hidden"
      />
    </>
  );
}

export default ExportData;
