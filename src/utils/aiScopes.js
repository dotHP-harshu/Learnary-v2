// Stable recovery scopes. A scope names one recoverable slot for a feature
// instance; the action is part of the journal key, so Task Assist's four
// actions can share one scope without colliding.

export const planScope = (date) => (date ? `plan:${date}` : null);

export const roadmapScope = (collectionId) =>
  collectionId ? `roadmap:${collectionId}` : null;

export const roadmapStageScope = (collectionId) =>
  collectionId ? `roadmap:${collectionId}:stage` : null;

export const taskScope = (taskId) => (taskId ? `task:${taskId}` : null);

export const quizScope = () => "quiz";

export const quizAttemptScope = (quizId) =>
  quizId ? `quiz:${quizId}:attempt` : null;

export const flashcardScope = () => "flashcards";

export const weeklyReviewScope = () => "weekly";

export const tutorScope = (conversationId) =>
  conversationId ? `tutor:${conversationId}` : "tutor:new";
