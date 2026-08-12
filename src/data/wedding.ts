import type { AttendanceResponse } from "../lib/rsvp";

export interface WeddingScheduleItem {
  time: string;
  label: string;
}

export interface AttendanceOption {
  value: AttendanceResponse;
  label: string;
}

export interface WeddingContact {
  label: string;
  name: string;
  phone: string;
}

export type WeddingSide = "bride" | "groom";

export interface WeddingAudioConfig {
  enabled: boolean;
  title: string;
  src: string;
}

export interface WeddingCountdownConfig {
  enabled: boolean;
  targetDateTime: string;
  todayMessage: string;
  completedMessage: string;
}

export interface WeddingContactVariant {
  heading: string;
  contacts: readonly WeddingContact[];
}

export interface WeddingContent {
  monogram: string;
  couple: {
    groom: string;
    bride: string;
    finalBride: string;
  };
  opening: {
    basmala: string;
    salam: string;
    familyLine: string;
    invitationLine: readonly [string, string];
    scrollCue: string;
  };
  saveTheDate: {
    label: string;
    day: string;
    month: string;
    year: string;
    weekday: string;
  };
  formalInvitation: {
    eyebrow: string;
    gratitude: readonly [string, string];
    familyInvitation: readonly [string, string];
    honorifics: readonly [string, string];
    ceremonyLine: string;
  };
  story: {
    heading: string;
    quote: string;
    lines: readonly string[];
  };
  event: {
    weekday: string;
    date: string;
    isoDate: string;
    isoDateTime: string;
    numericDate: string;
    time: string;
  };
  venue: {
    name: string;
    address: string;
    googleMapsUrl: string;
    wazeUrl: string;
  };
  schedule: readonly WeddingScheduleItem[];
  doa: {
    heading: string;
    arabic: string;
    meaning: string;
    languageLabel: string;
  };
  audio: WeddingAudioConfig;
  countdown: WeddingCountdownConfig;
  contactVariants: Readonly<Record<WeddingSide, WeddingContactVariant>>;
  contacts: readonly WeddingContact[];
  finalMessage: readonly [string, string];
  attendanceRequest: readonly [string, string];
  rsvp: {
    heading: string;
    introduction: readonly [string, string];
    attendanceOptions: readonly AttendanceOption[];
    submitLabel: string;
  };
}

const weddingDateTime = "2027-06-14T11:00:00+08:00";

/**
 * The single editable source for public wedding content.
 * Keep unknown details as obvious placeholders or empty values rather than
 * inventing family names, contacts, or navigation links.
 */
export const wedding = {
  monogram: "A + A",
  couple: {
    groom: "ALEEM",
    bride: "NURULAIN",
    finalBride: "AIN",
  },
  opening: {
    basmala: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
    salam: "Assalamualaikum Warahmatullahi Wabarakatuh",
    familyLine: "Together with our families",
    invitationLine: [
      "invite you to celebrate",
      "the beginning of our forever",
    ],
    scrollCue: "Begin the journey",
  },
  saveTheDate: {
    label: "Save the date",
    day: "14",
    month: "June",
    year: "2027",
    // The supplied invitation brief specifies Saturday, although 14 June 2027
    // falls on a Monday. Preserve the supplied copy until the date is confirmed.
    weekday: "Saturday",
  },
  formalInvitation: {
    eyebrow: "Walimatul Urus",
    gratitude: ["Dengan penuh kesyukuran", "ke hadrat Allah SWT,"],
    familyInvitation: [
      "kami sekeluarga dengan sukacitanya",
      "menjemput",
    ],
    honorifics: ["Tuan / Puan /", "Encik / Cik"],
    ceremonyLine: "ke majlis perkahwinan",
  },
  story: {
    heading: "Our Story",
    quote:
      "Some meetings feel less like chance and more like a promise finally finding its way home.",
    lines: [
      "What began with an ordinary conversation grew into friendship, and then a quiet certainty.",
      "Through shared days, long prayers, and all the ordinary moments between, we found a home in one another.",
      "By the grace of Allah, we are ready for our next chapter.",
    ],
  },
  event: {
    weekday: "Saturday",
    date: "14 June 2027",
    isoDate: "2027-06-14",
    isoDateTime: weddingDateTime,
    numericDate: "14 · 06 · 2027",
    time: "11:00 AM — 4:00 PM",
  },
  venue: {
    name: "The Fullerton Hotel",
    address: "1 Fullerton Square, Singapore 049178",
    googleMapsUrl: "https://maps.app.goo.gl/PNjUGDSRr3GHKTnV6",
    wazeUrl: "https://ul.waze.com/ul?venue_id=68091917.680591489.628873&overview=yes&utm_campaign=default&utm_source=waze_website&utm_medium=lm_share_location",
  },
  schedule: [
    { time: "11:00 AM", label: "Guest Arrival" },
    { time: "12:00 PM", label: "Nikah Ceremony" },
    { time: "1:00 PM", label: "Lunch Reception" },
    { time: "4:00 PM", label: "Celebration Ends" },
  ],
  doa: {
    heading: "Doa Buat Pengantin",
    arabic: "بَارَكَ اللَّهُ لَكَ وَبَارَكَ عَلَيْكَ وَجَمَعَ بَيْنَكُمَا فِي خَيْرٍ",
    meaning:
      "Semoga Allah memberkatimu, melimpahkan keberkatan ke atasmu, dan menghimpunkan kamu berdua dalam kebaikan.",
    languageLabel: "Maksudnya",
  },
  audio: {
    enabled: true,
    title: "Our Song",
    // GitHub Pages-safe, BASE_URL-relative placeholder. Add the licensed audio
    // file at public/assets/audio/our-song.mp3 or replace this path.
    src: "assets/audio/our-song.mp3",
  },
  countdown: {
    enabled: true,
    targetDateTime: weddingDateTime,
    todayMessage: "Today is the day.",
    completedMessage: "Our celebration has begun.",
  },
  contactVariants: {
    bride: {
      heading: "For the bride’s family",
      // Add public phone numbers before launch; incomplete entries stay hidden.
      contacts: [
        { label: "Bride’s Father", name: "Abdul Wahab", phone: "" },
        { label: "Bride’s Mother", name: "Marsila", phone: "" },
      ],
    },
    groom: {
      heading: "For the groom’s family",
      // Add public phone numbers before launch; incomplete entries stay hidden.
      contacts: [
        { label: "Groom’s Father", name: "Abdul Jamal Salam", phone: "" },
        { label: "Groom’s Mother", name: "Saadiah Hadi", phone: "" },
      ],
    },
  },
  // Leave empty until the couple supplies real, public contact details.
  // This legacy list controls the optional contact beat in the ascent; family
  // contacts for the RSVP scene live in contactVariants above.
  contacts: [] as readonly WeddingContact[],
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
    introduction: [
      "It would mean so much to have you",
      "share this day with us.",
    ],
    attendanceOptions: [
      { value: "attending", label: "InshaAllah, I will be there" },
      { value: "declining", label: "Regretfully, I cannot attend" },
    ],
    submitLabel: "Submit RSVP",
  },
} as const satisfies WeddingContent;
