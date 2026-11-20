// Content (decision 34): what members post and place on their pages. Today: the shared image foundation's
// processing contract and its image standard (ADR 0070).
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
