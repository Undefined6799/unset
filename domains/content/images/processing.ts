// The processing stage of the shared image foundation (ADR 0070 point 2.2): untrusted bytes in, versions we made out.
// This is the contract; infrastructure/image implements it with sharp in killable child processes. The caller
// decides the limits and the versions, so the numbers live in one place, the composition root's configuration.

/** The formats a member may upload (ADR 0070 point 3), named by their magic bytes, never by a declared type. */
export type SourceFormat = "jpeg" | "png" | "webp" | "avif";
export type OutputFormat = "jpeg" | "webp" | "avif";

/** A square crop in the upright picture's pixels, for the avatar only (ADR 0070 point 3). */
export type SquareCrop = { readonly left: number; readonly top: number; readonly size: number };

export type VersionSpec = {
  /** Lowercase letters, digits and `_`; with the format it names the stored object. */
  readonly name: string;
  readonly format: OutputFormat;
  /**
   * `inside`: the longest side at most `size`, proportions kept. `width`: at most `size` wide. `square`: the crop (or
   * the centre square) scaled to exactly `size`. Only `square` ever enlarges.
   */
  readonly fit: "inside" | "width" | "square";
  readonly size: number;
  readonly crop?: SquareCrop;
  /** The first quality tried; each retry is 10 lower, down to `minQuality`. */
  readonly quality: number;
  readonly minQuality: number;
  readonly maxBytes: number;
  /** Still over `maxBytes` at `minQuality`: true refuses the upload as too large, false keeps the smallest. */
  readonly required: boolean;
};

export type ProcessLimits = {
  readonly maxBytes: number;
  readonly maxPixels: number;
  readonly maxEdge: number;
};

export type ImageVersion = {
  readonly name: string;
  readonly format: OutputFormat;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
  /** Hex SHA-256 of `bytes`. */
  readonly sha256: string;
};

/**
 * One code for every refusal. `image.cannot_use` covers an undecodable file, a format that does not match its magic
 * bytes and a crashed decoder alike, so a member learns nothing about why a crafted file failed.
 */
export type ImageRefusal =
  | "image.too_large"
  | "image.unsupported"
  | "image.too_many_pixels"
  | "image.animated"
  | "image.cannot_use"
  | "image.busy"
  | "image.timeout";

export type ProcessResult =
  | {
      readonly kind: "ok";
      readonly source: { readonly format: SourceFormat; readonly width: number; readonly height: number };
      readonly versions: readonly ImageVersion[];
    }
  | { readonly kind: "refused"; readonly code: ImageRefusal };

export interface ImageProcessor {
  /** Never throws for a member's bad file; the original bytes are not kept by the processor after it answers. */
  process(bytes: Uint8Array, limits: ProcessLimits, versions: readonly VersionSpec[]): Promise<ProcessResult>;
}
