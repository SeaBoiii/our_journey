import type { Moment } from "./types";

function timestampFor(moment: Moment): number {
  const timestamp = Date.parse(moment.createdAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortMomentsNewestFirst(
  moments: readonly Moment[],
): Moment[] {
  return [...moments].sort((left, right) => {
    const timeDifference = timestampFor(right) - timestampFor(left);
    return timeDifference || right.id.localeCompare(left.id);
  });
}

export function filterApprovedMoments(
  moments: readonly Moment[],
): Moment[] {
  return moments.filter((moment) => moment.status === "approved");
}

export function getApprovedMomentsNewestFirst(
  moments: readonly Moment[],
): Moment[] {
  return sortMomentsNewestFirst(filterApprovedMoments(moments));
}

export function createMomentAltText(moment: Moment): string {
  const guestName = moment.guestName.trim();
  return guestName
    ? `A wedding moment shared by ${guestName}`
    : "A shared wedding moment";
}

export function releaseObjectUrl(url: string | null | undefined): void {
  if (
    !url?.startsWith("blob:") ||
    typeof URL === "undefined" ||
    typeof URL.revokeObjectURL !== "function"
  ) {
    return;
  }

  URL.revokeObjectURL(url);
}

export function releaseMomentObjectUrls(
  moments: Moment | readonly Moment[],
): void {
  const momentList = Array.isArray(moments) ? moments : [moments];
  const urls = new Set<string>();

  for (const moment of momentList) {
    urls.add(moment.previewUrl);

    if (moment.thumbnailUrl) {
      urls.add(moment.thumbnailUrl);
    }
  }

  for (const url of urls) {
    releaseObjectUrl(url);
  }
}

