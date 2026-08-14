import { MOMENTS_CONFIG } from "../../../config/moments";
import { withBase } from "../../paths";
import {
  releaseMomentObjectUrls,
  sortMomentsNewestFirst,
} from "../gallery";
import type {
  AdminMomentsOptions,
  AdminMomentsPage,
  GetMomentsOptions,
  Moment,
  MomentMediaType,
  MomentsProvider,
  MomentStatus,
  MomentUploadInput,
  MomentUploadProgress,
  MomentUploadResult,
  MomentsPage,
  UploadMomentOptions,
} from "../types";

const MOCK_DATABASE_NAME = "our-journey:moments:mock:v2";
const MOCK_DATABASE_VERSION = 2;
const METADATA_STORE_NAME = "moment-metadata";
const MEDIA_STORE_NAME = "moment-media";
const RECORD_SCHEMA_VERSION = 1 as const;

interface StoredMomentRecord {
  readonly schemaVersion: typeof RECORD_SCHEMA_VERSION;
  readonly id: string;
  readonly guestName: string;
  readonly caption: string;
  readonly createdAt: string;
  readonly mediaType: MomentMediaType;
  readonly status: MomentStatus;
  readonly mimeType?: string;
  readonly fileName?: string;
  readonly size?: number;
  readonly width?: number;
  readonly height?: number;
  readonly blobId?: string;
  readonly assetPath?: string;
  readonly thumbnailAssetPath?: string;
}

interface StoredMediaRecord {
  readonly id: string;
  readonly blob: Blob;
}

const SEEDED_MOMENTS = [
  {
    schemaVersion: RECORD_SCHEMA_VERSION,
    id: "mock-moment-walking-together",
    guestName: "Nadia",
    caption: "A quiet walk before the celebration began.",
    createdAt: "2026-08-14T08:42:00.000Z",
    mediaType: "photo",
    status: "approved",
    mimeType: "image/webp",
    width: 1024,
    height: 1536,
    assetPath: "assets/moments/mock/walking-together.webp",
    thumbnailAssetPath: "assets/moments/mock/walking-together-thumb.webp",
  },
  {
    schemaVersion: RECORD_SCHEMA_VERSION,
    id: "mock-moment-henna-bouquet",
    guestName: "Sofia",
    caption: "Henna, flowers, and the loveliest little details.",
    createdAt: "2026-08-14T08:18:00.000Z",
    mediaType: "photo",
    status: "approved",
    mimeType: "image/webp",
    width: 1024,
    height: 1536,
    assetPath: "assets/moments/mock/henna-bouquet.webp",
    thumbnailAssetPath: "assets/moments/mock/henna-bouquet-thumb.webp",
  },
  {
    schemaVersion: RECORD_SCHEMA_VERSION,
    id: "mock-moment-friends-laughing",
    guestName: "Imran",
    caption: "The kind of laughter we will remember forever.",
    createdAt: "2026-08-14T07:51:00.000Z",
    mediaType: "photo",
    status: "approved",
    mimeType: "image/webp",
    width: 1536,
    height: 1024,
    assetPath: "assets/moments/mock/friends-laughing.webp",
    thumbnailAssetPath: "assets/moments/mock/friends-laughing-thumb.webp",
  },
  {
    schemaVersion: RECORD_SCHEMA_VERSION,
    id: "mock-moment-table-details",
    guestName: "Mariam",
    caption: "Every place was waiting for someone we love.",
    createdAt: "2026-08-14T07:22:00.000Z",
    mediaType: "photo",
    status: "approved",
    mimeType: "image/webp",
    width: 1024,
    height: 1536,
    assetPath: "assets/moments/mock/table-details.webp",
    thumbnailAssetPath: "assets/moments/mock/table-details-thumb.webp",
  },
  {
    schemaVersion: RECORD_SCHEMA_VERSION,
    id: "mock-moment-cake-cutting",
    guestName: "Daniel",
    caption: "One sweet moment, caught just in time.",
    createdAt: "2026-08-14T09:04:00.000Z",
    mediaType: "photo",
    status: "pending",
    mimeType: "image/webp",
    width: 1024,
    height: 1536,
    assetPath: "assets/moments/mock/cake-cutting.webp",
    thumbnailAssetPath: "assets/moments/mock/cake-cutting-thumb.webp",
  },
  {
    schemaVersion: RECORD_SCHEMA_VERSION,
    id: "mock-moment-first-dance",
    guestName: "Farah",
    caption: "For a moment, the whole room disappeared.",
    createdAt: "2026-08-14T09:16:00.000Z",
    mediaType: "photo",
    status: "pending",
    mimeType: "image/webp",
    width: 1536,
    height: 1024,
    assetPath: "assets/moments/mock/first-dance.webp",
    thumbnailAssetPath: "assets/moments/mock/first-dance-thumb.webp",
  },
] as const satisfies readonly StoredMomentRecord[];

