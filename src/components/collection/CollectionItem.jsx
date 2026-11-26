"use client";

import React, { useState } from "react";
import Link from "next/link";
import supabase from "../../supabase/supabase";
import { useToast } from "../ui/Toast";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import Input from "../ui/Input";
import Card from "../ui/Card";
import Menu from "../ui/Menu";
import {
  ChevronRight,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

function CollectionItem({ coll, getCollection, user }) {
  const collection_id = coll.collection_id;
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const toast = useToast();

  // Checked update (C2): Supabase reports success on zero matching rows, so
  // the returned rows decide between "renamed" and "gone elsewhere".
  const renameColl = async (e) => {
    e.preventDefault();
    if (savingRename) return;
    const title = titleDraft.trim();
    if (!title || title === coll.title) {
      setRenaming(false);
      return;
    }
    setSavingRename(true);
    const { data, error } = await supabase
      .from("collections")
      .update({ title })
      .eq("id", coll.id)
      .select("id");
    setSavingRename(false);

    if (error || !data || data.length === 0) {
      if (!error) {
        // Zero rows = not visible anymore (deleted elsewhere).
        setRenaming(false);
        toast.info("That collection no longer exists.");
        getCollection(user);
        return;
      }
      toast.error("Couldn't rename. Your edit is still open — please try again.");
      return;
    }
    setRenaming(false);
    getCollection(user);
    toast.success(`Renamed to "${title}"`);
  };

  // Atomic delete: the delete_collection_deep RPC removes the skill
  // map, tasks, and the collection in one transaction — a failure anywhere
  // rolls everything back, so "nothing was removed" is always accurate.
  const deleteColl = async () => {
    setIsDeleting(true);

    const { data, error } = await supabase.rpc("delete_collection_deep", {
      p_collection_id: collection_id,
    });

    setIsDeleting(false);
    if (error) {
      toast.error(
        `Couldn't delete "${coll.title}". Nothing was removed. ${error.message}`,
        {
          action: { label: "Retry", onClick: deleteColl },
        }
      );
      return;
    }
    if (data?.ok === false) {
      // Not found (already deleted elsewhere): refresh instead of erroring.
      toast.info("That collection no longer exists.");
      setConfirmingDelete(false);
      getCollection(user);
      return;
    }

    const taskCount = data?.deleted_tasks ?? 0;
    toast.success(
      `Deleted "${coll.title}" — ${taskCount} task${taskCount === 1 ? "" : "s"} and its skill map removed.`
    );
    setConfirmingDelete(false);
    getCollection(user);
  };

  return (
    <Card interactive className="group relative flex min-h-40 flex-col justify-between p-5">
      {/* Real link stretched across the card; actions sit in a dropdown
          above the overlay as separate controls, so interactive elements
          are never nested. */}
      <Link
        href={`/tasks/${collection_id}`}
        className="after:absolute after:inset-0 after:rounded-xl"
      >
        <h2 className="truncate pr-7 text-lg font-semibold capitalize text-fg group-hover:text-accent">
          {coll.title}
        </h2>
      </Link>
      <ChevronRight
        size={18}
        className="absolute right-4 top-5 shrink-0 text-fg-muted transition-opacity duration-200 group-hover:opacity-100 max-lg:opacity-100"
        aria-hidden
      />
      <div className="relative z-10 mt-4 flex items-center justify-between">
        <p className="text-xs text-fg-muted">
          {coll.created_at ? `Created ${coll.created_at.slice(0, 10)}` : null}
        </p>
        <Menu
          label={`Actions for collection ${coll.title}`}
          align="right"
          trigger={({ toggle, menuProps }) => (
            <IconButton
              label={`Actions for collection ${coll.title}`}
              variant="ghost"
              onClick={toggle}
              disabled={isDeleting}
              {...menuProps}
            >
              {isDeleting ? (
                <LoaderCircle size={16} className="animate-spin" aria-hidden />
              ) : (
                <MoreHorizontal size={16} aria-hidden />
              )}
            </IconButton>
          )}
          items={[
            {
              label: "Rename",
              icon: Pencil,
              onSelect: () => {
                setTitleDraft(coll.title);
                setRenaming(true);
              },
            },
            {
              label: "Delete",
              icon: Trash2,
              danger: true,
              onSelect: () => setConfirmingDelete(true),
            },
          ]}
        />
      </div>

      {/* Rename (C2): form submit is the single commit path; cancel discards. */}
      <Modal
        open={renaming}
        onClose={() => {
          if (!savingRename) setRenaming(false);
        }}
        title="Rename collection"
      >
        <form onSubmit={renameColl} className="flex flex-col gap-4">
          <Input
            id={`rename-${collection_id}`}
            label="Title"
            type="text"
            required
            value={titleDraft}
            disabled={savingRename}
            onChange={(e) => setTitleDraft(e.target.value)}
            maxLength={60}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setRenaming(false)}
              disabled={savingRename}
            >
              Cancel
            </Button>
            <Button type="submit" loading={savingRename} disabled={savingRename}>
              Save
            </Button>
          </div>
        </form>
      </Modal>

      {/* Shared accessible confirmation dialog instead of
          native confirm(); it stays open (with actions disabled) until the
          delete succeeds or the user explicitly cancels. */}
      <Modal
        open={confirmingDelete}
        onClose={() => {
          if (!isDeleting) setConfirmingDelete(false);
        }}
        title="Delete collection?"
      >
        <p className="text-sm text-fg-muted">
          “{coll.title}”, its tasks, and its skill map will be permanently
          removed. This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => setConfirmingDelete(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={deleteColl}
            loading={isDeleting}
            disabled={isDeleting}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

export default CollectionItem;
