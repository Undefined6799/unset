// The replay guard (P2.09 step 7; ADR 0060 decision 3): each envelope's `jti` is accepted once, across restarts and
// concurrent requests. The set is filled synchronously before the first await and the line is fsynced before the
// service acts, so a crash burns a `jti` rather than freeing it. Shared by pds-admin and chat-admin (ADR 0093).
import { appendLine, readLines, replaceLines } from "./state-file.ts";

/** How long past its `exp` a `jti` is kept (seconds); an expired envelope fails the time check before this one. */
const KEEP_AFTER_EXP = 120;

export type JtiStore = {
  /** True when `jti` was already seen; otherwise records it durably and returns false. */
  readonly burn: (jti: string, exp: number) => boolean;
  /** Drops entries whose envelopes can no longer pass the time check, and rewrites the file. */
  readonly compact: (now: number) => void;
};

export function openJtiStore(file: string, now: number): JtiStore {
  const seen = new Map<string, number>();
  for (const line of readLines(file)) {
    const [jti, exp] = line.split(" ");
    if (jti !== undefined && exp !== undefined) seen.set(jti, Number(exp));
  }
  const compact = (at: number): void => {
    for (const [jti, exp] of seen) if (exp + KEEP_AFTER_EXP < at) seen.delete(jti);
    replaceLines(
      file,
      [...seen].map(([jti, exp]) => `${jti} ${exp}`),
    );
  };
  compact(now);
  return {
    burn: (jti, exp) => {
      if (seen.has(jti)) return true;
      seen.set(jti, exp);
      appendLine(file, `${jti} ${exp}`);
      return false;
    },
    compact,
  };
}
