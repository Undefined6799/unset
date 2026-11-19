// The indexer's reader of our PDS's event stream (P3.05s, ADR 0052). The only folder that imports @atproto/sync and
// @atproto/xrpc-server (dependency-cruiser `vendor-sdk-one-adapter`).
export type { AccountStatus, RecordChange, RepoFrame } from "./frames.ts";
export {
  createHandleOnPdsReader,
  type HandleOnPds,
  type HandleOnPdsReader,
  type HandleOnPdsReaderOptions,
} from "./handleOnPds.ts";
export { type FirehoseConsumer, type FirehoseReaderOptions, readFirehose, type StopReason } from "./reader.ts";
export {
  createRepoReader,
  type RepoFailure,
  RepoReadError,
  type RepoReader,
  type RepoReaderOptions,
  type RepoSnapshot,
} from "./repo.ts";
export {
  createRepoStatusReader,
  type RepoStatus,
  type RepoStatusReader,
  type RepoStatusReaderOptions,
} from "./repoStatus.ts";
