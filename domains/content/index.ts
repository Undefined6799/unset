// Content (decision 34): what members post and place on their pages. Today: the shared image foundation's
// processing contract, its image standard and a member's image library (ADR 0070).

export type { ImageAdmission, InspectionResult, UploadUsage } from "./images/library.ts";
export {
  admitUpload,
  fitsQuota,
  IMAGE_ALLOWANCE,
  IMAGE_EXPIRY,
  SWEEP_GOVERNOR,
  sweepAllowed,
  uploadsOpen,
} from "./images/library.ts";
export type {
  ImageProcessor,
  ImageRefusal,
  ImageVersion,
  OutputFormat,
  ProcessLimits,
  ProcessResult,
  SourceFormat,
  SquareCrop,
  VersionSpec,
} from "./images/processing.ts";
export { avatarVersions, DISPLAY_WIDTHS, imageVersions, UPLOAD_LIMITS } from "./images/standard.ts";
