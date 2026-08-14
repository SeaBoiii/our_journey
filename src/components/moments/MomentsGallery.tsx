import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  getApprovedMomentsNewestFirst,
  releaseMomentObjectUrls,
} from "../../lib/moments/gallery";
import type { Moment } from "../../lib/moments/types";
import { getMoments } from "../../lib/moments/upload";

import MomentCard from "./MomentCard";
import MomentLightbox from "./MomentLightbox";
import styles from "./MomentsGallery.module.css";

export interface MomentsGalleryProps {
  className?: string;
  captureHref?: string;
}

type GalleryPhase = "loading" | "ready" | "error";

const SKELETON_RATIOS = [
  "4 / 5",
  "1 / 1",
  "3 / 4",
  "16 / 11",
  "4 / 6",
  "5 / 4",
  "4 / 5",
  "3 / 2",
  "1 / 1",
  "4 / 5",
] as const;

function LoadingGallery() {
  return (
    <div role="status" aria-live="polite">
      <span className={styles.srOnly}>Gathering wedding moments…</span>
      <div className={styles.skeletonMasonry} aria-hidden="true">
        {SKELETON_RATIOS.map((ratio, index) => (
          <span
            className={styles.skeletonCard}
            style={{ aspectRatio: ratio }}
            key={`${ratio}-${index}`}
          />
        ))}
      </div>
    </div>
  );
}

interface GalleryStateProps {
  kind: "empty" | "error";
  captureHref: string;
  onRetry: () => void;
}

function GalleryState({ kind, captureHref, onRetry }: GalleryStateProps) {
  const isError = kind === "error";

  return (
    <div className={styles.stateShell}>
      <div className={styles.stateContent}>
        <span className={styles.stateCloud} aria-hidden="true" />
        <p className={styles.stateEyebrow}>
          {isError ? "A cloud passed by" : "The story starts here"}
        </p>
        <h2 className={styles.stateTitle}>
          {isError ? "We lost sight of the gallery" : "No moments just yet"}
        </h2>
        <p className={styles.stateCopy}>
          {isError
            ? "We couldn’t gather the photos this time. Your connection may have wandered—let’s try once more."
            : "Be the first to share the day through your eyes. Every little glance and happy tear belongs here."}
        </p>
        {isError ? (
          <>
            <p className={styles.errorDetail} role="alert">
              Nothing has been changed, and any moment you already shared is
              still safe.
            </p>
            <button className={styles.stateAction} type="button" onClick={onRetry}>
              Try again
            </button>
          </>
        ) : (
          <a className={styles.stateAction} href={captureHref}>
            Capture a moment
          </a>
        )}
      </div>
    </div>
  );
}

export default function MomentsGallery({
  className,
  captureHref = "../capture/",
}: MomentsGalleryProps) {
  const [phase, setPhase] = useState<GalleryPhase>("loading");
  const [moments, setMoments] = useState<Moment[]>([]);
  const [activeMomentId, setActiveMomentId] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const retainedMomentsRef = useRef<Moment[]>([]);

  const reloadGallery = useCallback(() => {
    setPhase("loading");
    setActiveMomentId(null);
    setReloadVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const previousMoments = retainedMomentsRef.current;
    retainedMomentsRef.current = [];
    releaseMomentObjectUrls(previousMoments);

    setPhase("loading");
    setMoments([]);
    setActiveMomentId(null);

    void getMoments({ status: "approved" })
      .then((providedMoments) => {
        if (isCancelled) {
          releaseMomentObjectUrls(providedMoments);
          return;
        }

        const approvedMoments = getApprovedMomentsNewestFirst(providedMoments);
        const approvedMomentIds = new Set(
          approvedMoments.map((moment) => moment.id),
        );
        const unusedMoments = providedMoments.filter(
          (moment) => !approvedMomentIds.has(moment.id),
        );

        releaseMomentObjectUrls(unusedMoments);
        retainedMomentsRef.current = approvedMoments;
        setMoments(approvedMoments);
        setPhase("ready");
      })
      .catch(() => {
        if (!isCancelled) {
          setPhase("error");
        }
      });

    return () => {
      isCancelled = true;
      const retainedMoments = retainedMomentsRef.current;
      retainedMomentsRef.current = [];
      releaseMomentObjectUrls(retainedMoments);
    };
  }, [reloadVersion]);

  const openMoment = useCallback((moment: Moment) => {
    setActiveMomentId(moment.id);
  }, []);

  const closeLightbox = useCallback(() => {
    setActiveMomentId(null);
  }, []);

  const showPreviousMoment = useCallback(() => {
    setActiveMomentId((currentId) => {
      if (moments.length < 2) {
        return currentId;
      }

      const currentIndex = moments.findIndex(
        (moment) => moment.id === currentId,
      );
      const previousIndex =
        (Math.max(0, currentIndex) - 1 + moments.length) % moments.length;
      return moments[previousIndex]?.id ?? currentId;
    });
  }, [moments]);

  const showNextMoment = useCallback(() => {
    setActiveMomentId((currentId) => {
      if (moments.length < 2) {
        return currentId;
      }

      const currentIndex = moments.findIndex(
        (moment) => moment.id === currentId,
      );
      const nextIndex = (Math.max(0, currentIndex) + 1) % moments.length;
      return moments[nextIndex]?.id ?? currentId;
    });
  }, [moments]);

  const activeIndex = activeMomentId
    ? moments.findIndex((moment) => moment.id === activeMomentId)
    : -1;
  const activeMoment = activeIndex >= 0 ? moments[activeIndex] : undefined;
  const shellClassName = [styles.galleryRoot, className]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={shellClassName}
      aria-label="Wedding moments gallery"
      aria-busy={phase === "loading"}
    >
      {phase === "ready" && moments.length > 0 ? (
        <>
          <header className={styles.galleryHeader}>
            <p className={styles.galleryCount}>
              {moments.length} {moments.length === 1 ? "moment" : "moments"} shared
            </p>
            <button
              className={styles.refreshButton}
              type="button"
              onClick={reloadGallery}
              aria-label="Refresh wedding moments"
              title="Refresh moments"
            >
              <svg
                className={styles.refreshIcon}
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M16.2 6.7A7 7 0 1 0 17 11"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <path
                  d="M16.25 3.7v3.25H13"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Refresh</span>
            </button>
          </header>

          <div className={styles.masonry}>
            {moments.map((moment, index) => (
              <MomentCard
                moment={moment}
                index={index}
                onOpen={openMoment}
                key={moment.id}
              />
            ))}
          </div>
        </>
      ) : phase === "loading" ? (
        <LoadingGallery />
      ) : phase === "error" ? (
        <GalleryState
          kind="error"
          captureHref={captureHref}
          onRetry={reloadGallery}
        />
      ) : (
        <GalleryState
          kind="empty"
          captureHref={captureHref}
          onRetry={reloadGallery}
        />
      )}

      {activeMoment && typeof document !== "undefined"
        ? createPortal(
            <MomentLightbox
              moment={activeMoment}
              position={activeIndex + 1}
              total={moments.length}
              onClose={closeLightbox}
              onPrevious={showPreviousMoment}
              onNext={showNextMoment}
            />,
            document.body,
          )
        : null}
    </section>
  );
}
