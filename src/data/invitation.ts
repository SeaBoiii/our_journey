export {
  wedding as invitation,
  type AttendanceOption,
  type WeddingContent,
  type WeddingContact,
  type WeddingScheduleItem,
} from "./wedding";

export interface InviteCodeData {
  code: string;
  guestName: string;
  maxPax: number;
  greeting: string;
  reservationMessage: string;
}

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
