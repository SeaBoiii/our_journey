import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type SubmitEvent,
} from "react";

import {
  ACCEPTED_PHOTO_MIME_TYPES,
  MOMENTS_ACCEPT_ATTRIBUTE,
  MOMENTS_CONFIG,
} from "../../config/moments";
import type { MomentUploadProgress } from "../../lib/moments/types";
import {
  getMomentErrorMessage,
  uploadMoment,
  validateMomentFiles,
} from "../../lib/moments/upload";
import styles from "./CaptureMoment.module.css";
import UploadPreview, {
  type SelectedMedia,
  type SelectedMediaType,
} from "./UploadPreview";
import UploadProgress from "./UploadProgress";
import UploadSuccess from "./UploadSuccess";

const GUEST_NAME_MAX_LENGTH = MOMENTS_CONFIG.guestNameMaxLength;
const CAPTION_MAX_LENGTH = MOMENTS_CONFIG.captionMaxLength;
const PHOTO_ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_PHOTO_MIME_TYPES,
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
].join(",");

type CapturePhase = "editing" | "uploading" | "success";

interface FieldErrors {
  name?: string;
  media?: string;
}

export interface CaptureMomentProps {
  className?: string;
}

function createProgress(files: readonly File[] = []): MomentUploadProgress {
  return {
    phase: "validating",
    completedFiles: 0,
    totalFiles: files.length,
    uploadedBytes: 0,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
    percentage: 0,
  };
}

function formatLimit(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}

function identifyMediaType(file: File): SelectedMediaType {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return file.type.startsWith("video/") || extension === "mp4" || extension === "mov"
    ? "video"
    : "photo";
}

function fileIdentity(file: File): string {
  return [file.name.toLowerCase(), file.size, file.lastModified].join(":");
}

function joinIssues(messages: readonly string[]): string {
  const uniqueMessages = [...new Set(messages)];

  if (uniqueMessages.length <= 1) {
    return uniqueMessages[0] ?? "";
  }

  return `${uniqueMessages[0]} ${uniqueMessages.length - 1} more ${
    uniqueMessages.length === 2 ? "file was" : "files were"
  } not added.`;
}

