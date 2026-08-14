import { useEffect, useId, useState } from "react";

import styles from "./CaptureMoment.module.css";

export type SelectedMediaType = "photo" | "video";

export interface SelectedMedia {
  id: string;
  file: File;
  objectUrl: string;
  mediaType: SelectedMediaType;
}

export interface UploadPreviewProps {
  items: readonly SelectedMedia[];
  onRemove: (id: string) => void;
  disabled?: boolean;
  maxFiles: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1_000_000) {
    return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  }

  return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB`;
}

function fileExtension(fileName: string): string {
  const extension = fileName.split(".").pop()?.trim();
  return extension && extension !== fileName ? extension : "media";
}

interface PreviewMediaProps {
  item: SelectedMedia;
}

function PreviewMedia({ item }: PreviewMediaProps) {
  const [state, setState] = useState<"loading" | "ready" | "error">(
    item.objectUrl ? "loading" : "error",
  );

  useEffect(() => {
    setState(item.objectUrl ? "loading" : "error");
  }, [item.objectUrl]);

  if (state === "error") {
    return (
      <div className={styles.fallback} role="img" aria-label={`Selected file: ${item.file.name}`}>
        <span className={styles.fallbackIcon} aria-hidden="true">
          {item.mediaType === "video" ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="m15.5 9.2 4-2.2v10l-4-2.2" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="3" y="5.5" width="12.5" height="13" rx="2.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <rect x="3" y="4" width="18" height="16" rx="2.5" />
              <circle cx="8.5" cy="9" r="1.5" />
              <path d="m4.5 17 4.2-4.1 3.1 2.8 2.8-2.4 4.9 4.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span className={styles.fallbackExtension}>{fileExtension(item.file.name)}</span>
      </div>
    );
  }

  return (
    <>
      {item.mediaType === "video" ? (
        <video
          className={`${styles.media} ${state === "loading" ? styles.mediaHidden : ""}`}
          src={item.objectUrl}
          controls
          muted
          playsInline
          preload="metadata"
          aria-label={`Preview of ${item.file.name}`}
          onLoadedMetadata={() => setState("ready")}
          onError={() => setState("error")}
        />
      ) : (
        <img
          className={`${styles.media} ${state === "loading" ? styles.mediaHidden : ""}`}
          src={item.objectUrl}
          alt={`Preview of ${item.file.name}`}
          onLoad={() => setState("ready")}
          onError={() => setState("error")}
        />
      )}
      {state === "loading" ? <span className={styles.loadingShimmer} aria-hidden="true" /> : null}
    </>
  );
}

export default function UploadPreview({
  items,
  onRemove,
  disabled = false,
  maxFiles,
}: UploadPreviewProps) {
  const headingId = useId();

  if (items.length === 0) {
    return null;
  }

  return (
    <section className={styles.previewSection} aria-labelledby={headingId}>
      <div className={styles.previewHeader}>
        <h2 className={styles.previewTitle} id={headingId}>
          Your selection
        </h2>
        <span className={styles.previewCount} aria-live="polite">
          {items.length} of {maxFiles}
        </span>
      </div>

      <ul className={styles.previewList}>
        {items.map((item) => (
          <li className={styles.previewItem} key={item.id}>
            <div className={styles.mediaFrame}>
              <PreviewMedia item={item} />
              {item.mediaType === "video" ? (
                <span className={styles.videoBadge} aria-hidden="true">
                  Video
                </span>
              ) : null}
            </div>

            <button
              className={styles.removeButton}
              type="button"
              onClick={() => onRemove(item.id)}
              disabled={disabled}
              aria-label={`Remove ${item.file.name}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                <path d="m7 7 10 10M17 7 7 17" strokeLinecap="round" />
              </svg>
            </button>

            <div className={styles.previewCaption}>
              <span className={styles.fileName} title={item.file.name}>
                {item.file.name}
              </span>
              <span className={styles.fileSize}>{formatFileSize(item.file.size)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
