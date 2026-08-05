import type { AttendanceResponse } from "../lib/rsvp";

export interface InvitationTimelineItem {
  time: string;
  label: string;
}

export interface AttendanceOption {
  value: AttendanceResponse;
  label: string;
}

export interface InviteCodeData {
  code: string;
  guestName: string;
  maxPax: number;
  greeting: string;
  reservationMessage: string;
}

export interface InvitationContent {
  monogram: string;
  couple: {
    firstName: string;
    partnerName: string;
    finalPartnerName: string;
  };
  opening: {
    familyLine: string;
    invitationLine: readonly [string, string];
    scrollCue: string;
  };
  event: {
    weekday: string;
    date: string;
    isoDate: string;
    numericDate: string;
    time: string;
    venue: string;
    location: string;
  };
  timeline: readonly InvitationTimelineItem[];
  finalMessage: readonly [string, string];
  attendanceRequest: readonly [string, string];
  rsvp: {
    heading: string;
    attendanceOptions: readonly AttendanceOption[];
    submitLabel: string;
  };
}

export const invitation = {
  monogram: "A + A",
  couple: {
    firstName: "ALEEM",
    partnerName: "[PARTNER NAME]",
    finalPartnerName: "[PARTNER]",
  },
  opening: {
    familyLine: "Together with our families",
    invitationLine: [
      "invite you to celebrate",
      "the beginning of our forever",
    ],
    scrollCue: "Begin the journey",
  },
  event: {
    // Intentionally preserve the supplied copy: 14 June 2027 falls on a Monday,
    // while the invitation brief explicitly calls the day Saturday.
    weekday: "Saturday",
    date: "14 June 2027",
    isoDate: "2027-06-14",
    numericDate: "14 · 06 · 2027",
    time: "11:00 AM — 4:00 PM",
    venue: "VENUE NAME",
    location: "Singapore",
  },
  timeline: [
    { time: "11:00", label: "Guest Arrival" },
    { time: "12:00", label: "Nikah Ceremony" },
    { time: "1:00", label: "Lunch Reception" },
    { time: "4:00", label: "Celebration Ends" },
  ],
  finalMessage: [
    "And so, beneath the same sky,",
    "we begin forever.",
  ],
  attendanceRequest: [
    "We would be honoured",
    "to have you with us.",
  ],
  rsvp: {
    heading: "RSVP",
    attendanceOptions: [
      { value: "attending", label: "InshaAllah, I will be there" },
      { value: "declining", label: "Regretfully, I cannot attend" },
    ],
    submitLabel: "Submit RSVP",
  },
} as const satisfies InvitationContent;

export const inviteCodes = {
  ABC123: {
    code: "ABC123",
    guestName: "Ivan Tan",
    maxPax: 2,
    greeting: "Assalamualaikum Ivan,",
    reservationMessage: "This invitation is reserved for up to 2 guests.",
  },
} as const satisfies Record<string, InviteCodeData>;

export type InviteCode = keyof typeof inviteCodes;

export function getInviteByCode(code: string): InviteCodeData | undefined {
  const normalizedCode = code.trim().toUpperCase();
  return inviteCodes[normalizedCode as InviteCode];
}
