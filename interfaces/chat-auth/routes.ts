// The door's POST routes (build step 6; ADR 0081 decision 4, ADR 0083 decisions 2, 4 and 5; ADR 0089), behind
// door.ts's Host, CSRF and rate-limit checks. Redeem reads exactly `{ ticket }`, takes the hop's one-time value and return path from
// their cookies and clears both whatever happens, and answers the chat page's session: the token, the member's chat
// ID, the device and its lock key. Its Log out twin, /sign-out/redeem, answers the same for the device the browser
// already holds, and nothing else. Log out, the setup claim and its release, and the pushkey (ADR 0090) read exactly
// `{ deviceId }` and need the browser cookie. Each refusal is
// a catalog code; none carries a ticket, token, key, DID or chat user (SE-3, SE-7).
import { createHash, randomBytes } from "node:crypto";
import { parseDid } from "@unset/domains-identity";
import {
  type BrowserKey,
  type BrowserList,
  type ChatContacts,
  chatContact,
  claimSetup,
  type DoorPorts,
  issuePushKey,
  type PushKeys,
  parseDeviceId,
  parseDoorState,
  type RedeemRefusal,
  readTicket,
  redeem,
  redeemForSignOut,
  releaseSetup,
  type SetupClaims,
  signOut,
} from "@unset/domains-messaging";
import { safeReturnPath } from "@unset/shared-http";
import {
  BROWSER_COOKIE,
  BROWSER_MAX_AGE_S,
  clearCookie,
  RETURN_COOKIE,
  readCookie,
  STATE_COOKIE,
  setCookie,
} from "./cookies.ts";
import { type DoorAnswer, json, type PostRoute } from "./door.ts";

/** web's ticket is about 600 characters of base64url; anything near the body cap is not one. */
const MAX_TICKET = 3000;
const BROWSER_VALUE = /^[A-Za-z0-9_-]{43}$/;

const STATUS: Readonly<Record<RedeemRefusal, number>> = {
  "chat.no_state": 403,
  "chat.state_mismatch": 403,
  "chat.ticket_expired": 403,
  "chat.ticket_refused": 403,
  "chat.device_ended": 409,
  "chat.busy": 409,
  "chat.unavailable": 503,
};

const answer = (status: number, body: unknown, headers?: Headers): DoorAnswer => {
  const response = json(status, body);
  for (const line of headers?.getSetCookie() ?? []) response.headers.append("set-cookie", line);
  const error = (body as { error?: unknown }).error;
  return typeof error === "string" ? { response, reason: error.slice(error.indexOf(".") + 1) } : { response };
};

/** The body as an object with exactly `names`, each a string of at most `max`, or null. */
async function onlyFields(request: Request, names: readonly string[], max: number): Promise<string[] | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  const values = names.map((name) => (body as Record<string, unknown>)[name]);
  if (keys.length !== names.length || !names.every((name) => keys.includes(name))) return null;
  return values.every((v) => typeof v === "string" && v.length <= max) ? (values as string[]) : null;
}

/** The body as an object with exactly `key`, a string, or null. */
async function onlyField(request: Request, key: string, max: number): Promise<string | null> {
  return (await onlyFields(request, [key], max))?.[0] ?? null;
}

/** The list's name for a browser: sha256 of its cookie's bytes, so a stored row is never a cookie. */
const browserKey = (bytes: Buffer) => new Uint8Array(createHash("sha256").update(bytes).digest()) as BrowserKey;

/** The browser this request comes from: its cookie's bytes and their sha256, or null without a well-formed one. */
function browserOf(request: Request): { value: string; key: BrowserKey } | null {
  const value = readCookie(request.headers.get("cookie"), BROWSER_COOKIE);
  if (value === null || !BROWSER_VALUE.test(value)) return null;
  return { value, key: browserKey(Buffer.from(value, "base64url")) };
}

function returnPathOf(request: Request): string {
  const raw = readCookie(request.headers.get("cookie"), RETURN_COOKIE);
  let decoded: string | null = null;
  try {
    decoded = raw === null ? null : decodeURIComponent(raw);
  } catch {
    decoded = null;
  }
  return (decoded === null ? null : safeReturnPath(decoded)) ?? "/";
}

