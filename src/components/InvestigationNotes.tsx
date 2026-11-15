import { useRef, useState } from "react";
import {
  Check,
  CheckCheck,
  Circle,
  CircleAlert,
  Clock3,
  Download,
  FilePenLine,
  HardDrive,
  RotateCcw,
} from "lucide-react";
import { formatPacific } from "../time.mjs";
import {
  createReview,
  loadReview,
  REVIEW_NOTE_LIMIT,
  reviewMarkdown,
  saveReview,
} from "../review-notes.mjs";
import "./InvestigationNotes.css";

type ReviewState = "unreviewed" | "investigating" | "reviewed";
type PersonalReview = {
  version: 1;
  jobId: string;
  state: string;
  note: string;
  asOf: string;
  updatedAt: string;
};
type Props = { jobId: string; asOf: string };
const states: { value: ReviewState; label: string; icon: typeof Circle }[] = [
  { value: "unreviewed", label: "Unreviewed", icon: Circle },
  { value: "investigating", label: "Investigating", icon: Clock3 },
  { value: "reviewed", label: "Reviewed", icon: CheckCheck },
];

function readInitial(jobId: string) {
  try {
    return loadReview(window.localStorage, jobId);
  } catch {
    return {
      review: null,
      error:
        "Browser storage is unavailable. Your draft is kept on screen, but will not survive a reload. Download it to keep a copy.",
    };
  }
}

export default function InvestigationNotes(props: Props) {
  return <ReviewEditor key={props.jobId} {...props} />;
}

function ReviewEditor({ jobId, asOf }: Props) {
  const [initial] = useState(() => readInitial(jobId));
  const [review, setReview] = useState<PersonalReview>(
    () =>
      initial.review ?? {
        version: 1,
        jobId,
        state: "unreviewed",
        note: "",
        asOf: "",
        updatedAt: "",
      },
  );
  const [error, setError] = useState(initial.error);
  const [saved, setSaved] = useState(!!initial.review);
  const [exportMessage, setExportMessage] = useState("");
  const latestReview = useRef(review);
  const save = (next: PersonalReview) => {
    latestReview.current = next;
    setReview(next);
    setExportMessage("");
    let result;
    try {
      result = saveReview(window.localStorage, next);
    } catch {
      result = {
        saved: false,
        error:
          "This draft could not be saved in the browser. It remains on screen; download a copy before closing or reloading.",
      };
    }
    setSaved(result.saved);
    setError(result.error);
  };
  const update = (patch: { state?: ReviewState; note?: string }) => {
    const current = latestReview.current;
    save(
      createReview(
        jobId,
        asOf,
        patch.state ?? current.state,
        patch.note ?? current.note,
      ),
    );
  };
  const download = () => {
    try {
      const text = reviewMarkdown(latestReview.current, asOf);
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/markdown;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `personal-review-${jobId.replace(/[^a-zA-Z0-9_-]/g, "_")}.md`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage("Review download prepared.");
    } catch {
      setExportMessage(
        "The download could not be prepared. Select and copy your note to keep a copy.",
      );
    }
  };
  const differentCursor =
    !!review.asOf && !!asOf && Date.parse(review.asOf) !== Date.parse(asOf);
  const noteId = `personal-note-${jobId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <section className="review-notes" aria-labelledby={`${noteId}-heading`}>
      <div className="review-notes-heading">
        <h3 id={`${noteId}-heading`}>
          <FilePenLine size={15} />
          Personal review
        </h3>
        <span>
          <HardDrive size={11} />
          This browser only
        </span>
      </div>
      <p className="review-notes-intro">
        Your review label and note are separate from the recorded job lifecycle.
        They are not shared or synchronized.
      </p>
      <div
        className="review-state-options"
        role="group"
        aria-label="Personal review state"
      >
        {states.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            className={review.state === value ? "review-state-selected" : ""}
            aria-pressed={review.state === value}
            onClick={() => {
              if (review.state !== value) update({ state: value });
            }}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>
      <label className="review-note-label" htmlFor={noteId}>
        Personal investigation note
      </label>
      <textarea
        id={noteId}
        value={review.note}
        onChange={(event) =>
          update({ note: event.target.value.slice(0, REVIEW_NOTE_LIMIT) })
        }
        maxLength={REVIEW_NOTE_LIMIT}
        rows={4}
        placeholder="What did you investigate? What should you check next?"
        aria-describedby={`${noteId}-status ${noteId}-context`}
      />
      <div className="review-note-footer">
        <span
          className={`review-save-status ${error ? "review-save-error" : ""}`}
          id={`${noteId}-status`}
          role="status"
        >
          {error ? (
            <>
              <CircleAlert size={12} />
              Draft not saved
            </>
          ) : saved ? (
            <>
              <Check size={12} />
              Saved in this browser
            </>
          ) : (
            <>
              <HardDrive size={12} />
              Autosaves as you edit
            </>
          )}
        </span>
        <span>
          {review.note.length.toLocaleString("en-US")} /{" "}
          {REVIEW_NOTE_LIMIT.toLocaleString("en-US")}
        </span>
      </div>
      {error && (
        <div className="review-storage-error" role="alert">
          <CircleAlert size={14} />
          <div>
            <p>{error}</p>
            <button
              type="button"
              onClick={() =>
                save(createReview(jobId, asOf, review.state, review.note))
              }
            >
              <RotateCcw size={11} />
              Retry saving
            </button>
          </div>
        </div>
      )}
      <div className="review-source-context" id={`${noteId}-context`}>
        <span>Current source cursor</span>
        <strong>{formatPacific(asOf, true)}</strong>
        {review.updatedAt && (
          <>
            <span>Personal review updated</span>
            <strong>{formatPacific(review.updatedAt, true)}</strong>
          </>
        )}
        {differentCursor && (
          <>
            <span className="review-context-changed">
              Saved against a different cursor
            </span>
            <strong className="review-context-changed">
              {formatPacific(review.asOf, true)}
            </strong>
          </>
        )}
      </div>
      <div className="review-export-row">
        <p>Download a copy to keep or share your personal review.</p>
        <button type="button" onClick={download}>
          <Download size={12} />
          Download review
        </button>
      </div>
      {exportMessage && (
        <p className="review-export-status" role="status">
          {exportMessage}
        </p>
      )}
    </section>
  );
}
