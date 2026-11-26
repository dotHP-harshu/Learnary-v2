"use client";

import { useContext, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import UserContext from "../../../../context/userContext";
import RoadmapPage from "../../../../components/roadmap/RoadmapPage";
import BackButton from "../../../../components/ui/BackButton";
import Skeleton from "../../../../components/ui/Skeleton";
import PageHeader from "../../../../components/ui/PageHeader";
import { useToast } from "../../../../components/ui/Toast";
import { ChevronRight, Map } from "lucide-react";
import { get } from "idb-keyval";
import supabase from "../../../../supabase/supabase";
import { normalizeCollectionId } from "../../../../utils/normalizeCollectionId";

/**
 * Collection-scoped roadmap page. Reached from the collection's
 * task view; the collection title is resolved here and passed down.
 */
export default function Roadmap() {
  const { collection_id } = useParams();
  const normalizedId = normalizeCollectionId(collection_id);
  const { user } = useContext(UserContext);
  const toast = useToast();
  const [title, setTitle] = useState(null);

  useEffect(() => {
    const loadTitle = async () => {
      if (navigator.onLine) {
        const { data, error } = await supabase
          .from("collections")
          .select("title")
          .eq("collection_id", normalizedId)
          .maybeSingle();
        if (!error && data) {
          setTitle(data.title);
          return;
        }
      }
      const cached = await get("collections");
      const match = (cached ?? []).find((c) => c.collection_id === normalizedId);
      if (match) setTitle(match.title);
      else if (navigator.onLine) {
        toast.error("Couldn't load the collection title.");
      }
    };
    if (user) loadTitle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedId, user]);

  return (
    <div className="w-full">
      <PageHeader
        breadcrumb={
          <>
            <BackButton path={`/tasks/${normalizedId}`} label="Back to tasks" />
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5">
              <Link href="/collection" className="text-fg-muted transition-colors hover:text-fg">
                Collections
              </Link>
              <ChevronRight size={14} className="text-fg-muted" aria-hidden />
              <Link
                href={`/tasks/${normalizedId}`}
                className="max-w-40 truncate text-fg-muted transition-colors hover:text-fg"
              >
                {title ?? "Collection"}
              </Link>
              <ChevronRight size={14} className="text-fg-muted" aria-hidden />
              <span className="font-medium text-fg">Roadmap</span>
            </nav>
          </>
        }
        title={
          <span className="inline-flex items-center gap-2">
            <Map size={22} className="shrink-0 text-accent" aria-hidden />
            Roadmap
          </span>
        }
        description={
          title
            ? `A step-by-step plan for ${title}.`
            : "A step-by-step plan for this collection."
        }
      />

      <div className="mt-6">
        {user ? (
          <RoadmapPage collectionId={normalizedId} collectionTitle={title} />
        ) : (
          <Skeleton className="h-40 rounded-xl" />
        )}
      </div>
    </div>
  );
}
