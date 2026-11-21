// The door's count port (build step 10; ADR 0082 decisions 3 and 5, ADR 0090 decision 2): a listener of its own on the
// network only Synapse and web share, with three routes and nothing of the public door. Synapse's pusher posts the
// member's number to the push gateway path; web reads it back by DID, and reads whether the member has set up chat
// (a browser of theirs took a key) for its onboarding chat step (ADR 0083 decision 2). Neither route takes a browser's cookie or runs
// a CSRF gate, and the public listener answers 404 for both. Each answer is one log line of route template, method,
// status and a fixed reason word: never a DID, pushkey or number (SE-7).
//
// The notification as Synapse 1.165.0 sends it (synapse/push/httppusher.py dispatch_push_event with format
// event_id_only, and _send_badge after a read receipt, whose answer Synapse does not read): `{ notification: {
// counts: { unread }, devices: [{ app_id, pushkey, pushkey_ts, data }], ... } }`. Matrix spec v1.18 push gateway API
// (https://spec.matrix.org/v1.18/push-gateway-api/#post_matrixpushv1notify): only `devices` is required, and the
// answer's `rejected` lists the pushkeys the gateway does not know, which Synapse then removes (httppusher.py:377-392).
import { parseDid } from "@unset/domains-identity";
import {
  chatCount,
  chatSetUp,
  MAX_COUNT,
  type PushKey,
  type PushKeys,
  parsePushKey,
  recordCount,
} from "@unset/domains-messaging";
import { type DoorAnswer, type DoorLog, json } from "./door.ts";

export const NOTIFY_PATH = "/_matrix/push/v1/notify";
const COUNT_PATH = "/count";
const SET_UP_PATH = "/set-up";
/** Synapse sends one device per pusher; a few more are allowed, as the spec's list form permits. */
const MAX_DEVICES = 16;
const MAX_PUSHKEY = 512;

/** What a notification asks: the keys of the door's shape, the other keys (rejected as they are), and the number. */
export type Notification = {
  readonly keys: readonly PushKey[];
  readonly foreign: readonly string[];
  readonly unread: number | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT;

/** The push gateway's body, or null for anything not of its shape. */
export function readNotification(body: unknown): Notification | null {
  if (!isRecord(body) || Object.keys(body).length !== 1 || !isRecord(body.notification)) return null;
  const { devices, counts } = body.notification;
  if (!Array.isArray(devices) || devices.length === 0 || devices.length > MAX_DEVICES) return null;
  const pushkeys = devices.map((device) => (isRecord(device) ? device.pushkey : undefined));
  if (!pushkeys.every((key): key is string => typeof key === "string" && key.length <= MAX_PUSHKEY)) return null;
  let unread: number | null = null;
  if (counts !== undefined) {
    if (!isRecord(counts) || Object.keys(counts).some((key) => key !== "unread" && key !== "missed_calls")) return null;
    if (counts.unread !== undefined && !isCount(counts.unread)) return null;
    unread = counts.unread ?? null;
  }
  const keys = pushkeys.map(parsePushKey).filter((key) => key !== null);
  return { keys, foreign: pushkeys.filter((key) => parsePushKey(key) === null), unread };
}

export type CountDoorDeps = {
  readonly keys: PushKeys;
  readonly log: (line: DoorLog) => void;
  readonly deadlineMs?: number;
};

const refuse = (status: number, error: string): DoorAnswer => ({
  response: json(status, { error }),
  reason: error.slice(error.indexOf(".") + 1),
});

async function notify(request: Request, deps: CountDoorDeps, deadline: AbortSignal): Promise<DoorAnswer> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "push.bad_body");
  }
  const asked = readNotification(body);
  if (asked === null) return refuse(400, "push.bad_body");
  const rejected = await recordCount(deps, { keys: asked.keys, unread: asked.unread, deadline });
  return { response: json(200, { rejected: [...asked.foreign, ...rejected] }) };
}

/** The query's one `did` and nothing else, or null. */
function didOf(url: URL) {
  const dids = url.searchParams.getAll("did");
  return dids.length === 1 && [...url.searchParams.keys()].length === 1 ? parseDid(dids[0] ?? "") : null;
}

async function count(url: URL, deps: CountDoorDeps, deadline: AbortSignal): Promise<DoorAnswer> {
  const did = didOf(url);
  if (did === null) return refuse(400, "push.bad_did");
  return { response: json(200, { unread: await chatCount(deps, did, deadline) }) };
}

/** web's onboarding chat step (ADR 0083 decision 2): whether a browser of the member got ready and took a key. */
async function setUp(url: URL, deps: CountDoorDeps, deadline: AbortSignal): Promise<DoorAnswer> {
  const did = didOf(url);
  if (did === null) return refuse(400, "push.bad_did");
  return { response: json(200, { setUp: await chatSetUp(deps, did, deadline) }) };
}

const ROUTES: Readonly<Record<string, string>> = { [NOTIFY_PATH]: "POST", [COUNT_PATH]: "GET", [SET_UP_PATH]: "GET" };

export function createCountDoor(deps: CountDoorDeps) {
  const deadlineMs = deps.deadlineMs ?? 5000;

  async function answer(request: Request, url: URL): Promise<DoorAnswer> {
    const method = ROUTES[url.pathname];
    if (method === undefined) return refuse(404, "not_found");
    if (request.method !== method) return refuse(405, "http.method_not_allowed");
    const deadline = AbortSignal.timeout(deadlineMs);
    if (url.pathname === NOTIFY_PATH) return notify(request, deps, deadline);
    return url.pathname === COUNT_PATH ? count(url, deps, deadline) : setUp(url, deps, deadline);
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const route = url.pathname in ROUTES ? url.pathname : "/*";
    let result: DoorAnswer;
    try {
      result = await answer(request, url);
    } catch (error) {
      // An infrastructure fault: a fixed answer, which Synapse retries later; only the class reaches the log.
      result = refuse(503, "chat.unavailable");
      result = { ...result, reason: error instanceof Error ? "fault" : "unknown" };
    }
    const line: DoorLog = { route, method: request.method, status: result.response.status };
    deps.log(result.reason === undefined ? line : { ...line, reason: result.reason });
    return result.response;
  };
}
