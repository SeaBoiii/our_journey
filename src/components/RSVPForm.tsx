import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type SubmitEvent,
} from "react";

import { invitation } from "../data/invitation";
import {
  RSVP_NOTES_MAX_LENGTH,
  createInitialRSVPValues,
  createRSVPPayload,
  createRSVPStorageKey,
  mockSubmitRSVP,
  normaliseMaxGuests,
  persistRSVPState,
  restoreRSVPState,
  validateRSVP,
  type AttendanceResponse,
  type RSVPFieldErrors,
  type RSVPFormValues,
  type RSVPSubmitHandler,
} from "../lib/rsvp";

import styles from "./RSVPForm.module.css";

export interface RSVPFormProps {
  maxGuests?: number;
  defaultName?: string;
  storageKey?: string;
  onSubmit?: RSVPSubmitHandler;
  className?: string;
}

type SubmissionState =
  | { phase: "idle"; message: "" }
  | { phase: "submitting"; message: string }
  | { phase: "success"; message: string }
  | { phase: "error"; message: string };

const idleSubmissionState: SubmissionState = { phase: "idle", message: "" };

function firstErrorField(errors: RSVPFieldErrors): keyof RSVPFormValues | null {
  const fieldOrder: (keyof RSVPFormValues)[] = [
    "name",
    "attendance",
    "guestCount",
    "notes",
  ];

  return fieldOrder.find((field) => errors[field]) ?? null;
}

