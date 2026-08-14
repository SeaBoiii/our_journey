import type { Moment, MomentStatus } from "../../lib/moments/types";
import {
  createMomentAltText,
  isMomentReadyForApproval,
} from "../../lib/moments/gallery";
import styles from "./MomentsAdmin.module.css";

interface Props {
  moment: Moment;
  busyStatus: MomentStatus | null;
  onChangeStatus: (moment: Moment, status: MomentStatus) => void;
}

const DATE_FORMATTER = new Intl.DateTimeFormat("en-SG", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const STATUS_LABELS: Readonly<Record<MomentStatus, string>> = {
  pending: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected",
  hidden: "Hidden",
};

export default function AdminMomentCard({
  moment,
  busyStatus,
  onChangeStatus,
}: Props) {
  const isBusy = busyStatus !== null;
  const createdAt = new Date(moment.createdAt);
  const formattedDate = Number.isNaN(createdAt.getTime())
    ? "Recently shared"
    : DATE_FORMATTER.format(createdAt);
  const mediaUrl = moment.thumbnailUrl || moment.previewUrl;
  const processingStatus =
    moment.processingStatus ?? (mediaUrl ? "ready" : "pending");
  const previewFailed = processingStatus === "failed";
  const canApprove = isMomentReadyForApproval(moment);
  const restoreStatus: MomentStatus | null =
    moment.status === "rejected"
      ? "pending"
      : moment.status === "hidden"
        ? "approved"
        : null;

  return (
    <article
      className={styles.card}
      data-status={moment.status}
      data-processing-status={processingStatus}
    >
      <div
        className={styles.media}
        style={
          moment.width && moment.height
            ? { aspectRatio: `${moment.width} / ${moment.height}` }
            : undefined
        }
      >
        {!mediaUrl ? (
          <span
            className={styles.mediaPlaceholder}
            role="img"
            aria-label={
              previewFailed
                ? "Gallery preview processing failed"
                : "Gallery preview is still being prepared"
            }
          >
            <svg viewBox="0 0 28 28" aria-hidden="true">
              <path d="M5 8.5h4l1.4-2h7.2l1.4 2h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2Z" />
              <circle cx="14" cy="15" r="4" />
            </svg>
            <span>{previewFailed ? "Preview failed" : "Preview processing"}</span>
          </span>
        ) : moment.mediaType === "video" ? (
          <video src={mediaUrl} preload="metadata" muted playsInline />
        ) : (
          <img
            src={mediaUrl}
            alt={createMomentAltText(moment)}
            loading="lazy"
            decoding="async"
          />
        )}
        <span className={styles.status}>{STATUS_LABELS[moment.status]}</span>
        {moment.mediaType === "video" ? (
          <span className={styles.videoBadge} aria-label="Video">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m7.5 5.8 6.8 4.2-6.8 4.2V5.8Z" />
            </svg>
          </span>
        ) : null}
      </div>

      <div className={styles.copy}>
        <div className={styles.identity}>
          <strong>{moment.guestName || "Guest"}</strong>
          <time dateTime={moment.createdAt}>{formattedDate}</time>
        </div>
        {moment.caption ? <p>{moment.caption}</p> : <p className={styles.noCaption}>No caption added.</p>}
        {processingStatus !== "ready" ? (
          <p className={styles.processingNotice} data-state={processingStatus}>
            <strong>{previewFailed ? "Preview failed." : "Preview processing."}</strong>{" "}
            {previewFailed
              ? "This moment remains private. Repair processing before approval; rejection is still available."
              : moment.status === "approved"
                ? "This approved moment remains private until its preview is ready."
                : "Approval will be available after its private preview is ready; rejection is still available."}
          </p>
        ) : null}
      </div>

      <div className={styles.actions} aria-label={`Moderate moment from ${moment.guestName || "guest"}`}>
        {moment.status === "pending" ? (
          <button
            type="button"
            className={styles.approve}
            disabled={isBusy || !canApprove}
            aria-busy={busyStatus === "approved"}
            onClick={() => onChangeStatus(moment, "approved")}
            title={
              canApprove
                ? undefined
                : "Approval is available after the canonical preview is ready."
            }
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.4 3.2 3.2 7.8-7.8" /></svg>
            {busyStatus === "approved"
              ? "Approving..."
              : canApprove
                ? "Approve"
                : "Waiting for preview"}
          </button>
        ) : null}
        {restoreStatus ? (
          <button
            type="button"
            className={styles.approve}
            disabled={
              isBusy || (restoreStatus === "approved" && !canApprove)
            }
            aria-busy={busyStatus === restoreStatus}
            onClick={() => onChangeStatus(moment, restoreStatus)}
            title={
              restoreStatus === "approved" && !canApprove
                ? "Restore is available after the canonical preview is ready."
                : undefined
            }
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.4 7.7 13.6 15.5 5.8" /></svg>
            {busyStatus === restoreStatus
              ? "Restoring..."
              : restoreStatus === "approved" && !canApprove
                ? "Waiting for preview"
                : "Restore"}
          </button>
        ) : null}
        {moment.status === "pending" || moment.status === "approved" ? (
          <button
            type="button"
            disabled={isBusy}
            aria-busy={busyStatus === "rejected"}
            onClick={() => onChangeStatus(moment, "rejected")}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" /></svg>
            {busyStatus === "rejected" ? "Rejecting..." : "Reject"}
          </button>
        ) : null}
        {moment.status === "approved" ? (
          <button
            type="button"
            disabled={isBusy}
            aria-busy={busyStatus === "hidden"}
            onClick={() => onChangeStatus(moment, "hidden")}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M2.5 10s2.7-4.2 7.5-4.2 7.5 4.2 7.5 4.2-2.7 4.2-7.5 4.2S2.5 10 2.5 10Z" />
              <path d="m4 4 12 12" />
            </svg>
            {busyStatus === "hidden" ? "Hiding..." : "Hide"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
