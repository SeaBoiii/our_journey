import { useEffect, useId, useRef } from "react";

import { momentsPath } from "../../lib/paths";

import styles from "./CaptureMoment.module.css";

export interface UploadSuccessProps {
  guestName: string;
  uploadedCount: number;
  onCaptureAnother: () => void;
  requiresModeration?: boolean;
  isMock?: boolean;
}

export default function UploadSuccess({
  guestName,
  uploadedCount,
  onCaptureAnother,
  requiresModeration = true,
  isMock = false,
}: UploadSuccessProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const firstName = guestName.trim().split(/\s+/)[0] || "friend";
  const momentWord = uploadedCount === 1 ? "moment" : "moments";

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <section className={styles.successPanel} aria-labelledby={titleId}>
      <div className={styles.successArtwork} aria-hidden="true">
        <span className={`${styles.snapshot} ${styles.snapshotOne}`} />
        <span className={`${styles.snapshot} ${styles.snapshotTwo}`} />
        <span className={styles.successCloud} />
      </div>

      <span className={styles.successMark} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6.5 12.5 3.6 3.5 7.4-8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>

      <p className={styles.successEyebrow}>Thank you, {firstName}</p>
      <h1 className={styles.successTitle} id={titleId} ref={titleRef} tabIndex={-1}>
        Your {momentWord} {uploadedCount === 1 ? "has" : "have"} joined our story.
      </h1>
      <p className={styles.successCopy}>
        {!isMock && requiresModeration
          ? "It may take a little while to appear while we give everything a quick look."
          : "We’re so glad you shared what the day looked like through your eyes."}
      </p>

      <div className={styles.successActions}>
        <button className={styles.primaryLink} type="button" onClick={onCaptureAnother}>
          Capture another
        </button>
        <a className={styles.secondaryButton} href={momentsPath("gallery/")}>
          View moments
        </a>
      </div>

      {isMock ? (
        <p className={styles.successNote}>
          Preview mode saves this moment only in this browser; nothing has been sent online.
        </p>
      ) : null}
    </section>
  );
}