export type RouteSettings = {
  readonly ports: DoorPorts;
  /** CHAT_SERVER_NAME: the part after the colon in the member's chat ID. */
  readonly serverName: string;
  readonly random?: (bytes: number) => Buffer;
};

/** POST /sign-in/redeem: the hop's ticket for this browser's chat session. */
export function redeemRoute({ ports, serverName, random = randomBytes }: RouteSettings): PostRoute {
  return {
    limit: "sign-in",
    async handle(request, deadline) {
      const headers = new Headers();
      headers.append("set-cookie", clearCookie(STATE_COOKIE, "Lax"));
      headers.append("set-cookie", clearCookie(RETURN_COOKIE, "Lax"));
      const raw = await onlyField(request, "ticket", MAX_TICKET);
      const ticket = raw === null ? null : readTicket(raw);
      if (ticket === null) return answer(400, { error: "chat.bad_ticket" }, headers);
      const state = parseDoorState(readCookie(request.headers.get("cookie"), STATE_COOKIE));
      const browser = browserOf(request) ?? newBrowser(random);
      const outcome = await redeem(ports, { ticket, state, browser: browser.key, deadline });
      if (outcome.kind === "refused") return answer(STATUS[outcome.code], { error: outcome.code }, headers);
      headers.append("set-cookie", setCookie(BROWSER_COOKIE, browser.value, BROWSER_MAX_AGE_S, "Strict"));
      const { entry, token, expiresAtS, newDevice } = outcome;
      return answer(
        200,
        {
          accessToken: token,
          userId: `@${entry.user}:${serverName}`,
          deviceId: entry.device,
          expiresAt: new Date(expiresAtS * 1000).toISOString(),
          storageKey: Buffer.from(entry.lockKey).toString("base64url"),
          newDevice,
          returnTo: returnPathOf(request),
        },
        headers,
      );
    },
  };
}

/**
 * POST /sign-out/redeem: unset.sh's Log out reaching this browser (ADR 0083 decision 5). web's ticket for the ended
 * session buys a session on the device this browser already holds for the member, and its lock key, so the page can
 * wait for the key backup and then Log out at POST /sign-out. Nothing is created or renewed, no cookie is set, and the
 * ticket's one-time value is not read: web made it at random, as no browser started this hop.
 */
export function signOutRedeemRoute({ ports, serverName }: Omit<RouteSettings, "random">): PostRoute {
  return {
    limit: "sign-in",
    async handle(request, deadline) {
      const raw = await onlyField(request, "ticket", MAX_TICKET);
      const ticket = raw === null ? null : readTicket(raw);
      if (ticket === null) return answer(400, { error: "chat.bad_ticket" });
      const browser = browserOf(request);
      if (browser === null) return answer(401, { error: "chat.no_session" });
      const outcome = await redeemForSignOut(ports, { ticket, browser: browser.key, deadline });
      if (outcome.kind === "no_session") return answer(401, { error: "chat.no_session" });
      if (outcome.kind === "refused") return answer(STATUS[outcome.code], { error: outcome.code });
      const { entry, token, expiresAtS } = outcome;
      return answer(200, {
        accessToken: token,
        userId: `@${entry.user}:${serverName}`,
        deviceId: entry.device,
        expiresAt: new Date(expiresAtS * 1000).toISOString(),
        storageKey: Buffer.from(entry.lockKey).toString("base64url"),
      });
    },
  };
}

function newBrowser(random: (bytes: number) => Buffer): { value: string; key: BrowserKey } {
  const bytes = random(32);
  return { value: bytes.toString("base64url"), key: browserKey(bytes) };
}

/** POST /sign-out: Log out of one device this browser holds (ADR 0083 decision 5: the key goes with it). */
export function signOutRoute({ ports }: Pick<RouteSettings, "ports">): PostRoute {
  return {
    limit: "default",
    async handle(request, deadline) {
      const browser = browserOf(request);
      if (browser === null) return answer(401, { error: "chat.no_session" });
      const device = parseDeviceId(await onlyField(request, "deviceId", 16));
      if (device === null) return answer(400, { error: "chat.bad_device" });
      const outcome = await signOut(ports, { browser: browser.key, device, deadline });
      if (outcome.kind === "unavailable") return answer(503, { error: "chat.unavailable" });
      const headers = new Headers();
      if (outcome.browserEmpty) headers.append("set-cookie", clearCookie(BROWSER_COOKIE, "Strict"));
      return answer(200, { signedOut: true }, headers);
    },
  };
}

