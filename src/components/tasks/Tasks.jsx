"use client";

import TaskContainer from "./TaskContainer";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "../ui/Toast";
import BackButton from "../ui/BackButton";
import Skeleton from "../ui/Skeleton";
import PageHeader from "../ui/PageHeader";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { get } from "idb-keyval";
import supabase from "../../supabase/supabase";
import UserContext from "../../context/userContext";
import { useContext } from "react";
import { normalizeCollectionId } from "../../utils/normalizeCollectionId";

function Tasks() {
  const { collection_id } = useParams();
  // Canonical client-generated collection IDs carry no colon prefix; old
  // bookmarks may (`/tasks/:<id>`), so normalize defensively.
  const normalizedId = normalizeCollectionId(collection_id);
  const { user } = useContext(UserContext);
  const [collection_title, setCollection_title] = useState(null);
  const toast = useToast();

  const getCollectionName = async () => {
    const { data, error } = await supabase
      .from("collections")
      .select("title")
      .eq("collection_id", normalizedId);
    if (error) {
      toast.error("Couldn't load the collection title.");
    } else {
      setCollection_title(data);
    }
  };

  useEffect(() => {
    if (navigator.onLine) {
      getCollectionName();
    }
    const getLocalCollectionName = async () => {
      const localCollectionTitle = await get("collections");
      if (localCollectionTitle) {
        setCollection_title(
          localCollectionTitle.filter(
            (n) => n.collection_id === normalizedId
          )
        );
      } else {
        toast.error("Collections were not saved on this device.");
      }
    };
    if (!navigator.onLine) {
      getLocalCollectionName();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedId]);

  const title =
    Array.isArray(collection_title) && collection_title.length > 0
      ? collection_title[0].title
      : null;

  return (
    <div className="w-full">
      <PageHeader
        breadcrumb={
          <>
            <BackButton path="/collection" label="Back to collections" />
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5">
              <Link
                href="/collection"
                className="text-fg-muted transition-colors hover:text-fg"
              >
                Collections
              </Link>
              <ChevronRight size={14} className="text-fg-muted" aria-hidden />
              {title ? (
                <span className="truncate font-medium capitalize text-fg">
                  {title}
                </span>
              ) : (
                <Skeleton className="h-4 w-32" />
              )}
            </nav>
          </>
        }
        title={title || "Tasks"}
        titleClassName="capitalize"
      />

      <div className="mt-6">
        <TaskContainer
          collection_id={normalizedId}
          collection_title={collection_title}
          user={user}
        />
      </div>
    </div>
  );
}

export default Tasks;
