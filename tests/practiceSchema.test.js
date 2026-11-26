import { describe, expect, it } from "vitest";
import {
  parseFlashcards,
  parseQuiz,
  parseShortAnswerEvaluations,
  sanitizeQuizContent,
  scoreAttempt,
  scoreMcq,
} from "../src/server/ai/practiceSchema.js";

// ---- fixtures ---------------------------------------------------------------

const mcq = (overrides = {}) => ({
  prompt: "Which value is even?",
  type: "mcq",
  difficulty: "beginner",
  options: ["3", "4"],
  expected_answer: "4",
  explanation: "4 is divisible by 2.",
  concept: "parity",
  rubric: null,
  ...overrides,
});

const short = (overrides = {}) => ({
  prompt: "Explain what a loop is.",
  type: "short_answer",
  difficulty: "intermediate",
  expected_answer: "A loop repeats a block until a condition ends it.",
  explanation: "Repetition is the core idea.",
  concept: null,
  rubric: "Must mention repetition and a stopping condition.",
  ...overrides,
});

const quiz = (questions, title = "Numbers") => JSON.stringify({ title, questions });

const expectInvalid = (fn) => {
  try {
    fn();
  } catch (error) {
    expect(error.code).toBe("AI_INVALID_RESPONSE");
    return;
  }
  throw new Error("expected AI_INVALID_RESPONSE to be thrown");
};

// ---- parseQuiz ---------------------------------------------------------------

describe("parseQuiz", () => {
  it("assigns sequential indices and canonicalises the MCQ key to the option casing", () => {
    const parsed = parseQuiz(
      quiz([
        mcq({ options: ["4", "3"], expected_answer: "4" }),
        mcq({ prompt: "Which is odd?", options: ["6", "7"], expected_answer: "7" }),
        mcq({ prompt: "Which is prime?", options: ["8", "9"], expected_answer: "9" }),
      ])
    );

    expect(parsed.title).toBe("Numbers");
    expect(parsed.questions.map((q) => q.index)).toEqual([0, 1, 2]);
    expect(parsed.questions[0].expected_answer).toBe("4");
    expect(parsed.questions[0].rubric).toBe("Exact option match");
    expect(parsed.questions[0].options).toEqual(["4", "3"]);
  });

  it("matches the answer key case-insensitively and stores the option's casing", () => {
    const parsed = parseQuiz(
      quiz([
        mcq({ options: ["JSON", "XML"], expected_answer: "json" }),
        mcq({ prompt: "Q2", options: ["a", "b"], expected_answer: "b" }),
        mcq({ prompt: "Q3", options: ["c", "d"], expected_answer: "d" }),
      ])
    );
    expect(parsed.questions[0].expected_answer).toBe("JSON");
  });

  it("rejects an MCQ whose answer key is not one of its options", () => {
    expectInvalid(() =>
      parseQuiz(
        quiz([
          mcq({ expected_answer: "42" }),
          mcq({ prompt: "Q2" }),
          mcq({ prompt: "Q3" }),
        ])
      )
    );
  });

  it("rejects an MCQ with fewer than two distinct options", () => {
    expectInvalid(() =>
      parseQuiz(
        quiz([
          mcq({ options: ["same", "same"], expected_answer: "same" }),
          mcq({ prompt: "Q2" }),
          mcq({ prompt: "Q3" }),
        ])
      )
    );
  });

  it("requires a rubric on short-answer questions", () => {
    expectInvalid(() =>
      parseQuiz(
        quiz([
          mcq(),
          mcq({ prompt: "Q2" }),
          short({ prompt: "Q3", rubric: null }),
        ])
      )
    );
  });

  it("drops duplicate prompts and fails when fewer than three distinct questions remain", () => {
    expectInvalid(() =>
      parseQuiz(
        quiz([
          mcq(),
          mcq({ prompt: "Which value is even?" }),
          mcq({ prompt: "Q2" }),
        ])
      )
    );
  });

  it("extracts JSON from surrounding prose", () => {
    const raw = `Sure, here is the quiz:\n${quiz([mcq(), mcq({ prompt: "Q2" }), mcq({ prompt: "Q3" })])}\nGood luck!`;
    expect(parseQuiz(raw).questions).toHaveLength(3);
  });

  it("collapses whitespace and trims text fields", () => {
    const parsed = parseQuiz(
      quiz([
        mcq({ prompt: "  Which   value\n is even?  " }),
        mcq({ prompt: "Q2" }),
        mcq({ prompt: "Q3" }),
      ])
    );
    expect(parsed.questions[0].prompt).toBe("Which value is even?");
  });

  it("throws AI_INVALID_RESPONSE for non-JSON garbage", () => {
    expectInvalid(() => parseQuiz("not json at all"));
  });
});

// ---- sanitizeQuizContent ------------------------------------------------------

describe("sanitizeQuizContent", () => {
  it("never exposes answer keys, rubrics or explanations", () => {
    const parsed = parseQuiz(
      quiz([mcq(), short({ prompt: "Explain loops." }), mcq({ prompt: "Q3" })])
    );
    const safe = sanitizeQuizContent(parsed);

    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain("expected_answer");
    expect(serialized).not.toContain("rubric");
    expect(serialized).not.toContain("explanation");
    expect(serialized).not.toContain("divisible by 2");

    expect(safe).toEqual({
      title: "Numbers",
      questions: [
        { index: 0, prompt: parsed.questions[0].prompt, type: "mcq", difficulty: "beginner", options: ["3", "4"] },
        { index: 1, prompt: "Explain loops.", type: "short_answer", difficulty: "intermediate" },
        { index: 2, prompt: "Q3", type: "mcq", difficulty: "beginner", options: ["3", "4"] },
      ],
    });
  });

  it("omits options for short answers (null options are not serialised)", () => {
    const parsed = parseQuiz(quiz([mcq(), mcq({ prompt: "Q2" }), short({ prompt: "Q3" })]));
    const safe = sanitizeQuizContent(parsed);
    expect(safe.questions[2]).not.toHaveProperty("options");
  });
});

