// The edge suite's hooks (P1.11s): edge.image.test.ts registers them through registerEdgeSuite, so
// edge-teardown.image.test.ts can pin that the afterAll removes the image tag as well as stopping the edge (#723
// verify). An image module: it reaches the build helper (scripts/test/image-rules.test.ts).
import { buildEdgeImage, startEdge, stopEdgeAndRemoveImage, TEARDOWN_DOCKER_CALLS } from "./edge-container.ts";
import { CALL_MS, type Edge, pullProbeImage } from "./edge-handle.ts";

type Hook = (fn: () => Promise<void>, timeoutMs: number) => void;
type SuiteParts = { prepare: () => string; start: (image: string) => Promise<Edge> };

// Pulls the probe image, builds the edge image and starts it: one beforeAll (P1.28b).
const SETUP_MS = 600_000;
// Every docker call the teardown can make, each killed at CALL_MS, with room to report the failures (N3, P1.34g):
// 3 x 60 s + 10 s. Derived, not written down, so a call added to the stop raises it.
const REPORT_MS = 10_000;
const TEARDOWN_MS = TEARDOWN_DOCKER_CALLS * CALL_MS + REPORT_MS;
const SUITE_PARTS: SuiteParts = {
  prepare: () => {
    pullProbeImage();
    return buildEdgeImage();
  },
  start: (image) => startEdge(image),
};

/**
 * Registers the edge suite's hooks (P1.11s): beforeAll pulls the probe image, builds the edge image and starts it,
 * then hands both to `onStarted`; afterAll stops the edge and removes the tag. They are registered here, not in the
 * test file, so edge-teardown.image.test.ts pins that the afterAll removes the tag as well as stopping the edge.
 * Only that test replaces `parts`.
 */
export function registerEdgeSuite(
  hooks: { beforeAll: Hook; afterAll: Hook },
  onStarted: (started: { edge: Edge; image: string }) => void,
  parts: SuiteParts = SUITE_PARTS,
): void {
  let edge: Edge | undefined;
  let image: string | undefined;
  hooks.beforeAll(async () => {
    image = parts.prepare();
    edge = await parts.start(image);
    onStarted({ edge, image });
  }, SETUP_MS);
  hooks.afterAll(() => stopEdgeAndRemoveImage(edge, image), TEARDOWN_MS);
}
