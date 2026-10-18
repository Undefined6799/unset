// P2.04c: the built web image with no environment stops at the config check (exit 78, bootOrExit), so every module the
// server loads before reading its config is in the image: since P2.04c that includes the identity domain and the
// infrastructure packages the OAuth client stands on, which the runtime stage copies one by one. Mirrors
// migrate_image_boots_to_config_check; it builds an image, so it lives in an *.image.test.ts file (P1.28r).
//
// P1.29t: net_guard_resolve_pin_in_image runs the resolve-and-pin checks inside that same runtime image, so the
// deployed copy holds the SSRF guarantee (book edit 2026-10-07-p129-split). The probe imports the image's
// infrastructure/net-guard/src/resolve.ts, not the host tree.
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { docker, killBefore } from "../../tests/support/docker.ts";
import { buildTestImage, removeTestImage } from "../../tests/support/image-build.ts";

const DEPLOYMENT = join(import.meta.dirname, "..");
const WEB_DOCKERFILE = join(DEPLOYMENT, "images/node-app.Dockerfile");
const BUILD_MS = 300_000;
const CALL_MS = 60_000;
const BUILD_CALL_MS = killBefore(BUILD_MS);
const CONTAINER_CALL_MS = killBefore(CALL_MS);
const REMOVE_HOOK_MS = CALL_MS + 5_000;

// Mixed public+private answers must fail as one (DNS rebinding). IP literals are vetted the same way. pinnedLookup
// never resolves again and never returns an address that was not passed in.
const PIN_PROBE = `
import { NetGuardError, pinnedLookup, resolveVetted, resolveVettedWith } from "/app/infrastructure/net-guard/src/resolve.ts";
async function codeOf(promise) {
  try { await promise; return "ok"; }
  catch (error) { return error instanceof NetGuardError ? error.code : "other"; }
}
const mixed = await codeOf(resolveVettedWith("mixed.example", { allow: "public" }, {
  lookup: async () => [{ address: "93.184.215.14", family: 4 }, { address: "10.0.0.1", family: 4 }],
}));
const privateLiteral = await codeOf(resolveVetted("10.0.0.1", { allow: "public" }));
let pinAddresses = [];
pinnedLookup(["93.184.215.14"])("rebinder.example", { all: true }, (_err, answer) => {
  pinAddresses = (answer ?? []).map((row) => row.address);
});
process.stdout.write(JSON.stringify({ mixed, privateLiteral, pinAddresses }));
`;

describe("web image", () => {
  let image = "";

  beforeAll(() => {
    image = buildTestImage(WEB_DOCKERFILE, join(DEPLOYMENT, ".."), { timeoutMs: BUILD_CALL_MS });
  }, BUILD_MS);

  afterAll(() => {
    if (image !== "") removeTestImage(image, { timeoutMs: CALL_MS });
  }, REMOVE_HOOK_MS);

  test("web_image_boots_to_config_check", { timeout: CALL_MS }, () => {
    const run = docker(["run", "--rm", "--read-only", "--network", "none", image], {
      timeoutMs: CONTAINER_CALL_MS,
    });
    expect(run.code, run.err.slice(-2000)).toBe(78);
  });

  test("net_guard_resolve_pin_in_image", { timeout: CALL_MS }, () => {
    const run = docker(
      [
        "run",
        "--rm",
        "--read-only",
        "--network",
        "none",
        "--user",
        "65532:65532",
        "--entrypoint",
        "node",
        image,
        "--input-type=module",
        "-e",
        PIN_PROBE,
      ],
      { timeoutMs: CONTAINER_CALL_MS },
    );
    expect(run.code, run.err.slice(-2000)).toBe(0);
    expect(JSON.parse(run.out)).toEqual({
      mixed: "egress.private_address",
      privateLiteral: "egress.private_address",
      pinAddresses: ["93.184.215.14"],
    });
  });
});
