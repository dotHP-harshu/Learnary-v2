"use client";

import React, { useContext, useEffect, useState } from "react";
import Greet from "./Greet";
import CollectionList from "./CollectionList";
import supabase from "../../supabase/supabase";
import CollPopup from "./CollPopup";
import UserContext from "../../context/userContext";
import { useToast } from "../ui/Toast";
import Button from "../ui/Button";
import PageHeader from "../ui/PageHeader";
import Search from "../ui/Search";
import ErrorState from "../ui/ErrorState";
import { Plus } from "lucide-react";
import { get, set } from "idb-keyval";
import { getAuthUser, getUserKey } from "../../utils/getUserKey";
import useOnlineStatus from "../../hooks/useOnlineStatus";

function Collection() {
  const { user } = useContext(UserContext);
  const [collections, setCollections] = useState(null);
  const [isShowingPopup, setIsShowingPopup] = useState(false);
  const [filteredCollection, setFilteredCollection] = useState(null);
  const [isOfflineData, setIsOfflineData] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const online = useOnlineStatus();
  const toast = useToast();

  const getCollection = async (currentUser) => {
    const { data, error } = await supabase
      .from("collections")
      .select("*")
      .eq("user_id", getUserKey(currentUser));

    if (error) {
      // A failed read is an error, not an empty collection list.
      setLoadError(`Couldn't load your collections. ${error.message}`);
    } else {
      setLoadError(null);
      setCollections(data);
      setFilteredCollection(data);
      await set("collections", data);
    }
  };

  // Background cache warm-up for offline reads. Bounded (newest 500 tasks,
  // all skill-map text) and silent on failure: a sync problem must not
  // interrupt browsing or raise a toast on every visit — the live views
  // surface their own errors.
  const getUserTasks = async (currentUser) => {
    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, collection_id, title, description, completed, completed_at, status, priority, difficulty, estimated_minutes, due_at, scheduled_for, source, roadmap_step_id, parent_task_id, created_at"
      )
      .eq("user_id", getUserKey(currentUser))
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      console.warn("Background task cache sync failed:", error.message);
    } else {
      await set("tasks", data);
    }
  };

  const getUserSkillMaps = async (currentUser) => {
    const { data, error } = await supabase
      .from("skillmaps")
      .select("id, collection_id, user_id, skillmap, created_at, updated_at")
      .eq("user_id", getUserKey(currentUser))
      .limit(200);
    if (error) {
      console.warn("Background skill-map cache sync failed:", error.message);
    } else {
      await set("skillmaps", data);
    }
  };

  useEffect(() => {
    const getOfflineData = async () => {
      if (!online) {
        const localData = await get("collections");
        if (localData) {
          setCollections(localData);
          setFilteredCollection(localData);
          setIsOfflineData(true);
        } else {
          // No cache yet: show the honest empty state instead of a skeleton
          // that never resolves.
          setCollections([]);
          setFilteredCollection([]);
          setIsOfflineData(true);
          toast.error("You have no saved data on this device.");
        }
      }
    };
    getOfflineData();

    if (online && user) {
      const load = async () => {
        const currentUser = await getAuthUser();
        if (currentUser) {
          await set("user", currentUser);
          getCollection(currentUser);
          getUserTasks(currentUser);
          getUserSkillMaps(currentUser);
        }
      };
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const isLoading = loadError
    ? false
    : !online
      ? collections === null
      : !user || collections === null;

  return (
    <>
      <PageHeader
        title={<Greet user={user} />}
        description={
          isOfflineData
            ? "Offline — showing your last saved collections"
            : "Your learning collections"
        }
        actions={
          <>
            <Search setArray={setFilteredCollection} array={collections ?? []} />
            <Button onClick={() => setIsShowingPopup(true)}>
              <Plus size={16} aria-hidden />
              New collection
            </Button>
          </>
        }
      />

      <div className="mt-8">
        {loadError ? (
          <ErrorState
            title=""
            message={loadError}
            retryLabel="Retry"
            onRetry={async () => {
              setLoadError(null);
              setCollections(null);
              setFilteredCollection(null);
              const currentUser = await getAuthUser();
              if (currentUser) await getCollection(currentUser);
            }}
          />
        ) : (
          <CollectionList
            user={user}
            collections={filteredCollection}
            isLoading={isLoading}
            getCollection={getCollection}
            onAdd={() => setIsShowingPopup(true)}
          />
        )}
      </div>

      {isShowingPopup && user && (
        <CollPopup
          user={user}
          open={isShowingPopup}
          onClose={() => setIsShowingPopup(false)}
          getCollection={getCollection}
        />
      )}
    </>
  );
}

export default Collection;
