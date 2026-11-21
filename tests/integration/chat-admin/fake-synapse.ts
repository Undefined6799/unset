// A fake Synapse admin API for the room sweep (ADR 0091; Synapse is an unmanaged dependency, rule TE-1). It answers
// the five calls as Synapse 1.165.0 does (docs/admin_api/rooms.md; synapse/rest/admin/rooms.py): the room list with
// offset paging and `encryption`, a room's state, timestamp_to_event (an event at or after `ts`, else 404
// M_NOT_FOUND), Delete Room v2 (a delete_id at once) and its status. A token is accepted only while the fake MAS holds
// it in a live session whose scope names the Synapse admin scope, as Synapse asks MAS (synapse/api/auth/mas.py:269-340).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"; // guard-allow: egress test fake, loopback listener only
import type { AddressInfo } from "node:net"; // guard-allow: egress test fake, a type only
import type { FakeMas } from "./harness.ts";

export type FakeRoom = {
  /** What the room list says in `encryption`. */
  encryption: string | null;
  state: { type: string; state_key: string; content: Record<string, unknown> }[];
  /** origin_server_ts of the room's newest event. */
  newest: number;
};
export type FakeSynapse = {
  url: URL;
  rooms: Map<string, FakeRoom>;
  seen: { method: string; path: string; body: string; auth: string | undefined }[];
  /** How a delete ends: at once, never, or as failed. */
  deletes: "complete" | "active" | "failed";
  /** Rooms whose state call answers 500. */
  broken: Set<string>;
  pageSize: number;
  close: () => Promise<void>;
};

export const PLAIN_STATE = [
  { type: "m.room.create", state_key: "", content: {} },
  { type: "m.room.retention", state_key: "", content: { max_lifetime: 2_592_000_000 } },
];
export const ENCRYPTED_STATE = [
  { type: "m.room.create", state_key: "", content: {} },
  { type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } },
];
export const DAY_MS = 86_400_000;

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

function authorised(mas: FakeMas, header: string | undefined): boolean {
  const token = header?.replace(/^Bearer /, "");
  return mas.sessions.some(
    (s) => s.token === token && !s.revoked && s.scope.split(" ").includes("urn:synapse:admin:*"),
  );
}

function route(fake: FakeSynapse, mas: FakeMas, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "", "http://synapse");
  if (!authorised(mas, req.headers.authorization)) return json(res, 401, { errcode: "M_UNKNOWN_TOKEN" });
  if (req.method === "GET" && url.pathname === "/_synapse/admin/v1/rooms") {
    const from = Number(url.searchParams.get("from") ?? 0);
    const ids = [...fake.rooms.keys()];
    const page = ids.slice(from, from + fake.pageSize);
    const rooms = page.map((id) => ({ room_id: id, encryption: fake.rooms.get(id)?.encryption ?? null }));
    const next = from + fake.pageSize < ids.length ? { next_batch: from + fake.pageSize } : {};
    return json(res, 200, { offset: from, rooms, total_rooms: ids.length, ...next });
  }
  const room = /^\/_synapse\/admin\/v[12]\/rooms\/([^/]+)(\/state|\/timestamp_to_event)?$/.exec(url.pathname);
  const id = room ? decodeURIComponent(room[1] as string) : "";
  const found = fake.rooms.get(id);
  if (req.method === "GET" && room?.[2] === "/state") {
    if (fake.broken.has(id)) return json(res, 500, {});
    return found ? json(res, 200, { state: found.state }) : json(res, 404, { errcode: "M_NOT_FOUND" });
  }
  if (req.method === "GET" && room?.[2] === "/timestamp_to_event") {
    const ts = Number(url.searchParams.get("ts"));
    if (found && url.searchParams.get("dir") === "f" && found.newest >= ts) {
      return json(res, 200, { event_id: "$e", origin_server_ts: found.newest });
    }
    return json(res, 404, { errcode: "M_NOT_FOUND", error: "Unable to find event" });
  }
  if (req.method === "DELETE" && room && room[2] === undefined && url.pathname.includes("/v2/")) {
    if (!found) return json(res, 400, { errcode: "M_UNKNOWN" });
    if (fake.deletes === "complete") fake.rooms.delete(id);
    return json(res, 200, { delete_id: `del${fake.seen.length}` });
  }
  const status = /^\/_synapse\/admin\/v2\/rooms\/delete_status\/([A-Za-z0-9]+)$/.exec(url.pathname);
  if (req.method === "GET" && status) {
    return json(res, 200, { delete_id: status[1], room_id: "!r", status: fake.deletes, shutdown_room: {} });
  }
  json(res, 404, { errcode: "M_UNRECOGNIZED" });
}

/** A fake Synapse on a free local port, trusting the tokens `mas` holds. */
export async function fakeSynapse(mas: FakeMas): Promise<FakeSynapse> {
  const fake: FakeSynapse = {
    url: new URL("http://127.0.0.1"),
    rooms: new Map(),
    seen: [],
    deletes: "complete",
    broken: new Set(),
    pageSize: 100,
    close: async () => {
      // Replaced once the server listens.
    },
  };
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString();
    });
    req.on("end", () => {
      fake.seen.push({ method: req.method ?? "", path: req.url ?? "", body, auth: req.headers.authorization });
      route(fake, mas, req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  fake.close = () => new Promise((resolve) => server.close(() => resolve()));
  return fake;
}
