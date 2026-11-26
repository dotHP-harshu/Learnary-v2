"use client";

import React from "react";
import CollectionItem from "./CollectionItem";
import Skeleton from "../ui/Skeleton";
import EmptyState from "../ui/EmptyState";
import Button from "../ui/Button";
import { FolderPlus, Plus } from "lucide-react";

function CollectionList({
  user,
  collections,
  isLoading,
  getCollection,
  onAdd,
}) {
  return (
    <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* One create affordance lives in the page header; the empty state
          repeats it contextually when there is nothing to show. */}
      {isLoading ? (
        [...Array(3)].map((_, i) => <Skeleton key={i} className="h-40" />)
      ) : collections && collections.length > 0 ? (
        collections.map((coll) => (
          <CollectionItem
            key={coll.id}
            coll={coll}
            user={user}
            getCollection={getCollection}
          />
        ))
      ) : (
        <div className="col-span-full">
          <EmptyState
            icon={FolderPlus}
            title="No collections yet"
            description="Create your first collection to start organizing your learning by topic."
            action={
              <Button onClick={onAdd} variant="secondary" size="sm">
                <Plus size={14} aria-hidden />
                New collection
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}

export default CollectionList;
