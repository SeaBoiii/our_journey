import type { WeddingSide } from "./wedding";

export {
  wedding as invitation,
  type AttendanceOption,
  type WeddingAudioConfig,
  type WeddingContactVariant,
  type WeddingContent,
  type WeddingContact,
  type WeddingCountdownConfig,
  type WeddingScheduleItem,
  type WeddingSide,
} from "./wedding";

export type InviteSide = WeddingSide;

export interface InviteCodeData {
  code: string;
  guestName: string;
  maxPax: number;
  greeting: string;
  reservationMessage: string;
  side: InviteSide;
}

export const inviteCodes = {
  ABC123: {
    code: "ABC123",
    guestName: "Ivan Tan",
    maxPax: 2,
    greeting: "Assalamualaikum Ivan,",
    reservationMessage: "This invitation is reserved for up to 2 guests.",
    // Sample metadata only; select the correct host-family side per invite.
    side: "groom",
  },
} as const satisfies Record<string, InviteCodeData>;

export type InviteCode = keyof typeof inviteCodes;

export function getInviteByCode(code: string): InviteCodeData | undefined {
  const normalizedCode = code.trim().toUpperCase();
  return inviteCodes[normalizedCode as InviteCode];
}
