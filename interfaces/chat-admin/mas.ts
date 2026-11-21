// The MAS admin calls (ADR 0093 decisions 1 and 5), sent through outbound.ts to the two internal origins checked at
// boot. Every answer is parsed here into what chat-admin needs; anything else throws MasUnavailable, which the handler
// answers 503 and never retries (RE-1: the caller's queued job or the door retries). Read from MAS 1.26.0 docs/api/spec.json and docs/topics/admin-api.md
// (https://github.com/element-hq/matrix-authentication-service/tree/v1.26.0/docs), checked on a live 1.26.0:
// token by client_credentials with client_secret_basic and scope urn:mas:admin; users 201/409, by-username 200/404;
// personal-sessions 201; revoke 200, 409 when already revoked; users/{id}/lock, /unlock and /deactivate 200 every
// time and 404 for an unknown ID (the live 1.26.0, its own /api/spec.json, 2026-11-21). Deactivate is sent with no
// body, so `skip_erase` keeps its default false and MAS asks the homeserver to erase the user (DeactivateUserRequest).
import type { Resolve } from "@unset/shared-admin-envelope";
import { type Answer, createSender, field } from "./outbound.ts";

export class MasUnavailable extends Error {}

export type MasUser = { readonly id: string; readonly locked: boolean; readonly deactivated: boolean };
export type Mas = {
  readonly createUser: (username: string, displayname: string) => Promise<"created" | "conflict">;
  readonly findUser: (username: string) => Promise<MasUser | null>;
  /** Personal sessions of a user holding `device`'s scope token: active ones, or every one ever made. */
  readonly sessions: (userId: string, device: string, which: "active" | "ever") => Promise<string[]>;
  /** A new personal session: its ID (to revoke it) and its token. */
  readonly mint: (userId: string, scope: string, expiresIn: number) => Promise<{ id: string; token: string }>;
  readonly revoke: (sessionId: string) => Promise<void>;
  /** lock, unlock or deactivate the user with this MAS ID (ADR 0096). */
  readonly setState: (userId: string, call: "lock" | "unlock" | "deactivate") => Promise<void>;
};
export type MasOptions = {
  readonly adminUrl: URL;
  readonly tokenUrl: URL;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly resolve?: Resolve;
};

/** A token is dropped this long before MAS says it expires, so none is used as it runs out. */
const TOKEN_MARGIN_MS = 30_000;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const HUMAN_NAME = "unset.cc";

export function createMas(options: MasOptions): Mas {
  const send = createSender(MasUnavailable, options.resolve);

  let cached: { token: string; until: number } | null = null;
  async function adminToken(): Promise<string> {
    if (cached !== null && Date.now() < cached.until) return cached.token;
    // client_secret_basic: id and secret form-encoded, then base64 (RFC 6749 section 2.3.1).
    const basic = Buffer.from(`${encodeURIComponent(options.clientId)}:${encodeURIComponent(options.clientSecret)}`);
    const answer = await send(
      new URL("/oauth2/token", options.tokenUrl),
      "POST",
      { authorization: `Basic ${basic.toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      new URLSearchParams({ grant_type: "client_credentials", scope: "urn:mas:admin" }).toString(),
    );
    const { access_token: token, expires_in: lifetime } = answer.body;
    if (answer.status !== 200 || typeof token !== "string" || typeof lifetime !== "number") {
      throw new MasUnavailable(`token_${answer.status}`);
    }
    cached = { token, until: Date.now() + lifetime * 1000 - TOKEN_MARGIN_MS };
    return token;
  }

  async function admin(method: "GET" | "POST", path: string, body?: object): Promise<Answer> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await adminToken()}`,
      accept: "application/json",
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    const url = new URL(path, options.adminUrl);
    if (url.origin !== options.adminUrl.origin) throw new MasUnavailable("origin");
    const answer = await send(url, method, headers, body === undefined ? undefined : JSON.stringify(body));
    // A refused token is dropped, so the next request fetches another; this one still fails.
    if (answer.status === 401) cached = null;
    return answer;
  }
  const refuse = (op: string, answer: Answer): never => {
    throw new MasUnavailable(`${op}_${answer.status}`);
  };

  return {
    createUser: async (username, displayname) => {
      const answer = await admin("POST", "/api/admin/v1/users", { username, displayname });
      if (answer.status === 201) return "created";
      return answer.status === 409 ? "conflict" : refuse("create", answer);
    },
    findUser: async (username) => {
      const answer = await admin("GET", `/api/admin/v1/users/by-username/${encodeURIComponent(username)}`);
      if (answer.status === 404) return null;
      const id = field(answer.body, "data", "id");
      if (answer.status !== 200 || typeof id !== "string" || !ULID.test(id)) return refuse("user", answer);
      const at = (key: string) => field(answer.body, "data", "attributes", key) !== null;
      return { id, locked: at("locked_at"), deactivated: at("deactivated_at") };
    },
    sessions: async (userId, device, which) => {
      // filter[scope] matches sessions whose scope list holds every given token (MAS 1.26.0
      // crates/storage-pg/src/personal/session.rs, PersonalSessionFilter, `contains`).
      const query = new URLSearchParams({
        "filter[actor_user]": userId,
        "filter[scope]": `urn:matrix:client:device:${device}`,
        "page[first]": "100",
      });
      if (which === "active") query.set("filter[status]", "active");
      const answer = await admin("GET", `/api/admin/v1/personal-sessions?${query}`);
      const data = answer.body.data;
      if (answer.status !== 200 || !Array.isArray(data)) return refuse("list", answer);
      const ids = data.map((item) => field(item, "id"));
      if (!ids.every((id): id is string => typeof id === "string" && ULID.test(id))) return refuse("list", answer);
      return ids;
    },
    mint: async (userId, scope, expiresIn) => {
      const body = { actor_user_id: userId, human_name: HUMAN_NAME, scope, expires_in: expiresIn };
      const answer = await admin("POST", "/api/admin/v1/personal-sessions", body);
      const id = field(answer.body, "data", "id");
      const token = field(answer.body, "data", "attributes", "access_token");
      const good = answer.status === 201 && typeof token === "string" && typeof id === "string" && ULID.test(id);
      return good ? { id: id as string, token: token as string } : refuse("mint", answer);
    },
    setState: async (userId, call) => {
      if (!ULID.test(userId)) throw new MasUnavailable("user_id");
      const answer = await admin("POST", `/api/admin/v1/users/${userId}/${call}`);
      if (answer.status !== 200) refuse(call, answer);
    },
    revoke: async (sessionId) => {
      const answer = await admin("POST", `/api/admin/v1/personal-sessions/${sessionId}/revoke`);
      if (answer.status !== 200 && answer.status !== 409) refuse("revoke", answer);
    },
  };
}
