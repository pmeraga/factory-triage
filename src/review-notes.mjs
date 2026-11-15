import { formatPacific } from "./time.mjs";

export const REVIEW_STATES = ["unreviewed", "investigating", "reviewed"];
export const REVIEW_NOTE_LIMIT = 3000;
export const reviewStorageKey = (jobId) =>
  `factory-triage:personal-review:${jobId}`;

/** @typedef {{version: 1, jobId: string, state: string, note: string, asOf: string, updatedAt: string}} PersonalReview */
const validInstant = (value) =>
  typeof value === "string" &&
  /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
  Number.isFinite(Date.parse(value));

/** @returns {PersonalReview} */
export function validateReview(value, jobId) {
  if (
    !value ||
    value.version !== 1 ||
    value.jobId !== jobId ||
    !REVIEW_STATES.includes(value.state) ||
    typeof value.note !== "string" ||
    value.note.length > REVIEW_NOTE_LIMIT ||
    !validInstant(value.updatedAt) ||
    typeof value.asOf !== "string" ||
    (value.asOf !== "" && !validInstant(value.asOf))
  ) {
    throw new Error(
      "The saved personal review is unreadable or uses an unsupported format. Editing will replace that browser record.",
    );
  }
  return {
    version: 1,
    jobId,
    state: value.state,
    note: value.note,
    asOf: value.asOf,
    updatedAt: value.updatedAt,
  };
}

export function loadReview(storage, jobId) {
  try {
    const raw = storage.getItem(reviewStorageKey(jobId));
    return {
      review: raw === null ? null : validateReview(JSON.parse(raw), jobId),
      error: "",
    };
  } catch (reason) {
    const invalid =
      reason instanceof SyntaxError ||
      (reason instanceof Error &&
        reason.message.startsWith("The saved personal review"));
    return {
      review: null,
      error: invalid
        ? "The saved personal review could not be read. Editing will replace that browser record; your current draft can still be downloaded."
        : "Browser storage is unavailable. Your draft is kept on screen, but will not survive a reload. Download it to keep a copy.",
    };
  }
}

/** @param {PersonalReview} review */
export function saveReview(storage, review) {
  try {
    const valid = validateReview(review, review.jobId);
    storage.setItem(reviewStorageKey(review.jobId), JSON.stringify(valid));
    return { saved: true, error: "" };
  } catch {
    return {
      saved: false,
      error:
        "This draft could not be saved in the browser. It remains on screen; download a copy before closing or reloading.",
    };
  }
}

/** @returns {PersonalReview} */
export function createReview(
  jobId,
  asOf,
  state,
  note,
  now = new Date().toISOString(),
) {
  return validateReview(
    {
      version: 1,
      jobId,
      state,
      note,
      asOf: validInstant(asOf) ? new Date(asOf).toISOString() : "",
      updatedAt: now,
    },
    jobId,
  );
}

export function reviewMarkdown(
  review,
  currentAsOf,
  exportedAt = new Date().toISOString(),
) {
  const label = (state) => state.slice(0, 1).toUpperCase() + state.slice(1);
  const date = (value) =>
    validInstant(value) ? formatPacific(value, true) : "Not recorded";
  const sourceCursor = review.asOf || currentAsOf || "";
  return [
    `# Personal review — ${review.jobId}`,
    "",
    `Review state: ${label(review.state)}`,
    "This is a personal browser-local review, separate from recorded manufacturing evidence.",
    "",
    `Exported at (Pacific): ${date(exportedAt)}`,
    `Exported at (UTC): ${exportedAt}`,
    `Review updated at (Pacific): ${date(review.updatedAt)}`,
    `Review updated at (UTC): ${review.updatedAt || "Not saved"}`,
    `Saved source cursor (Pacific): ${date(sourceCursor)}`,
    `Saved source cursor (UTC): ${sourceCursor || "Not recorded"}`,
    ...(currentAsOf && currentAsOf !== sourceCursor
      ? [
          `Current view cursor (Pacific): ${date(currentAsOf)}`,
          `Current view cursor (UTC): ${currentAsOf}`,
        ]
      : []),
    "",
    "## Personal note",
    "",
    review.note || "(No note entered.)",
    "",
    "Review labels and notes do not modify the source log or the recorded job lifecycle.",
    "",
  ].join("\n");
}
