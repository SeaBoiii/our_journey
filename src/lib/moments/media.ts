import type { MomentMediaType } from "./types";

export interface PreparedDerivative {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly mimeType: "image/webp";
}

export interface PreparedMomentMedia {
  readonly mediaType: MomentMediaType;
  readonly width?: number;
  readonly height?: number;
  readonly gallery?: PreparedDerivative;
}

const GALLERY_MAX_DIMENSION = 1600;

function abortError(): DOMException {
  return new DOMException("Media preparation was cancelled.", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function scaledDimensions(
  width: number,
  height: number,
  maximumDimension: number,
): { width: number; height: number } {
  const scale = Math.min(1, maximumDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function canvasBlob(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maximumDimension: number,
  quality: number,
): Promise<PreparedDerivative> {
  const dimensions = scaledDimensions(
    sourceWidth,
    sourceHeight,
    maximumDimension,
  );
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("This browser could not prepare a gallery image.");
  }

  // A fresh canvas raster contains pixels only, stripping EXIF and GPS metadata.
  context.drawImage(source, 0, 0, dimensions.width, dimensions.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) =>
        result
          ? resolve(result)
          : reject(new Error("This browser could not encode a WebP image.")),
      "image/webp",
      quality,
    );
  });

  if (blob.type !== "image/webp") {
    throw new Error("This browser does not support WebP encoding.");
  }

  return { blob, ...dimensions, mimeType: "image/webp" };
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Creates public-display candidates without modifying the private original.
 * HEIC and browsers without a decoder return no derivatives; the backend may
 * process those originals asynchronously. Derivative failure never blocks the
 * original upload unless it was caused by explicit cancellation.
 */
export async function prepareMomentMedia(
  file: File,
  mediaType: MomentMediaType,
  signal?: AbortSignal,
): Promise<PreparedMomentMedia> {
  if (mediaType !== "photo" || typeof document === "undefined") {
    return { mediaType };
  }

  throwIfAborted(signal);
  let source: CanvasImageSource | undefined;
  let sourceWidth = 0;
  let sourceHeight = 0;
  let bitmap: ImageBitmap | undefined;

  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      source = bitmap;
      sourceWidth = bitmap.width;
      sourceHeight = bitmap.height;
    } else {
      const image = await loadImageElement(file);
      source = image;
      sourceWidth = image.naturalWidth;
      sourceHeight = image.naturalHeight;
    }

    throwIfAborted(signal);
    const gallery = await canvasBlob(
      source,
      sourceWidth,
      sourceHeight,
      GALLERY_MAX_DIMENSION,
      0.84,
    );
    throwIfAborted(signal);

    return {
      mediaType,
      width: sourceWidth,
      height: sourceHeight,
      gallery,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    return { mediaType };
  } finally {
    bitmap?.close();
  }
}
