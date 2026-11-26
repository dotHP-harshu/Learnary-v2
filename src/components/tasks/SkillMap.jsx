"use client";

import { get } from "idb-keyval";
import React, { useEffect, useState } from "react";
import { PenLine } from "lucide-react";
import supabase from "../../supabase/supabase";
import { useToast } from "../ui/Toast";
import Drawer from "../ui/Drawer";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import Textarea from "../ui/Textarea";
import EmptyState from "../ui/EmptyState";
import { getUserKey } from "../../utils/getUserKey";

/**
 * Skill map editor as an accessible slide-in drawer (was an absolutely
 * positioned panel overlapping the page with no backdrop or keyboard close).
 */
function SkillMap({ open, onClose, collection_id, user }) {
  const [isEditing, setIsEditing] = useState(false);
  const [skillMap, setSkillMap] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const toast = useToast();

  const updateSkillMap = async () => {
    setIsUpdating(true);
    // Upsert on the companion row's unique collection_id: a skillmap that
    // failed to insert at collection creation must not be permanently
    // uneditable ("No skill map found" forever).
    const { data, error } = await supabase
      .from("skillmaps")
      .upsert(
        {
          collection_id,
          user_id: getUserKey(user),
          skillmap: skillMap ?? "",
        },
        { onConflict: "collection_id" }
      )
      .select();

    if (error) {
      toast.error("Couldn't save the skill map. Please try again.", {
        action: { label: "Retry", onClick: updateSkillMap },
      });
      setIsUpdating(false);
    } else if (data && data.length > 0) {
      setSkillMap(data[0].skillmap);
      setIsUpdating(false);
      setIsEditing(false);
      toast.success("Skill map saved");
    } else {
      toast.error("No skill map found for this collection.");
      setIsUpdating(false);
    }
  };

  const getSkillMap = async () => {
    const { data, error } = await supabase
      .from("skillmaps")
      .select("skillmap")
      .eq("collection_id", collection_id)
      .eq("user_id", getUserKey(user));

    if (error) {
      toast.error("Couldn't load the skill map.");
    } else if (data && data.length > 0) {
      setSkillMap(data[0].skillmap);
    } else {
      setSkillMap("");
    }
  };

  useEffect(() => {
    if (open) {
      if (navigator.onLine) {
        getSkillMap();
      } else {
        getOfflineSkillmaps();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const getOfflineSkillmaps = async () => {
    const localSkillMaps = await get("skillmaps");
    if (localSkillMaps) {
      const matching = localSkillMaps.filter(
        (s) => s.collection_id === collection_id
      );
      if (matching.length > 0) {
        setSkillMap(matching[0].skillmap);
      } else {
        toast.error("No skill map saved for this collection.");
        setSkillMap("");
      }
    } else {
      toast.error("No skill map saved on this device.");
      setSkillMap("");
    }
  };

  return (
    <Drawer
      open={open}
      onClose={() => {
        if (!isUpdating) onClose();
      }}
      title="Skill map"
      closeLabel="Close skill map"
    >
      {skillMap === null ? (
        <p role="status" className="text-sm text-fg-muted">Loading…</p>
      ) : isEditing ? (
        <div className="flex flex-col gap-3">
          <Textarea
            id="skillmap-editor"
            label="Edit skill map"
            value={skillMap}
            onChange={(e) => setSkillMap(e.target.value)}
            rows={8}
            className="min-h-48 flex-1"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setIsEditing(false)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button onClick={updateSkillMap} loading={isUpdating}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute right-0 top-0">
            <IconButton
              label="Edit skill map"
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(true)}
            >
              <PenLine size={16} />
            </IconButton>
          </div>
          {skillMap === "" ? (
            <EmptyState
              icon={PenLine}
              title="No skill map yet"
              description="Use the edit button to write your learning plan for this collection."
            />
          ) : (
            <pre className="scrollable mt-8 max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-fg">
              {skillMap}
            </pre>
          )}
        </div>
      )}
    </Drawer>
  );
}

export default SkillMap;