// ---- scoring -----------------------------------------------------------------

describe("scoreMcq", () => {
  it("is case-insensitive and trims", () => {
    expect(scoreMcq("Paris", "  paris ")).toBe(true);
  });

  it("is false for null, undefined and non-strings", () => {
    expect(scoreMcq("Paris", null)).toBe(false);
    expect(scoreMcq("Paris", undefined)).toBe(false);
    expect(scoreMcq("Paris", 42)).toBe(false);
  });

  it("requires an exact match, not a substring", () => {
    expect(scoreMcq("Paris", "Paris, France")).toBe(false);
  });
});

describe("scoreAttempt", () => {
  const content = {
    questions: [
      { index: 0, type: "mcq", expected_answer: "4", explanation: "e", concept: "c" },
      { index: 1, type: "mcq", expected_answer: "7", explanation: "e", concept: null },
      { index: 2, type: "short_answer", expected_answer: "x", rubric: "r", explanation: "e" },
    ],
  };

  it("scores MCQs deterministically and leaves short answers for the model", () => {
    const result = scoreAttempt(content, [
      { index: 0, value: "4" },
      { index: 1, value: "wrong" },
      { index: 2, value: "my answer" },
    ]);

    expect(result.score).toBe(1);
    expect(result.maxScore).toBe(3);
    expect(result.hasShortAnswers).toBe(true);
    expect(result.shortAnswers).toEqual([
      { index: 2, given: "my answer", question: content.questions[2] },
    ]);
    expect(result.feedback.map((f) => f.verdict)).toEqual(["correct", "incorrect"]);
  });

  it("marks unanswered MCQs as skipped and still counts them in max_score", () => {
    const result = scoreAttempt(content, [{ index: 0, value: null }]);
    expect(result.feedback[0].verdict).toBe("skipped");
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(3);
  });

  it("treats an empty-string answer as skipped", () => {
    const result = scoreAttempt(content, [{ index: 0, value: "" }]);
    expect(result.feedback[0].verdict).toBe("skipped");
  });

  it("reports no short answers for an all-MCQ quiz", () => {
    const allMcq = { questions: [{ index: 0, type: "mcq", expected_answer: "4" }] };
    const result = scoreAttempt(allMcq, [{ index: 0, value: "4" }]);
    expect(result.hasShortAnswers).toBe(false);
    expect(result.shortAnswers).toEqual([]);
  });
});

// ---- short-answer evaluation --------------------------------------------------

describe("parseShortAnswerEvaluations", () => {
  const evaluate = (payload) =>
    parseShortAnswerEvaluations(JSON.stringify(payload), [0, 1, 2]);

  it("maps verdicts to points", () => {
    const result = evaluate([
      { index: 0, verdict: "correct", confidence: "high", feedback: "Good." },
      { index: 1, verdict: "partial", confidence: "low", feedback: "Partly." },
      { index: 2, verdict: "incorrect", confidence: "medium", feedback: "No." },
    ]);
    expect(result.map((r) => r.points)).toEqual([1, 0.5, 0]);
  });

  it("fills a missing verdict with an incorrect fallback instead of dropping the question", () => {
    const result = evaluate([{ index: 0, verdict: "correct", feedback: "Good." }]);
    expect(result).toHaveLength(3);
    expect(result[1]).toMatchObject({ index: 1, verdict: "incorrect", points: 0 });
    expect(result[2]).toMatchObject({ index: 2, verdict: "incorrect", points: 0 });
  });

  it("defaults an unknown confidence to medium", () => {
    const result = evaluate([{ index: 0, verdict: "correct", confidence: "certain", feedback: "ok" }]);
    expect(result[0].confidence).toBe("medium");
  });

  it("throws AI_INVALID_RESPONSE when the evaluator output is unusable", () => {
    expectInvalid(() => parseShortAnswerEvaluations("no json here", [0]));
  });
});

// ---- flashcards ---------------------------------------------------------------

describe("parseFlashcards", () => {
  const card = (overrides = {}) => ({
    front: "What is 2+2?",
    back: "4",
    explanation: null,
    ...overrides,
  });

  it("deduplicates front text case-insensitively", () => {
    const parsed = parseFlashcards(
      JSON.stringify({
        cards: [
          card(),
          card({ front: "what is 2+2?" }),
          card({ front: "Capital of France?" }),
          card({ front: "Capital of Japan?" }),
        ],
      })
    );
    expect(parsed.cards).toHaveLength(3);
    expect(parsed.cards[0].front).toBe("What is 2+2?");
  });

  it("fails when fewer than three distinct cards remain", () => {
    expectInvalid(() =>
      parseFlashcards(
        JSON.stringify({ cards: [card(), card({ front: "WHAT IS 2+2?" })] })
      )
    );
  });

  it("collapses whitespace", () => {
    const parsed = parseFlashcards(
      JSON.stringify({
        cards: [
          card({ front: "  What   is\n2+2? " }),
          card({ front: "B?" }),
          card({ front: "C?" }),
        ],
      })
    );
    expect(parsed.cards[0].front).toBe("What is 2+2?");
  });
});
