import { useEffect, useId, useRef } from "react";

import type { MomentUploadProgress } from "../../lib/moments/types";

import styles from "./CaptureMoment.module.css";

export interface UploadProgressProps {
  progress: MomentUploadProgress;
  onCancel?: () => void;
  isCancelling?: boolean;
}

function phaseCopy(progress: MomentUploadProgress): {
  title: string;
  copy: string;
} {
  if (progress.phase === "validating" || progress.phase === "preparing") {
    return {
      title: "Preparing your moment",
      copy: "Making sure everything is ready for its journey to us.",
    };
  }

  if (progress.phase === "finalizing" || progress.phase === "complete") {
    return {
      title: "Almost there",
      copy: "Adding the final touch to your moment.",
    };
  }

  return {
    title: "Uploading your moment",
    copy: progress.currentFileName
      ? `Sharing ${progress.currentFileName}`
      : "Your moment is on its way.",
  };
}

export default function UploadProgress({
  progress,
  onCancel,
  isCancelling = false,
}: UploadProgressProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const percentage = Math.max(0, Math.min(100, Math.round(progress.percentage)));
  const copy = phaseCopy(progress);
  const completedLabel =
    progress.totalFiles > 1
      ? `${Math.min(progress.completedFiles, progress.totalFiles)} of ${progress.totalFiles} files`
      : "One moment";

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <section className={styles.progressPanel} aria-labelledby={titleId} aria-busy="true">
      <div className={styles.progressIcon} aria-hidden="true">
        <svg viewBox="0 0 112 72" fill="none">
          <path
            d="M27 60h58.5C98 60 106 52.6 106 42.8c0-9.2-7.1-16.7-16.4-17.1C86.1 15.8 76.4 9 65.2 9c-14.6 0-26.7 11.4-27.6 25.8a18 18 0 0 0-10.6-3.4C16.5 31.4 8 39.4 8 49.3 8 55.3 13.7 60 27 60Z"
            fill="rgba(255,255,255,.88)"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M57 46V25m0 0-8 8m8-8 8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <h1 className={styles.progressTitle} id={titleId} ref={titleRef} tabIndex={-1}>
        {copy.title}
      </h1>
      <p className={styles.progressCopy}>{copy.copy}</p>

      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-label="Upload progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
        aria-valuetext={`${percentage} percent, ${completedLabel}`}
      >
        <div className={styles.progressValue} style={{ width: `${percentage}%` }} />
      </div>
      <div className={styles.progressMeta} aria-live="polite">
        <span>{completedLabel}</span>
        <span className={styles.progressPercent}>{percentage}%</span>
      </div>

      <p className={styles.progressHint}>Keep this page open until your upload is complete.</p>
      {onCancel ? (
        <button
          className={styles.progressCancel}
          type="button"
          onClick={onCancel}
          disabled={isCancelling}
        >
          {isCancelling ? "Cancelling…" : "Cancel upload"}
        </button>
      ) : null}
    </section>
  );
}