const memoryMetadata = new Map<string, StoredMomentRecord>(
  SEEDED_MOMENTS.map((moment) => [moment.id, moment]),
);
const memoryMedia = new Map<string, Blob>();

let databasePromise: Promise<IDBDatabase | null> | undefined;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMomentStatus(value: unknown): value is MomentStatus {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "hidden"
  );
}

function isMomentMediaType(value: unknown): value is MomentMediaType {
  return value === "photo" || value === "video";
}

function isStoredMomentRecord(value: unknown): value is StoredMomentRecord {
  return (
    isObject(value) &&
    value.schemaVersion === RECORD_SCHEMA_VERSION &&
    typeof value.id === "string" &&
    typeof value.guestName === "string" &&
    typeof value.caption === "string" &&
    typeof value.createdAt === "string" &&
    isMomentMediaType(value.mediaType) &&
    isMomentStatus(value.status) &&
    (typeof value.blobId === "string" || typeof value.assetPath === "string")
  );
}

function isStoredMediaRecord(value: unknown): value is StoredMediaRecord {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof Blob !== "undefined" &&
    value.blob instanceof Blob
  );
}

function openMockDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(MOCK_DATABASE_NAME, MOCK_DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      const metadataStore = database.objectStoreNames.contains(
        METADATA_STORE_NAME,
      )
        ? request.transaction?.objectStore(METADATA_STORE_NAME)
        : database.createObjectStore(METADATA_STORE_NAME, { keyPath: "id" });

      if (!database.objectStoreNames.contains(MEDIA_STORE_NAME)) {
        database.createObjectStore(MEDIA_STORE_NAME, { keyPath: "id" });
      }

      if (metadataStore) {
        for (const seededMoment of SEEDED_MOMENTS) {
          metadataStore.put(seededMoment);
        }
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Mock Moments storage could not open."));
    };
    request.onblocked = () => {
      reject(new Error("Mock Moments storage is blocked by another tab."));
    };
  });
}

async function getDatabase(): Promise<IDBDatabase | null> {
  databasePromise ??= openMockDatabase().catch(() => null);
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(request.error ?? new Error("Mock Moments storage request failed."));
    };
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      reject(
        transaction.error ?? new Error("Mock Moments storage transaction failed."),
      );
    };
    transaction.onabort = () => {
      reject(
        transaction.error ?? new Error("Mock Moments storage transaction stopped."),
      );
    };
  });
}

async function readStoredState(): Promise<{
  records: StoredMomentRecord[];
  media: Map<string, Blob>;
}> {
  const database = await getDatabase();

  if (!database) {
    return {
      records: [...memoryMetadata.values()],
      media: new Map(memoryMedia),
    };
  }

  try {
    const transaction = database.transaction(
      [METADATA_STORE_NAME, MEDIA_STORE_NAME],
      "readonly",
    );
    const rawRecordsPromise = requestResult<unknown[]>(
      transaction.objectStore(METADATA_STORE_NAME).getAll(),
    );
    const rawMediaPromise = requestResult<unknown[]>(
      transaction.objectStore(MEDIA_STORE_NAME).getAll(),
    );
    const [rawRecords, rawMedia] = await Promise.all([
      rawRecordsPromise,
      rawMediaPromise,
    ]);
    const media = new Map<string, Blob>();

    for (const candidate of rawMedia) {
      if (isStoredMediaRecord(candidate)) {
        media.set(candidate.id, candidate.blob);
      }
    }

    return {
      records: rawRecords.filter(isStoredMomentRecord),
      media,
    };
  } catch {
    return {
      records: [...memoryMetadata.values()],
      media: new Map(memoryMedia),
    };
  }
}

function createObjectUrl(blob: Blob): string | null {
  if (
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return null;
  }

  return URL.createObjectURL(blob);
}

