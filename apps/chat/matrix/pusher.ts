// This device's pusher (ADR 0094 decision 1, ADR 0101 decision 1), registered as the SDK ships it: matrix-js-sdk
// 43.0.0 `setPusher(pusher: IPusherRequest)` (src/client.ts:7904-7907, POST /pushers/set; the fields are
// lib/@types/PushRules.d.ts IPusher and IPusherRequest), as Element registers its email pusher (element-web v1.12.35
// apps/web/src/components/views/settings/Notifications.tsx:476-490). Kind `http` with `format: "event_id_only"`, so
// the door is sent event and room IDs and the count, never a sender or a message (Matrix spec v1.18, POST
// /_matrix/client/v3/pushers/set; Synapse 1.165.0 httppusher.py:484-494). `append: false` means a pusher with this key
// under another account is removed (spec v1.18 `append`). The names are never shown to anyone; they name no server.
import type { MatrixClient } from "matrix-js-sdk/lib/matrix.js";
import type { PushTarget } from "../core/push.ts";

/** Registers the pusher; false when the homeserver refused it or did not answer within the client's deadline. */
export async function registerPusher(client: MatrixClient, target: PushTarget): Promise<boolean> {
  try {
    await client.setPusher({
      kind: "http",
      app_id: "sh.unset.count",
      app_display_name: "unset.sh",
      device_display_name: "unset.sh count",
      lang: "en",
      pushkey: target.pushkey,
      data: { url: target.url, format: "event_id_only" },
      append: false,
    });
    return true;
  } catch {
    return false;
  }
}
