// The room sweep (ADR 0091): delete each plain room that has been idle for 30 days, never an encrypted one, with a
// Synapse admin session minted for this run only. The token lives in this run's variables and nowhere else; the
// session is revoked when the run ends, whatever happened. A room is deleted only after every check below passed in
// this run, in order; any other answer keeps it. Nothing is retried here: the next run is the retry (RE-1).
import type { Abandoned, Result } from "./commands.ts";
import { type Mas, MasUnavailable } from "./mas.ts";
import { type RoomId, type StateEvent, type Synapse, SynapseUnavailable } from "./synapse.ts";

/** The service user (decision 2). The hyphen keeps it apart from every member's name, which is [a-z0-9]{12,64}. */
export const SWEEPER = "unset-room-sweeper";
/** The one scope the sweep's session gets: Synapse takes no token without the client API scope (synapse 1.165.0
 * api/auth/mas.py:333-340) and treats one as an admin when it holds the admin scope (:269-270). */
export const SWEEP_SCOPE = "urn:matrix:client:api:* urn:synapse:admin:*";
const SWEEP_TTL_S = 120;
const IDLE_MS = 30 * 86_400_000;
/** ADR 0085 decision 1: a plain room's one retention event, 30 days in milliseconds. */
const PLAIN_LIFETIME = 2_592_000_000;
const MAX_PAGES = 100;
const MAX_DELETES = 50;
const POLL_MS = 250;
/** A run starts no work after this long, inside web's 30-second wait (ADR 0091 decision 6). */
const RUN_MS = 25_000;

export type SweepCounts = {
  /** Rooms the list held. */
  listed: number;
  /** Rooms the list and their state both show as plain. */
  plain: number;
  deleted: number;
  /** Rooms left as they are: encrypted, not plain by state, active, or not reached this run. */
  kept: number;
  /** Rooms a call failed for, or whose delete Synapse reports failed or had not finished. */
  failed: number;
};

export type SweepDeps = {
  readonly mas: Mas;
  readonly synapse: Synapse;
  readonly now: () => number;
  readonly pause?: (ms: number) => Promise<void>;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** ADR 0085's plain room, read from its current state: no encryption event, and exactly its one retention event. */
export function isPlainState(state: readonly StateEvent[]): boolean {
  if (state.some((event) => event.type === "m.room.encryption")) return false;
  const retention = state.filter((event) => event.type === "m.room.retention");
  return (
    retention.length === 1 && retention[0]?.stateKey === "" && retention[0]?.content.max_lifetime === PLAIN_LIFETIME
  );
}

/** One run: the service user, a fresh session, the sweep, then the revoke. */
export async function sweepRooms(deps: SweepDeps, caller: Abandoned): Promise<Result<SweepCounts>> {
  const stopAt = deps.now() + RUN_MS;
  const abandoned: Abandoned = () => caller() ?? (deps.now() > stopAt ? "time" : null);
  try {
    const sweeper = await serviceUser(deps.mas);
    if (sweeper === null) return { kind: "unavailable", reason: "sweeper_inactive" };
    const gone = abandoned();
    if (gone !== null) return { kind: "refused", status: 403, reason: gone };
    const session = await deps.mas.mint(sweeper, SWEEP_SCOPE, SWEEP_TTL_S);
    try {
      return { kind: "ok", ...(await sweepWith(deps, session.token, abandoned)) };
    } finally {
      await deps.mas.revoke(session.id);
    }
  } catch (error) {
    if (error instanceof MasUnavailable) return { kind: "unavailable", reason: `mas_${error.message}` };
    if (error instanceof SynapseUnavailable) return { kind: "unavailable", reason: `synapse_${error.message}` };
    throw error;
  }
}

/** The service user's MAS ID, made on the first run; null when MAS holds it locked or deactivated. */
async function serviceUser(mas: Mas): Promise<string | null> {
  await mas.createUser(SWEEPER, "unset.cc");
  const user = await mas.findUser(SWEEPER);
  if (user === null) throw new MasUnavailable("sweeper_missing");
  return user.locked || user.deactivated ? null : user.id;
}

/** Every page of the room list (at most MAX_PAGES): how many rooms it held, and those it does not show encrypted. */
async function listCandidates(deps: SweepDeps, token: string, abandoned: Abandoned) {
  const candidates: RoomId[] = [];
  let listed = 0;
  let from: number | null = 0;
  for (let page = 0; from !== null && page < MAX_PAGES && abandoned() === null; page++) {
    const answer = await deps.synapse.rooms(token, from);
    listed += answer.rooms.length;
    for (const room of answer.rooms) if (!room.encrypted) candidates.push(room.id);
    from = answer.next;
  }
  return { listed, candidates };
}

async function sweepWith(deps: SweepDeps, token: string, abandoned: Abandoned): Promise<SweepCounts> {
  const { listed, candidates } = await listCandidates(deps, token, abandoned);
  const counts = { listed, plain: 0, deleted: 0, failed: 0 };
  for (const room of candidates) {
    if (counts.deleted + counts.failed >= MAX_DELETES || abandoned() !== null) break;
    const outcome = await sweepOne(deps, token, room, abandoned).catch((error: unknown) => {
      if (error instanceof SynapseUnavailable) return "failed" as const;
      throw error;
    });
    if (outcome === "active" || outcome === "deleted" || outcome === "delete_failed") counts.plain++;
    if (outcome === "deleted") counts.deleted++;
    if (outcome === "failed" || outcome === "delete_failed") counts.failed++;
  }
  return { ...counts, kept: listed - counts.deleted - counts.failed };
}

/** `failed`: a call failed before the room was known plain; `delete_failed`: Synapse failed it or it had not ended. */
type Outcome = "not_plain" | "active" | "deleted" | "delete_failed" | "failed";

/** One room's checks in order (decision 4), then its delete, waited for while the run has time. */
async function sweepOne(deps: SweepDeps, token: string, room: RoomId, abandoned: Abandoned): Promise<Outcome> {
  if (!isPlainState(await deps.synapse.state(token, room))) return "not_plain";
  if (await deps.synapse.eventSince(token, room, deps.now() - IDLE_MS)) return "active";
  if (abandoned() !== null) return "active";
  const deleteId = await deps.synapse.deleteRoom(token, room);
  const pause = deps.pause ?? wait;
  for (;;) {
    const status = await deps.synapse.deleteStatus(token, deleteId);
    if (status === "complete") return "deleted";
    if (status === "failed" || abandoned() !== null) return "delete_failed";
    await pause(POLL_MS);
  }
}