export default function CaptureMoment({ className }: CaptureMomentProps) {
  const reactId = useId();
  const ids = useMemo(
    () => ({
      heading: `${reactId}-heading`,
      selectionHeading: `${reactId}-selection-heading`,
      limits: `${reactId}-limits`,
      mediaError: `${reactId}-media-error`,
      name: `${reactId}-name`,
      nameError: `${reactId}-name-error`,
      caption: `${reactId}-caption`,
      captionHelp: `${reactId}-caption-help`,
      formError: `${reactId}-form-error`,
    }),
    [reactId],
  );

  const [phase, setPhase] = useState<CapturePhase>("editing");
  const [selectedMedia, setSelectedMedia] = useState<SelectedMedia[]>([]);
  const [guestName, setGuestName] = useState("");
  const [caption, setCaption] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submissionError, setSubmissionError] = useState("");
  const [progress, setProgress] = useState<MomentUploadProgress>(() => createProgress());
  const [uploadedCount, setUploadedCount] = useState(0);
  const [cancelRequested, setCancelRequested] = useState(false);

  const objectUrlsRef = useRef(new Set<string>());
  const nextMediaIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);
  const selectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
      for (const objectUrl of objectUrlsRef.current) {
        URL.revokeObjectURL(objectUrl);
      }
      objectUrlsRef.current.clear();
    },
    [],
  );

  const shellClassName = [styles.shell, className].filter(Boolean).join(" ");
  const isAtFileLimit = selectedMedia.length >= MOMENTS_CONFIG.maxFilesPerUpload;

  function createSelectedMedia(file: File): SelectedMedia {
    let objectUrl = "";

    try {
      objectUrl = URL.createObjectURL(file);
      objectUrlsRef.current.add(objectUrl);
    } catch {
      // Uploads can still proceed when a browser cannot render a local preview.
    }

    nextMediaIdRef.current += 1;

    return {
      id: `${Date.now()}-${nextMediaIdRef.current}`,
      file,
      objectUrl,
      mediaType: identifyMediaType(file),
    };
  }

  function releaseMedia(items: readonly SelectedMedia[]) {
    for (const item of items) {
      if (!item.objectUrl || !objectUrlsRef.current.has(item.objectUrl)) {
        continue;
      }

      URL.revokeObjectURL(item.objectUrl);
      objectUrlsRef.current.delete(item.objectUrl);
    }
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList?.length) {
      return;
    }

    const nextItems = [...selectedMedia];
    const knownFiles = new Set(nextItems.map((item) => fileIdentity(item.file)));
    const rejectedMessages: string[] = [];

    for (const file of Array.from(fileList)) {
      const identity = fileIdentity(file);

      if (knownFiles.has(identity)) {
        rejectedMessages.push(`${file.name} is already in your selection.`);
        continue;
      }

      const issues = validateMomentFiles([...nextItems.map((item) => item.file), file]);
      if (issues.length > 0) {
        rejectedMessages.push(issues[0].message);
        continue;
      }

      nextItems.push(createSelectedMedia(file));
      knownFiles.add(identity);
    }

    setSelectedMedia(nextItems);
    setErrors((current) => ({
      ...current,
      media: joinIssues(rejectedMessages) || undefined,
    }));
    setSubmissionError("");
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    addFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  }

  function removeMedia(id: string) {
    const item = selectedMedia.find((candidate) => candidate.id === id);
    if (item) {
      releaseMedia([item]);
    }

    setSelectedMedia((current) => current.filter((candidate) => candidate.id !== id));
    setErrors((current) => ({ ...current, media: undefined }));
    setSubmissionError("");
  }

  function validateForm(): boolean {
    const nextErrors: FieldErrors = {};
    const trimmedName = guestName.trim();

    if (!trimmedName) {
      nextErrors.name = "Please tell us your name so we know who shared this moment.";
    }

    const mediaIssues = validateMomentFiles(selectedMedia.map((item) => item.file));
    if (mediaIssues.length > 0) {
      nextErrors.media = mediaIssues[0].message;
    }

    setErrors(nextErrors);

    if (nextErrors.media) {
      selectionHeadingRef.current?.focus();
    } else if (nextErrors.name) {
      nameInputRef.current?.focus();
    }

    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (phase !== "editing" || !validateForm()) {
      return;
    }

    const files = selectedMedia.map((item) => item.file);
    const nextProgress = createProgress(files);
    const abortController = new AbortController();

    abortControllerRef.current = abortController;
    cancelRequestedRef.current = false;
    setCancelRequested(false);
    setProgress(nextProgress);
    setSubmissionError("");
    setPhase("uploading");

    try {
      const result = await uploadMoment(
        {
          files,
          guestName: guestName.trim(),
          caption: caption.trim() || undefined,
        },
        {
          onProgress: setProgress,
          signal: abortController.signal,
        },
      );

      if (abortController.signal.aborted) {
        return;
      }

      setUploadedCount(result.submissions.length || files.length);
      releaseMedia(selectedMedia);
      setSelectedMedia([]);
      setCaption("");
      setPhase("success");
    } catch (error: unknown) {
      if (abortController.signal.aborted) {
        if (cancelRequestedRef.current) {
          setSubmissionError(
            "Upload cancelled. Your photos and note are still here when you’re ready to try again.",
          );
          setPhase("editing");
          window.requestAnimationFrame(() => formErrorRef.current?.focus());
        }
        return;
      }

      setSubmissionError(getMomentErrorMessage(error));
      setPhase("editing");
      window.requestAnimationFrame(() => formErrorRef.current?.focus());
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      cancelRequestedRef.current = false;
      setCancelRequested(false);
    }
  }

  function cancelUpload() {
    if (!abortControllerRef.current || cancelRequestedRef.current) {
      return;
    }
    cancelRequestedRef.current = true;
    setCancelRequested(true);
    abortControllerRef.current.abort();
  }

  function captureAnother() {
    setErrors({});
    setSubmissionError("");
    setUploadedCount(0);
    setProgress(createProgress());
    setPhase("editing");
    window.requestAnimationFrame(() => selectionHeadingRef.current?.focus());
  }

  if (phase === "uploading") {
    return (
      <div className={shellClassName}>
        <UploadProgress
          progress={progress}
          onCancel={cancelUpload}
          isCancelling={cancelRequested}
        />
      </div>
    );
  }

  if (phase === "success") {
    return (
      <div className={shellClassName}>
        <UploadSuccess
          guestName={guestName}
          uploadedCount={uploadedCount}
          onCaptureAnother={captureAnother}
          requiresModeration={MOMENTS_CONFIG.requireModeration}
          isMock={MOMENTS_CONFIG.backendProvider === "mock"}
        />
      </div>
    );
  }

  return (
    <section className={shellClassName} aria-labelledby={ids.heading}>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>Share what you see</p>
        <h1 className={styles.title} id={ids.heading}>
          Capture a moment
        </h1>
        <p className={styles.lede}>
          The quiet glances, the happy tears, the dancing—show us the day through your eyes.
        </p>
      </header>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.selectionPanel}>
          <h2
            className={styles.selectionHeading}
            id={ids.selectionHeading}
            ref={selectionHeadingRef}
            tabIndex={-1}
          >
            Choose your moment
          </h2>
          <p className={styles.selectionCopy}>Take a new photo or choose a few favourites.</p>

          <div className={styles.chooserGrid}>
            <label className={`${styles.chooser} ${styles.chooserPrimary}`}>
              <input
                className={styles.fileInput}
                type="file"
                name="camera"
                accept={PHOTO_ACCEPT_ATTRIBUTE}
                capture="environment"
                onChange={handleFileInput}
                aria-label="Take a photo with your camera"
                aria-describedby={`${ids.limits}${errors.media ? ` ${ids.mediaError}` : ""}`}
                disabled={isAtFileLimit}
              />
              <span className={styles.chooserIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M8.2 6.3 9.4 4h5.2l1.2 2.3H19A2.5 2.5 0 0 1 21.5 8.8v8.7A2.5 2.5 0 0 1 19 20H5a2.5 2.5 0 0 1-2.5-2.5V8.8A2.5 2.5 0 0 1 5 6.3h3.2Z" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="12" cy="13" r="3.6" />
                </svg>
              </span>
              <span className={styles.chooserText}>
                <span className={styles.chooserTitle}>Take a photo</span>
                <span className={styles.chooserHint}>Open your phone camera</span>
              </span>
            </label>

            <label className={styles.chooser}>
              <input
                className={styles.fileInput}
                type="file"
                name="gallery"
                accept={MOMENTS_ACCEPT_ATTRIBUTE}
                multiple
                onChange={handleFileInput}
                aria-label={
                  MOMENTS_CONFIG.allowVideos
                    ? "Choose photos or videos from your gallery"
                    : "Choose photos from your gallery"
                }
                aria-describedby={`${ids.limits}${errors.media ? ` ${ids.mediaError}` : ""}`}
                disabled={isAtFileLimit}
              />
              <span className={styles.chooserIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <rect x="3" y="4" width="18" height="16" rx="2.5" />
                  <circle cx="8.5" cy="9" r="1.5" />
                  <path d="m4.5 17 4.2-4.1 3.1 2.8 2.8-2.4 4.9 4.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className={styles.chooserText}>
                <span className={styles.chooserTitle}>Choose from gallery</span>
                <span className={styles.chooserHint}>
                  {MOMENTS_CONFIG.allowVideos ? "Select photos or short videos" : "Select several photos at once"}
                </span>
              </span>
            </label>
          </div>

          <p className={styles.limits} id={ids.limits}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="10" cy="10" r="7.5" />
              <path d="M10 8.7v4.2M10 6.3h.01" strokeLinecap="round" />
            </svg>
            <span>
              Up to {MOMENTS_CONFIG.maxFilesPerUpload} files · Photos up to {formatLimit(MOMENTS_CONFIG.maxPhotoSize)}
              {MOMENTS_CONFIG.allowVideos
                ? ` · Videos up to ${formatLimit(MOMENTS_CONFIG.maxVideoSize)}`
                : ""}
            </span>
          </p>

          {errors.media ? (
            <p className={styles.fieldError} id={ids.mediaError} role="alert">
              {errors.media}
            </p>
          ) : null}

          <UploadPreview
            items={selectedMedia}
            onRemove={removeMedia}
            maxFiles={MOMENTS_CONFIG.maxFilesPerUpload}
          />
        </div>

        <div className={styles.details}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={ids.name}>
              Your name <span className={styles.required}>Required</span>
            </label>
            <input
              ref={nameInputRef}
              className={`${styles.control} ${errors.name ? styles.invalid : ""}`}
              id={ids.name}
              name="guestName"
              type="text"
              autoComplete="name"
              maxLength={GUEST_NAME_MAX_LENGTH}
              value={guestName}
              onChange={(event) => {
                setGuestName(event.currentTarget.value);
                setErrors((current) => ({ ...current, name: undefined }));
                setSubmissionError("");
              }}
              placeholder="How should we remember you?"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? ids.nameError : undefined}
              required
            />
            {errors.name ? (
              <p className={styles.fieldError} id={ids.nameError}>
                {errors.name}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label className={styles.label} htmlFor={ids.caption}>
                A little note <span className={styles.optional}>Optional</span>
              </label>
              <span className={styles.counter} aria-hidden="true">
                {caption.length}/{CAPTION_MAX_LENGTH}
              </span>
            </div>
            <textarea
              className={`${styles.control} ${styles.textarea}`}
              id={ids.caption}
              name="caption"
              rows={4}
              maxLength={CAPTION_MAX_LENGTH}
              value={caption}
              onChange={(event) => {
                setCaption(event.currentTarget.value);
                setSubmissionError("");
              }}
              placeholder="A wish, a memory, or what made you smile…"
              aria-describedby={ids.captionHelp}
            />
            <p className={styles.helpText} id={ids.captionHelp}>
              Up to {CAPTION_MAX_LENGTH} characters. This will appear with your moment if it joins the gallery.
            </p>
          </div>
        </div>

        <div className={styles.submitArea}>
          {submissionError ? (
            <div
              className={styles.formError}
              id={ids.formError}
              ref={formErrorRef}
              role="alert"
              tabIndex={-1}
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <circle cx="10" cy="10" r="7.5" />
                <path d="M10 6.2v4.7M10 13.8h.01" strokeLinecap="round" />
              </svg>
              <span>{submissionError}</span>
            </div>
          ) : null}

          <button className={styles.submitButton} type="submit">
            <span>{submissionError ? "Try sharing again" : "Share this moment"}</span>
            <svg className={styles.submitIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M5 12h13m-5-5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <p className={styles.privacyNote}>
            {MOMENTS_CONFIG.backendProvider === "mock"
              ? "Preview mode: your moment is saved only in this browser."
              : "Shared privately with Aleem & Ain. Approved moments may appear in the wedding gallery."}
          </p>
        </div>
      </form>
    </section>
  );
}
