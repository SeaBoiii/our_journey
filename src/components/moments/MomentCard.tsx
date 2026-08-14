import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { createMomentAltText } from "../../lib/moments/gallery";
import type { Moment } from "../../lib/moments/types";

import styles from "./MomentsGallery.module.css";

export interface MomentCardProps {
  moment: Moment;
  index?: number;
  onOpen: (moment: Moment) => void;
}

function safeDimension(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function MediaFallback() {
  return (
    <span className={styles.mediaPlaceholder} aria-hidden="true">
      <svg
        className={styles.fallbackMark}
        viewBox="0 0 48 48"
        fill="none"
      >
        <path
          d="M8.5 34.5 18 25l6.2 6.2 4.3-4.4 11 11"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect
          x="6.5"
          y="9.5"
          width="35"
          height="29"
          rx="4.5"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <circle cx="31.5" cy="18" r="3.5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </span>
  );
}

export default function MomentCard({
  moment,
  index = 0,
  onOpen,
}: MomentCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [canLoadVideo, setCanLoadVideo] = useState(false);
  const [isLoaded, setIsLoaded] = useState(
    moment.mediaType === "video" && Boolean(moment.thumbnailUrl),
  );
  const [hasMediaError, setHasMediaError] = useState(false);

  const fallbackWidth = moment.mediaType === "video" ? 16 : 4;
  const fallbackHeight = moment.mediaType === "video" ? 9 : 5;
  const width = safeDimension(moment.width, fallbackWidth);
  const height = safeDimension(moment.height, fallbackHeight);
  const altText = createMomentAltText(moment);
  const cardStyle = {
    "--moment-index": index,
  } as CSSProperties;
  const frameStyle = {
    aspectRatio: `${width} / ${height}`,
  };

  useEffect(() => {
    if (moment.mediaType !== "video" || !videoRef.current) {
      return;
    }

    const video = videoRef.current;

    if (!("IntersectionObserver" in window)) {
      setCanLoadVideo(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setCanLoadVideo(true);
          observer.disconnect();
        }
      },
      { rootMargin: "320px 0px" },
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, [moment.mediaType]);

  return (
    <article className={styles.card} style={cardStyle}>
      <button
        className={styles.cardButton}
        type="button"
        onClick={() => onOpen(moment)}
        aria-label={`Open ${altText}`}
      >
        <span className={styles.mediaFrame} style={frameStyle}>
          {!isLoaded || hasMediaError ? <MediaFallback /> : null}

          {!hasMediaError && moment.mediaType === "photo" ? (
            <img
              className={`${styles.cardMedia} ${isLoaded ? styles.mediaLoaded : ""}`}
              src={moment.thumbnailUrl ?? moment.previewUrl}
              alt={altText}
              width={width}
              height={height}
              loading="lazy"
              decoding="async"
              sizes="(max-width: 352px) 100vw, (max-width: 767px) 50vw, (max-width: 1151px) 33vw, 25vw"
              draggable={false}
              onLoad={() => setIsLoaded(true)}
              onError={() => setHasMediaError(true)}
            />
          ) : null}

          {!hasMediaError && moment.mediaType === "video" ? (
            <video
              ref={videoRef}
              className={`${styles.cardMedia} ${isLoaded ? styles.mediaLoaded : ""}`}
              src={canLoadVideo ? moment.previewUrl : undefined}
              poster={moment.thumbnailUrl}
              width={width}
              height={height}
              muted
              playsInline
              preload={canLoadVideo ? "metadata" : "none"}
              tabIndex={-1}
              aria-hidden="true"
              onLoadedMetadata={() => setIsLoaded(true)}
              onLoadedData={() => setIsLoaded(true)}
              onError={() => setHasMediaError(true)}
            />
          ) : null}

          {moment.mediaType === "video" ? (
            <span className={styles.videoBadge} aria-hidden="true">
              <svg viewBox="0 0 12 12" fill="currentColor">
                <path d="M9.7 5.13a1 1 0 0 1 0 1.74L4.5 9.84A1 1 0 0 1 3 8.97V3.03a1 1 0 0 1 1.5-.87L9.7 5.13Z" />
              </svg>
              Video
            </span>
          ) : null}
        </span>

        <span className={styles.cardDetails}>
          <strong className={styles.cardName}>{moment.guestName}</strong>
          {moment.caption ? (
            <span className={styles.cardCaption}>{moment.caption}</span>
          ) : null}
        </span>
      </button>
    </article>
  );
}