function hydrateMoment(
  record: StoredMomentRecord,
  media: ReadonlyMap<string, Blob>,
): Moment | null {
  let previewUrl: string;
  let thumbnailUrl: string | undefined;

  if (record.assetPath) {
    previewUrl = withBase(record.assetPath);
    thumbnailUrl = record.thumbnailAssetPath
      ? withBase(record.thumbnailAssetPath)
      : previewUrl;
  } else if (record.blobId) {
    const blob = media.get(record.blobId);

    if (!blob) {
      return null;
    }

    const objectUrl = createObjectUrl(blob);

    if (!objectUrl) {
      return null;
    }

    previewUrl = objectUrl;
    thumbnailUrl = record.mediaType === "photo" ? objectUrl : undefined;
  } else {
    return null;
  }

  return {
    id: record.id,
    guestName: record.guestName,
    caption: record.caption,
    createdAt: record.createdAt,
    mediaType: record.mediaType,
    previewUrl,
    thumbnailUrl,
    status: record.status,
    width: record.width,
    height: record.height,
    mimeType: record.mimeType,
    fileName: record.fileName,
    size: record.size,
    processingStatus: "ready",
  };
}

function paginateMoments(
  moments: readonly Moment[],
  options: GetMomentsOptions,
): MomentsPage {
  const requestedLimit = Math.trunc(options.limit ?? 20);
  const limit = Math.min(
    20,
    Math.max(1, Number.isSafeInteger(requestedLimit) ? requestedLimit : 20),
  );
  const requestedOffset = Math.trunc(options.offset ?? 0);
  const offset =
    Number.isSafeInteger(requestedOffset) && requestedOffset >= 0
      ? requestedOffset
      : 0;
  const endOffset = Math.min(moments.length, offset + limit);
  const pageMoments = moments.slice(offset, endOffset);
  releaseMomentObjectUrls([
    ...moments.slice(0, offset),
    ...moments.slice(endOffset),
  ]);
  return {
    moments: pageMoments,
    nextOffset: endOffset < moments.length ? endOffset : null,
  };
}