export default function RSVPForm({
  maxGuests,
  defaultName = "",
  storageKey,
  onSubmit,
  className,
}: RSVPFormProps) {
  const reactId = useId();
  const fieldIds = useMemo(
    () => ({
      heading: `${reactId}-heading`,
      name: `${reactId}-name`,
      nameError: `${reactId}-name-error`,
      attendance: `${reactId}-attendance`,
      attendanceError: `${reactId}-attendance-error`,
      guestCount: `${reactId}-guest-count`,
      guestCountHelp: `${reactId}-guest-count-help`,
      guestCountError: `${reactId}-guest-count-error`,
      notes: `${reactId}-notes`,
      notesHelp: `${reactId}-notes-help`,
      notesError: `${reactId}-notes-error`,
      status: `${reactId}-status`,
    }),
    [reactId],
  );

  const safeMaxGuests = useMemo(
    () => normaliseMaxGuests(maxGuests),
    [maxGuests],
  );
  const resolvedStorageKey = useMemo(
    () => storageKey?.trim() || createRSVPStorageKey(defaultName),
    [defaultName, storageKey],
  );

  const [values, setValues] = useState<RSVPFormValues>(() =>
    createInitialRSVPValues(defaultName),
  );
  const [errors, setErrors] = useState<RSVPFieldErrors>({});
  const [submission, setSubmission] =
    useState<SubmissionState>(idleSubmissionState);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const fieldRefs = useRef<Partial<Record<keyof RSVPFormValues, HTMLElement>>>(
    {},
  );

  useEffect(() => {
    setHasHydrated(false);

    const restored = restoreRSVPState(
      resolvedStorageKey,
      safeMaxGuests,
      defaultName,
    );

    if (restored) {
      setValues(restored.values);
      setSubmittedAt(restored.submittedAt);

      if (restored.submittedAt) {
        setSubmission({
          phase: "success",
          message: "Your response is saved on this device. Thank you.",
        });
      } else {
        setSubmission(idleSubmissionState);
      }
    } else {
      setValues(createInitialRSVPValues(defaultName));
      setSubmittedAt(null);
      setSubmission(idleSubmissionState);
    }

    setErrors({});
    setHasHydrated(true);
  }, [defaultName, resolvedStorageKey, safeMaxGuests]);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    const persistenceTimer = window.setTimeout(() => {
      persistRSVPState(resolvedStorageKey, values, submittedAt);
    }, 250);

    return () => window.clearTimeout(persistenceTimer);
  }, [hasHydrated, resolvedStorageKey, submittedAt, values]);

  function markAsEdited(fields: (keyof RSVPFormValues)[]) {
    setErrors((currentErrors) => {
      const nextErrors = { ...currentErrors };

      for (const field of fields) {
        delete nextErrors[field];
      }

      return nextErrors;
    });
    setSubmittedAt(null);
    setSubmission(idleSubmissionState);
  }

  function updateName(name: string) {
    setValues((currentValues) => ({ ...currentValues, name }));
    markAsEdited(["name"]);
  }

  function updateAttendance(attendance: AttendanceResponse) {
    setValues((currentValues) => ({
      ...currentValues,
      attendance,
      guestCount:
        attendance === "declining"
          ? 0
          : Math.max(1, Math.min(safeMaxGuests, currentValues.guestCount)),
    }));
    markAsEdited(["attendance", "guestCount"]);
  }

  function updateGuestCount(nextCount: number) {
    const guestCount = Math.max(
      1,
      Math.min(safeMaxGuests, Math.round(nextCount || 1)),
    );

    setValues((currentValues) => ({ ...currentValues, guestCount }));
    markAsEdited(["guestCount"]);
  }

  function updateNotes(notes: string) {
    setValues((currentValues) => ({ ...currentValues, notes }));
    markAsEdited(["notes"]);
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submission.phase === "submitting") {
      return;
    }

    const nextErrors = validateRSVP(values, safeMaxGuests);

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setSubmission({
        phase: "error",
        message: "Please check the highlighted details and try again.",
      });

      const firstInvalidField = firstErrorField(nextErrors);
      if (firstInvalidField) {
        fieldRefs.current[firstInvalidField]?.focus();
      }
      return;
    }

    setErrors({});
    setSubmission({
      phase: "submitting",
      message: "Saving your response…",
    });

    const payload = createRSVPPayload(values);

    try {
      await (onSubmit ?? mockSubmitRSVP)(payload);

      const wasPersisted = persistRSVPState(
        resolvedStorageKey,
        {
          ...values,
          name: payload.name,
          guestCount: payload.guestCount,
          notes: payload.notes,
        },
        payload.submittedAt,
      );

      if (!wasPersisted && !onSubmit) {
        throw new Error("Local storage is unavailable.");
      }

      setValues((currentValues) => ({
        ...currentValues,
        name: payload.name,
        guestCount: payload.guestCount,
        notes: payload.notes,
      }));
      setSubmittedAt(payload.submittedAt);
      setSubmission({
        phase: "success",
        message: onSubmit
          ? "Your response has been received. Thank you."
          : "Your response is saved on this device. Thank you.",
      });
    } catch {
      setSubmission({
        phase: "error",
        message:
          "We could not save your response just now. Your details are still here—please try again.",
      });
    }
  }

  const isDeclining = values.attendance === "declining";
  const isSubmitting = submission.phase === "submitting";
  const shellClassName = [styles.shell, className].filter(Boolean).join(" ");

  return (
    <section className={shellClassName} aria-labelledby={fieldIds.heading}>
      <div className={styles.introduction}>
        <p className={styles.eyebrow}>Kindly respond</p>
        <h2 className={styles.heading} id={fieldIds.heading}>
          {invitation.rsvp.heading}
        </h2>
        <p className={styles.introCopy}>
          Your presence would mean the world to us. Please let us know if you
          can share the day.
        </p>
      </div>

      <form
        className={styles.form}
        onSubmit={handleSubmit}
        noValidate
        aria-busy={isSubmitting}
        aria-describedby={fieldIds.status}
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldIds.name}>
            Name <span className={styles.required}>Required</span>
          </label>
          <input
            ref={(element) => {
              fieldRefs.current.name = element ?? undefined;
            }}
            className={`${styles.textControl} ${
              errors.name ? styles.invalidControl : ""
            }`}
            id={fieldIds.name}
            name="name"
            type="text"
            autoComplete="name"
            value={values.name}
            onChange={(event) => updateName(event.currentTarget.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? fieldIds.nameError : undefined}
            disabled={isSubmitting}
            required
          />
          {errors.name ? (
            <p className={styles.fieldError} id={fieldIds.nameError}>
              {errors.name}
            </p>
          ) : null}
        </div>

        <fieldset
          className={styles.fieldset}
          aria-describedby={
            errors.attendance ? fieldIds.attendanceError : undefined
          }
        >
          <legend className={styles.label} id={fieldIds.attendance}>
            Attendance <span className={styles.required}>Required</span>
          </legend>
          <div className={styles.attendanceChoices}>
            {invitation.rsvp.attendanceOptions.map((option, index) => (
              <label className={styles.attendanceChoice} key={option.value}>
                <input
                  ref={(element) => {
                    if (index === 0) {
                      fieldRefs.current.attendance = element ?? undefined;
                    }
                  }}
                  className={styles.radioInput}
                  type="radio"
                  name="attendance"
                  value={option.value}
                  checked={values.attendance === option.value}
                  onChange={() => updateAttendance(option.value)}
                  aria-invalid={Boolean(errors.attendance)}
                  disabled={isSubmitting}
                  required
                />
                <span className={styles.choiceSurface}>
                  <span className={styles.choiceMark} aria-hidden="true" />
                  <span>{option.label}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.attendance ? (
            <p className={styles.fieldError} id={fieldIds.attendanceError}>
              {errors.attendance}
            </p>
          ) : null}
        </fieldset>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label className={styles.label} htmlFor={fieldIds.guestCount}>
              Number of guests
            </label>
            <span className={styles.limitText}>
              Up to {safeMaxGuests} {safeMaxGuests === 1 ? "guest" : "guests"}
            </span>
          </div>
          <div
            className={`${styles.guestPicker} ${
              errors.guestCount ? styles.invalidControl : ""
            }`}
          >
            <button
              className={styles.countButton}
              type="button"
              onClick={() => updateGuestCount(values.guestCount - 1)}
              disabled={isSubmitting || isDeclining || values.guestCount <= 1}
              aria-label="Decrease number of guests"
            >
              <span aria-hidden="true">−</span>
            </button>
            <input
              ref={(element) => {
                fieldRefs.current.guestCount = element ?? undefined;
              }}
              className={styles.guestInput}
              id={fieldIds.guestCount}
              name="guestCount"
              type="number"
              inputMode="numeric"
              min={1}
              max={safeMaxGuests}
              step={1}
              value={isDeclining ? 0 : values.guestCount}
              onChange={(event) =>
                updateGuestCount(event.currentTarget.valueAsNumber)
              }
              aria-invalid={Boolean(errors.guestCount)}
              aria-describedby={`${fieldIds.guestCountHelp}${
                errors.guestCount ? ` ${fieldIds.guestCountError}` : ""
              }`}
              disabled={isSubmitting || isDeclining}
            />
            <button
              className={styles.countButton}
              type="button"
              onClick={() => updateGuestCount(values.guestCount + 1)}
              disabled={
                isSubmitting ||
                isDeclining ||
                values.guestCount >= safeMaxGuests
              }
              aria-label="Increase number of guests"
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
          <p className={styles.helpText} id={fieldIds.guestCountHelp}>
            {isDeclining
              ? "No guest count is needed when you cannot attend."
              : "Please include yourself in the total."}
          </p>
          {errors.guestCount ? (
            <p className={styles.fieldError} id={fieldIds.guestCountError}>
              {errors.guestCount}
            </p>
          ) : null}
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label className={styles.label} htmlFor={fieldIds.notes}>
              Dietary requirements / notes
            </label>
            <span className={styles.limitText} aria-hidden="true">
              {values.notes.length}/{RSVP_NOTES_MAX_LENGTH}
            </span>
          </div>
          <textarea
            ref={(element) => {
              fieldRefs.current.notes = element ?? undefined;
            }}
            className={`${styles.textControl} ${styles.textarea} ${
              errors.notes ? styles.invalidControl : ""
            }`}
            id={fieldIds.notes}
            name="notes"
            value={values.notes}
            onChange={(event) => updateNotes(event.currentTarget.value)}
            rows={4}
            maxLength={RSVP_NOTES_MAX_LENGTH}
            aria-invalid={Boolean(errors.notes)}
            aria-describedby={`${fieldIds.notesHelp}${
              errors.notes ? ` ${fieldIds.notesError}` : ""
            }`}
            disabled={isSubmitting}
          />
          <p className={styles.helpText} id={fieldIds.notesHelp}>
            Optional — share allergies, dietary needs, or anything we should
            know.
          </p>
          {errors.notes ? (
            <p className={styles.fieldError} id={fieldIds.notesError}>
              {errors.notes}
            </p>
          ) : null}
        </div>

        <div className={styles.actionArea}>
          <button
            className={styles.submitButton}
            type="submit"
            disabled={isSubmitting}
          >
            <span>
              {isSubmitting ? "Saving response…" : invitation.rsvp.submitLabel}
            </span>
            <span className={styles.buttonFlourish} aria-hidden="true">
              ✦
            </span>
          </button>
          <div
            className={`${styles.status} ${
              submission.phase === "success" ? styles.successStatus : ""
            } ${submission.phase === "error" ? styles.errorStatus : ""}`}
            id={fieldIds.status}
            role={submission.phase === "error" ? "alert" : "status"}
            aria-live={submission.phase === "error" ? "assertive" : "polite"}
          >
            {submission.message}
          </div>
        </div>
      </form>
    </section>
  );
}
