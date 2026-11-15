import test from "node:test";
import assert from "node:assert/strict";
import {
  createReview,
  loadReview,
  reviewMarkdown,
  reviewStorageKey,
  saveReview,
  REVIEW_NOTE_LIMIT,
} from "../src/review-notes.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}
const cursor = "2026-07-20T18:30:00Z";
const updatedAt = "2026-11-15T00:00:00Z";

test("personal reviews survive immediate reload and remain isolated by job", () => {
  const storage = memoryStorage();
  const review = createReview(
    "job_0220",
    cursor,
    "investigating",
    "Check tool availability.\nKeep the original event unchanged.",
    updatedAt,
  );
  assert.equal(saveReview(storage, review).saved, true);
  assert.deepEqual(loadReview(storage, "job_0220").review, review);
  assert.equal(loadReview(storage, "job_0080").review, null);
  assert.equal(loadReview(storage, "job_0080").error, "");
  const second = createReview(
    "job_0220",
    "2026-07-22T18:30:00Z",
    "reviewed",
    review.note,
    "2026-11-15T00:01:00Z",
  );
  saveReview(storage, second);
  assert.equal(
    loadReview(storage, "job_0220").review.asOf,
    "2026-07-22T18:30:00.000Z",
  );
  assert.equal(loadReview(storage, "job_0220").review.note, review.note);
});

test("invalid stored reviews are visible and do not silently overwrite their source", () => {
  for (const raw of [
    "invalid json",
    JSON.stringify({ version: 2 }),
    JSON.stringify({
      ...createReview("job_0220", cursor, "reviewed", "", updatedAt),
      jobId: "job_other",
    }),
  ]) {
    const storage = memoryStorage();
    storage.setItem(reviewStorageKey("job_0220"), raw);
    const result = loadReview(storage, "job_0220");
    assert.equal(result.review, null);
    assert.match(result.error, /could not be read/);
    assert.equal(storage.getItem(reviewStorageKey("job_0220")), raw);
  }
  assert.throws(() =>
    createReview("job_a", cursor, "not-a-review-state", "", updatedAt),
  );
  assert.throws(() =>
    createReview(
      "job_a",
      cursor,
      "unreviewed",
      "x".repeat(REVIEW_NOTE_LIMIT + 1),
      updatedAt,
    ),
  );
});

test("quota and unavailable storage failures retain a draft and report an export fallback", () => {
  const draft = createReview(
    "job_a",
    cursor,
    "investigating",
    "Unsaved personal draft",
    updatedAt,
  );
  const original = structuredClone(draft);
  const unavailable = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("quota exceeded");
    },
  };
  assert.match(
    loadReview(unavailable, "job_a").error,
    /will not survive a reload/,
  );
  const result = saveReview(unavailable, draft);
  assert.equal(result.saved, false);
  assert.match(result.error, /download a copy/);
  assert.deepEqual(draft, original);
  assert.match(
    reviewMarkdown(draft, cursor, updatedAt),
    /Unsaved personal draft/,
  );
});

test("review export preserves notes and distinguishes personal dates from UTC and Pacific source cursors", () => {
  const note = "# Check next\nPressure signal needs review; no source changes.";
  const review = createReview(
    "job_0220",
    cursor,
    "investigating",
    note,
    updatedAt,
  );
  const markdown = reviewMarkdown(
    review,
    "2026-07-22T18:30:00Z",
    "2026-11-15T00:05:00Z",
  );
  assert.match(markdown, /Personal review — job_0220/);
  assert.match(markdown, /Review state: Investigating/);
  assert.match(markdown, /Jul 20, 2026, 11:30 AM PDT/);
  assert.match(
    markdown,
    /Saved source cursor \(UTC\): 2026-07-20T18:30:00.000Z/,
  );
  assert.match(markdown, /Current view cursor \(UTC\): 2026-07-22T18:30:00Z/);
  assert.ok(markdown.includes(note));
  assert.match(markdown, /do not modify the source log/);
});