function createIdentifier(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `mock-${crypto.randomUUID()}`;
  }

  return `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mediaTypeForUpload(file: File): MomentMediaType {
  const mimeType = file.type.toLocaleLowerCase();
  const extension = file.name.split(".").pop()?.toLocaleLowerCase();

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  return (!mimeType || mimeType === "application/octet-stream") &&
    (extension === "mp4" || extension === "mov")
    ? "video"
    : "photo";
}

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The upload was cancelled.", "AbortError");
  }

  const error = new Error("The upload was cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function reportProgress(
  callback: UploadMomentOptions["onProgress"],
  progress: MomentUploadProgress,
): void {
  try {
    callback?.(progress);
  } catch {
    // A rendering callback should never make the stored upload fail.
  }
}

async function yieldToBrowser(): Promise<void> {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 45));
}

async function writeUploadedRecords(
  records: readonly StoredMomentRecord[],
  mediaRecords: readonly StoredMediaRecord[],
): Promise<void> {
  const database = await getDatabase();

  if (database) {
    try {
      const transaction = database.transaction(
        [METADATA_STORE_NAME, MEDIA_STORE_NAME],
        "readwrite",
      );
      const metadataStore = transaction.objectStore(METADATA_STORE_NAME);
      const mediaStore = transaction.objectStore(MEDIA_STORE_NAME);

      for (const record of records) {
        metadataStore.put(record);
      }

      for (const mediaRecord of mediaRecords) {
        mediaStore.put(mediaRecord);
      }

      await transactionCompletion(transaction);
    } catch (cause) {
      const error = new Error(
        "This browser could not save the selected moment locally.",
        { cause },
      );
      error.name = "MomentsStorageError";
      throw error;
    }
  }

  for (const record of records) {
    memoryMetadata.set(record.id, record);
  }

  for (const mediaRecord of mediaRecords) {
    memoryMedia.set(mediaRecord.id, mediaRecord.blob);
  }
}

async function persistStatus(record: StoredMomentRecord): Promise<void> {
  const database = await getDatabase();

  if (database) {
    const transaction = database.transaction(METADATA_STORE_NAME, "readwrite");
    transaction.objectStore(METADATA_STORE_NAME).put(record);
    await transactionCompletion(transaction);
  }

  memoryMetadata.set(record.id, record);
}

async function removeStoredRecord(record: StoredMomentRecord): Promise<void> {
  const database = await getDatabase();

  if (database) {
    const storeNames = record.blobId
      ? [METADATA_STORE_NAME, MEDIA_STORE_NAME]
      : [METADATA_STORE_NAME];
    const transaction = database.transaction(storeNames, "readwrite");
    transaction.objectStore(METADATA_STORE_NAME).delete(record.id);

    if (record.blobId) {
      transaction.objectStore(MEDIA_STORE_NAME).delete(record.blobId);
    }

    await transactionCompletion(transaction);
  }

  memoryMetadata.delete(record.id);

  if (record.blobId) {
    memoryMedia.delete(record.blobId);
  }
}

class MockMomentsProvider implements MomentsProvider {
  async uploadMoment(
    input: MomentUploadInput,
    options: UploadMomentOptions = {},
  ): Promise<MomentUploadResult> {
    const totalBytes = input.files.reduce((sum, file) => sum + file.size, 0);
    const records: StoredMomentRecord[] = [];
    const mediaRecords: StoredMediaRecord[] = [];
    let uploadedBytes = 0;

    reportProgress(options.onProgress, {
      phase: "uploading",
      completedFiles: 0,
      totalFiles: input.files.length,
      uploadedBytes: 0,
      totalBytes,
      percentage: 0,
    });

    for (const [fileIndex, file] of input.files.entries()) {
      throwIfAborted(options.signal);
      await yieldToBrowser();
      throwIfAborted(options.signal);

      const id = createIdentifier();
      const blobId = `${id}:original`;
      const mediaType = mediaTypeForUpload(file);
      const record: StoredMomentRecord = {
        schemaVersion: RECORD_SCHEMA_VERSION,
        id,
        guestName: input.guestName.trim(),
        caption: input.caption?.trim() ?? "",
        createdAt: new Date().toISOString(),
        mediaType,
        status: MOMENTS_CONFIG.requireModeration ? "pending" : "approved",
        mimeType: file.type,
        fileName: file.name,
        size: file.size,
        blobId,
      };

      records.push(record);
      mediaRecords.push({ id: blobId, blob: file });
      uploadedBytes += file.size;

      reportProgress(options.onProgress, {
        phase: "uploading",
        completedFiles: fileIndex + 1,
        totalFiles: input.files.length,
        uploadedBytes,
        totalBytes,
        percentage:
          totalBytes === 0
            ? Math.round(((fileIndex + 1) / input.files.length) * 100)
            : Math.round((uploadedBytes / totalBytes) * 100),
        currentFileName: file.name,
      });
    }

    throwIfAborted(options.signal);
    await writeUploadedRecords(records, mediaRecords);

    reportProgress(options.onProgress, {
      phase: "complete",
      completedFiles: input.files.length,
      totalFiles: input.files.length,
      uploadedBytes: totalBytes,
      totalBytes,
      percentage: 100,
    });

    return {
      submissions: records.map((record) => ({
        id: record.id,
        status: record.status === "approved" ? "approved" : "pending",
        createdAt: record.createdAt,
        mediaType: record.mediaType,
      })),
    };
  }

  async getMoments(options: GetMomentsOptions = {}): Promise<MomentsPage> {
    return paginateMoments(
      await this.readMoments({ status: "approved" }),
      options,
    );
  }

  async getAdminMoments(
    options: AdminMomentsOptions = {},
  ): Promise<AdminMomentsPage> {
    return paginateMoments(await this.readMoments(options), options);
  }

  private async readMoments(
    options: AdminMomentsOptions,
  ): Promise<Moment[]> {
    const requestedStatus = options.status ?? "approved";
    const { records, media } = await readStoredState();
    const visibleRecords =
      requestedStatus === "all"
        ? records
        : records.filter((record) => record.status === requestedStatus);
    const moments = visibleRecords
      .map((record) => hydrateMoment(record, media))
      .filter((moment): moment is Moment => moment !== null);

    return sortMomentsNewestFirst(moments);
  }

  async deletePendingUpload(id: string): Promise<void> {
    const { records } = await readStoredState();
    const record = records.find((candidate) => candidate.id === id);

    if (!record) {
      const error = new Error("That moment could not be found.");
      error.name = "MomentsNotFoundError";
      throw error;
    }

    if (record.status !== "pending") {
      const error = new Error("Only a pending moment can be removed.");
      error.name = "MomentsNotPendingError";
      throw error;
    }

    await removeStoredRecord(record);
  }

  async updateMomentStatus(
    id: string,
    status: MomentStatus,
  ): Promise<Moment> {
    const { records, media } = await readStoredState();
    const record = records.find((candidate) => candidate.id === id);

    if (!record) {
      const error = new Error("That moment could not be found.");
      error.name = "MomentsNotFoundError";
      throw error;
    }

    const updatedRecord: StoredMomentRecord = { ...record, status };
    await persistStatus(updatedRecord);
    const moment = hydrateMoment(updatedRecord, media);

    if (!moment) {
      const error = new Error("That moment's local media is unavailable.");
      error.name = "MomentsStorageError";
      throw error;
    }

    return moment;
  }
}

export const mockMomentsProvider: MomentsProvider = new MockMomentsProvider();

export {
  MOCK_DATABASE_NAME,
  MOCK_DATABASE_VERSION,
};
