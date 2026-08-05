export const RSVP_STORAGE_VERSION = 1 as const;
export const DEFAULT_RSVP_STORAGE_KEY = "our-journey:rsvp";
export const DEFAULT_MAX_GUESTS = 4;
export const RSVP_NOTES_MAX_LENGTH = 600;

export type AttendanceResponse = "attending" | "declining";

export interface RSVPFormValues {
  name: string;
  attendance: AttendanceResponse | "";
  guestCount: number;
  notes: string;
}

export interface RSVPPayload {
  name: string;
  attendance: AttendanceResponse;
  guestCount: number;
  notes: string;
  submittedAt: string;
}

export interface RSVPSubmissionReceipt {
  id: string;
  receivedAt: string;
}

export type RSVPSubmitHandler = (
  payload: RSVPPayload,
) => Promise<RSVPSubmissionReceipt | void> | RSVPSubmissionReceipt | void;

export type RSVPFieldErrors = Partial<
  Record<keyof RSVPFormValues, string>
>;

interface StoredRSVPState {
  version: typeof RSVP_STORAGE_VERSION;
  values: RSVPFormValues;
  submittedAt: string | null;
}

export interface RestoredRSVPState {
  values: RSVPFormValues;
  submittedAt: string | null;
}

export function normaliseMaxGuests(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_GUESTS;
  }

  return Math.max(1, Math.min(20, Math.floor(value as number)));
}

export function createInitialRSVPValues(defaultName = ""): RSVPFormValues {
  return {
    name: defaultName.trim(),
    attendance: "",
    guestCount: 1,
    notes: "",
  };
}

export function createRSVPStorageKey(defaultName = ""): string {
  const guestSegment = defaultName
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return guestSegment
    ? `${DEFAULT_RSVP_STORAGE_KEY}:${guestSegment}`
    : DEFAULT_RSVP_STORAGE_KEY;
}

export function validateRSVP(
  values: RSVPFormValues,
  maxGuests: number,
): RSVPFieldErrors {
  const errors: RSVPFieldErrors = {};
  const name = values.name.trim();

  if (!name) {
    errors.name = "Please tell us your name.";
  }

  if (!values.attendance) {
    errors.attendance = "Please choose an attendance response.";
  }

  if (
    values.attendance === "attending" &&
    (!Number.isInteger(values.guestCount) ||
      values.guestCount < 1 ||
      values.guestCount > maxGuests)
  ) {
    errors.guestCount = `Please choose between 1 and ${maxGuests} ${
      maxGuests === 1 ? "guest" : "guests"
    }.`;
  }

  if (values.notes.length > RSVP_NOTES_MAX_LENGTH) {
    errors.notes = `Please keep your note under ${RSVP_NOTES_MAX_LENGTH} characters.`;
  }

  return errors;
}

export function createRSVPPayload(values: RSVPFormValues): RSVPPayload {
  if (!values.attendance) {
    throw new Error("An attendance response is required.");
  }

  return {
    name: values.name.trim(),
    attendance: values.attendance,
    guestCount: values.attendance === "declining" ? 0 : values.guestCount,
    notes: values.notes.trim(),
    submittedAt: new Date().toISOString(),
  };
}

function isAttendanceResponse(
  value: unknown,
): value is AttendanceResponse | "" {
  return value === "" || value === "attending" || value === "declining";
}

function isValidStoredState(value: unknown): value is StoredRSVPState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StoredRSVPState>;
  const formValues = candidate.values as Partial<RSVPFormValues> | undefined;

  return (
    candidate.version === RSVP_STORAGE_VERSION &&
    Boolean(formValues) &&
    typeof formValues?.name === "string" &&
    isAttendanceResponse(formValues.attendance) &&
    typeof formValues.guestCount === "number" &&
    Number.isFinite(formValues.guestCount) &&
    typeof formValues.notes === "string" &&
    (candidate.submittedAt === null ||
      typeof candidate.submittedAt === "string")
  );
}

export function restoreRSVPState(
  storageKey: string,
  maxGuests: number,
  defaultName = "",
): RestoredRSVPState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawState = window.localStorage.getItem(storageKey);

    if (!rawState) {
      return null;
    }

    const parsedState: unknown = JSON.parse(rawState);

    if (!isValidStoredState(parsedState)) {
      return null;
    }

    const attendance = parsedState.values.attendance;
    const guestCount =
      attendance === "declining"
        ? 0
        : Math.max(1, Math.min(maxGuests, parsedState.values.guestCount));

    return {
      values: {
        name: parsedState.values.name.trim() || defaultName.trim(),
        attendance,
        guestCount,
        notes: parsedState.values.notes.slice(0, RSVP_NOTES_MAX_LENGTH),
      },
      submittedAt: parsedState.submittedAt,
    };
  } catch {
    return null;
  }
}

export function persistRSVPState(
  storageKey: string,
  values: RSVPFormValues,
  submittedAt: string | null,
): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const state: StoredRSVPState = {
    version: RSVP_STORAGE_VERSION,
    values,
    submittedAt,
  };

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export async function mockSubmitRSVP(
  payload: RSVPPayload,
): Promise<RSVPSubmissionReceipt> {
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 700);
  });

  return {
    id: `local-${payload.submittedAt}`,
    receivedAt: payload.submittedAt,
  };
}
