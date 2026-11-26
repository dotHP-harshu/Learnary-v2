"use client";

import React, { useContext } from "react";
import Greet from "../collection/Greet";
import UserContext from "../../context/userContext";
import TodaySection from "./TodaySection";
import PageHeader from "../ui/PageHeader";

// Today: the authenticated landing page — planner, due/scheduled tasks, and
// the review queue. Historical stats and charts live on /progress.
function TodayPage() {
  const { user } = useContext(UserContext);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={user ? <Greet user={user} /> : "Today"}
        description="Your learning day at a glance."
      />
      {user && <TodaySection />}
    </div>
  );
}

export default TodayPage;
