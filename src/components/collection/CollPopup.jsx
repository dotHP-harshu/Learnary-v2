"use client";

import React, { useState } from "react";
import supabase from "../../supabase/supabase";
import { useToast } from "../ui/Toast";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Input from "../ui/Input";
import getUniqueCode from "../../utils/getUniqueCode";
import { getUserKey } from "../../utils/getUserKey";

/**
 * Create-collection dialog, rebuilt on the shared Modal primitive.
 * Success/error feedback goes through the global toast system.
 */
function CollPopup({ user, open, onClose, getCollection }) {
  const [title, setTitle] = useState("");
  const [isInserting, setIsInserting] = useState(false);
  const toast = useToast();

  const addSkillMap = async (collection_id) => {
    const { error } = await supabase.from("skillmaps").insert({
      collection_id,
      user_id: getUserKey(user),
    });

    if (error) {
      // The collection exists; only its companion skillmap row failed.
      toast.error("Collection created, but the skill map could not be set up.");
    }
  };

  const addCollection = async (e) => {
    e.preventDefault();
    setIsInserting(true);
    const collection_id = getUniqueCode(title);
    const { error } = await supabase.from("collections").insert({
      title,
      user_id: getUserKey(user),
      collection_id,
    });

    if (error) {
      setIsInserting(false);
      toast.error("Couldn't create the collection. Please try again.");
      return;
    }

    await addSkillMap(collection_id);

    onClose();
    setIsInserting(false);
    getCollection(user);
    setTitle("");
    toast.success(`Collection "${title}" created`);
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!isInserting) onClose();
      }}
      title="New collection"
    >
      <form onSubmit={addCollection} className="flex flex-col gap-4">
        <Input
          id="collection-title"
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          type="text"
          placeholder="e.g. React, Python, Digital Marketing"
          data-autofocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isInserting}>
            Cancel
          </Button>
          <Button type="submit" loading={isInserting}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default CollPopup;
