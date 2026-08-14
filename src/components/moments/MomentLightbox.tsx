import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { createMomentAltText } from "../../lib/moments/gallery";
import type { Moment } from "../../lib/moments/types";

import styles from "./MomentsGallery.module.css";

export interface MomentLightboxProps {
  moment: Moment;
  position: number;
  total: number;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

interface PointerOrigin {
  pointerId: number;
  x: number;
  y: number;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "video[controls]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function formatMomentTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Shared recently";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function visibleFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      (element.offsetWidth > 0 || element.offsetHeight > 0),
  );
}

export default function MomentLightbox({
  moment,
  position,
  total,
  onClose,
  onPrevious,
  onNext,
}: MomentLightboxProps) {
  const reactId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pointerOriginRef = useRef<PointerOrigin | null>(null);
  const callbacksRef = useRef({ onClose, onPrevious, onNext });
  const [failedMomentId, setFailedMomentId] = useState<string | null>(null);

  callbacksRef.current = { onClose, onPrevious, onNext };

  const titleId = `${reactId}-title`;
  const captionId = `${reactId}-caption`;
  const timeId = `${reactId}-time`;
  const announcementId = `${reactId}-announcement`;
  const hasSeveralMoments = total > 1;
  const formattedTime = formatMomentTime(moment.createdAt);
  const altText = createMomentAltText(moment);
  const hasMediaError = failedMomentId === moment.id;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const body = document.body;
    const documentElement = document.documentElement;
    const scrollY = window.scrollY;
    const scrollbarWidth = Math.max(
      0,
      window.innerWidth - documentElement.clientWidth,
    );
    const originalBodyStyles = {
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    const originalRootStyles = {
      overflow: documentElement.style.overflow,
      overscrollBehavior: documentElement.style.overscrollBehavior,
      scrollBehavior: documentElement.style.scrollBehavior,
    };

    if (scrollbarWidth > 0) {
      const currentPadding = Number.parseFloat(
        window.getComputedStyle(body).paddingRight,
      );
      body.style.paddingRight = `${(Number.isFinite(currentPadding) ? currentPadding : 0) + scrollbarWidth}px`;
    }

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    documentElement.style.overflow = "hidden";
    documentElement.style.overscrollBehavior = "none";

    closeButtonRef.current?.focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        callbacksRef.current.onClose();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        callbacksRef.current.onPrevious();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        callbacksRef.current.onNext();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusableElements = visibleFocusableElements(dialogRef.current);

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current.focus({ preventScroll: true });
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement?.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement?.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);

      body.style.overflow = originalBodyStyles.overflow;
      body.style.paddingRight = originalBodyStyles.paddingRight;
      body.style.position = originalBodyStyles.position;
      body.style.top = originalBodyStyles.top;
      body.style.width = originalBodyStyles.width;
      documentElement.style.overflow = originalRootStyles.overflow;
      documentElement.style.overscrollBehavior =
        originalRootStyles.overscrollBehavior;
      documentElement.style.scrollBehavior = "auto";
      window.scrollTo(0, scrollY);
      documentElement.style.scrollBehavior = originalRootStyles.scrollBehavior;

      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab" && event.target === event.currentTarget) {
      const firstElement = visibleFocusableElements(event.currentTarget)[0];
      if (firstElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      (event.target instanceof Element &&
        event.target.closest("button, video[controls]"))
    ) {
      pointerOriginRef.current = null;
      return;
    }

    pointerOriginRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const origin = pointerOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) {
      return;
    }

    const distanceX = Math.abs(event.clientX - origin.x);
    const distanceY = Math.abs(event.clientY - origin.y);
    if (distanceX > 8 && distanceX > distanceY) {
      event.preventDefault();
    }
  }

  function finishPointerGesture(event: ReactPointerEvent<HTMLDivElement>) {
    const origin = pointerOriginRef.current;
    pointerOriginRef.current = null;

    if (!origin || origin.pointerId !== event.pointerId || !hasSeveralMoments) {
      return;
    }

    const distanceX = event.clientX - origin.x;
    const distanceY = event.clientY - origin.y;
    const threshold = Math.min(88, Math.max(48, window.innerWidth * 0.12));

    if (
      Math.abs(distanceX) < threshold ||
      Math.abs(distanceX) <= Math.abs(distanceY) * 1.2
    ) {
      return;
    }

    if (distanceX > 0) {
      onPrevious();
    } else {
      onNext();
    }
  }

  return (
    <div className={styles.lightboxBackdrop}>
      <div
        ref={dialogRef}
        className={styles.lightboxDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${moment.caption ? `${captionId} ` : ""}${timeId}`}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <header className={styles.lightboxTopbar}>
          <p className={styles.lightboxPosition} aria-hidden="true">
            {position} of {total}
          </p>
          <span
            className={styles.srOnly}
            id={announcementId}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            Showing moment {position} of {total}
          </span>
          <button
            ref={closeButtonRef}
            className={styles.iconButton}
            type="button"
            onClick={onClose}
            aria-label="Close moment viewer"
          >
            <span className={styles.closeIcon} aria-hidden="true" />
          </button>
        </header>

        <div
          className={styles.lightboxViewport}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerGesture}
          onPointerCancel={() => {
            pointerOriginRef.current = null;
          }}
        >
          <div className={styles.lightboxMediaWrap} key={moment.id}>
            {hasMediaError ? (
              <div className={styles.lightboxFallback} role="status">
                This moment could not be displayed just now. You can still move
                to another one.
              </div>
            ) : moment.mediaType === "video" ? (
              <video
                className={`${styles.lightboxMedia} ${styles.lightboxVideo}`}
                src={moment.previewUrl}
                poster={moment.thumbnailUrl}
                controls
                playsInline
                preload="metadata"
                aria-label={altText}
                onError={() => setFailedMomentId(moment.id)}
              />
            ) : (
              <img
                className={styles.lightboxMedia}
                src={moment.previewUrl}
                alt={altText}
                width={moment.width}
                height={moment.height}
                decoding="async"
                draggable={false}
                onError={() => setFailedMomentId(moment.id)}
              />
            )}
          </div>

          {hasSeveralMoments ? (
            <>
              <button
                className={`${styles.navButton} ${styles.navPrevious}`}
                type="button"
                onClick={onPrevious}
                aria-label="View previous moment"
              >
                <span
                  className={`${styles.chevron} ${styles.chevronPrevious}`}
                  aria-hidden="true"
                />
              </button>
              <button
                className={`${styles.navButton} ${styles.navNext}`}
                type="button"
                onClick={onNext}
                aria-label="View next moment"
              >
                <span
                  className={`${styles.chevron} ${styles.chevronNext}`}
                  aria-hidden="true"
                />
              </button>
            </>
          ) : null}
        </div>

        <footer className={styles.lightboxMeta}>
          <h2 className={styles.lightboxName} id={titleId}>
            {moment.guestName}
          </h2>
          {moment.caption ? (
            <p className={styles.lightboxCaption} id={captionId}>
              {moment.caption}
            </p>
          ) : null}
          <time
            className={styles.lightboxTime}
            id={timeId}
            dateTime={moment.createdAt}
          >
            {formattedTime}
          </time>
        </footer>
      </div>
    </div>
  );
}
