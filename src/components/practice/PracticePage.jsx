"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import UserContext from "../../context/userContext";
import Button from "../ui/Button";
import { useToast } from "../ui/Toast";
import PageHeader from "../ui/PageHeader";
import SegmentedControl from "../ui/SegmentedControl";
import QuizStudio from "./QuizStudio";
import FlashcardStudio from "./FlashcardStudio";
import ReviewSession from "./ReviewSession";
import { countDueCards } from "../../services/practice";
import useOnlineStatus from "../../hooks/useOnlineStatus";
import { Layers, ListChecks, Play } from "lucide-react";

// Practice hub: quizzes + flashcards tabs and the review session.
// `?review=1` (linked from Today's review queue) auto-starts the session.
function PracticePage() {
  const { user } = useContext(UserContext);
  const toast = useToast();
  const userKey = user?.id ?? null;

  const [tab, setTab] = useState("quizzes");
  const [reviewing, setReviewing] = useState(false);
  const [dueCount, setDueCount] = useState(null);
  const online = useOnlineStatus();

  const refreshDueCount = useCallback(async () => {
    const { data } = await countDueCards();
    setDueCount(data); // null = unknown (loading/offline)
  }, []);

  useEffect(() => {
    if (!userKey) return;
    refreshDueCount();
    // Today links here with ?review=1 to auto-start the review session.
    if (new URLSearchParams(window.location.search).get("review") === "1") {
      setReviewing(true);
      window.history.replaceState(null, "", "/practice");
    }
  }, [userKey, refreshDueCount]);

  const tabs = [
    { value: "quizzes", label: "Quizzes", Icon: ListChecks },
    { value: "flashcards", label: "Flashcards", Icon: Layers },
  ];

  return (
    <div>
      <PageHeader
        title="Practice"
        description="Check your understanding and remember what you learn."
        actions={
          dueCount !== null && (
            <Button onClick={() => setReviewing(true)} disabled={dueCount === 0 || !online}>
              <Play size={15} aria-hidden />
              Review {dueCount > 0 ? `(${dueCount} due)` : "(all caught up)"}
            </Button>
          )
        }
      />

      {reviewing ? (
        <ReviewSession
          userKey={userKey}
          onDone={() => {
            setReviewing(false);
            refreshDueCount();
          }}
          onExit={() => setReviewing(false)}
        />
      ) : (
        <>
          <SegmentedControl
            className="mb-4"
            ariaLabel="Practice sections"
            options={tabs}
            value={tab}
            onChange={setTab}
          />

          {tab === "quizzes" ? (
            <QuizStudio userKey={userKey} toast={toast} />
          ) : (
            <FlashcardStudio
              userKey={userKey}
              toast={toast}
              online={true}
              onReviewed={refreshDueCount}
              onStartReview={() => setReviewing(true)}
              dueCount={dueCount}
            />
          )}
        </>
      )}
    </div>
  );
}

export default PracticePage;