type SetupPorts = { readonly list: BrowserList; readonly claims: SetupClaims };

/** The browser and the device it names, or the refusal: 401 without the cookie, 400 for a malformed device. */
async function deviceOf(request: Request) {
  const browser = browserOf(request);
  if (browser === null) return { refusal: answer(401, { error: "chat.no_session" }) };
  const device = parseDeviceId(await onlyField(request, "deviceId", 16));
  if (device === null) return { refusal: answer(400, { error: "chat.bad_device" }) };
  return { browser: browser.key, device };
}

/** POST /setup/claim: this browser runs the account's recovery-key setup, unless another live one does (ADR 0089). */
export function setupClaimRoute(ports: SetupPorts): PostRoute {
  return {
    limit: "default",
    async handle(request, deadline) {
      const asked = await deviceOf(request);
      if (asked.refusal !== undefined) return asked.refusal;
      const outcome = await claimSetup(ports, { ...asked, deadline });
      if (outcome.kind === "no_session") return answer(401, { error: "chat.no_session" });
      if (outcome.kind === "elsewhere") return answer(409, { error: "chat.setup_elsewhere" });
      return answer(200, { claimed: true });
    },
  };
}

/** POST /setup/release: this browser's setup is done; another browser of the account may claim again. */
export function setupReleaseRoute(ports: SetupPorts): PostRoute {
  return {
    limit: "default",
    async handle(request, deadline) {
      const asked = await deviceOf(request);
      if (asked.refusal !== undefined) return asked.refusal;
      const outcome = await releaseSetup(ports, { ...asked, deadline });
      if (outcome.kind === "no_session") return answer(401, { error: "chat.no_session" });
      return answer(200, { released: true });
    },
  };
}

type PushKeyPorts = { readonly list: BrowserList; readonly keys: PushKeys; readonly notifyUrl: string };

/**
 * POST /push/key: a new pushkey for the device this browser holds, and the internal address its pusher posts to (ADR
 * 0090 decision 1). The page registers it with the homeserver; the key replaces this entry's last one.
 */
export function pushKeyRoute({ list, keys, notifyUrl }: PushKeyPorts, random = randomBytes): PostRoute {
  return {
    limit: "default",
    async handle(request, deadline) {
      const asked = await deviceOf(request);
      if (asked.refusal !== undefined) return asked.refusal;
      const outcome = await issuePushKey({ list, keys, random }, { ...asked, deadline });
      if (outcome.kind === "no_session") return answer(401, { error: "chat.no_session" });
      return answer(200, { pushkey: outcome.key, url: notifyUrl });
    },
  };
}

type ChatIdPorts = { readonly list: BrowserList; readonly contacts: ChatContacts; readonly serverName: string };
/** A DID is at most 2 KB (atproto.com/specs/did, "DID Syntax"). */
const MAX_DID = 2048;

/**
 * POST /chat-id: the chat ID behind a profile's Message link, read exactly `{ deviceId, did }` (ADR 0090 decision 3).
 * Only a browser holding that device asks; a member whose chat is not ready or whose page does not show is 404.
 */
export function chatIdRoute({ list, contacts, serverName }: ChatIdPorts): PostRoute {
  return {
    limit: "default",
    async handle(request, deadline) {
      const browser = browserOf(request);
      if (browser === null) return answer(401, { error: "chat.no_session" });
      const [rawDevice, rawDid] = (await onlyFields(request, ["deviceId", "did"], MAX_DID)) ?? [];
      const device = parseDeviceId(rawDevice);
      const did = parseDid(rawDid ?? "");
      if (device === null || did === null) return answer(400, { error: "chat.bad_request" });
      const outcome = await chatContact({ list, contacts }, { browser: browser.key, device, did, deadline });
      if (outcome.kind === "no_session") return answer(401, { error: "chat.no_session" });
      if (outcome.kind === "missing") return answer(404, { error: "chat.not_found" });
      return answer(200, { chatId: `@${outcome.user}:${serverName}` });
    },
  };
}
