// C35 (P2.21a; ADR 0070 point 2.2): `review` decodes members' pictures, so a codec exploit must reach only the bytes it
// was sent. The service named review, and any service built from its Dockerfile under another name, joins exactly the
// internal network review_web, which holds web and review alone, so it has no route out and no other neighbour. It
// reads no secret, no env file and no mount, sets only the settings it reads, each a literal (so no interpolated value
// rides in), and runs hardened: read-only, a non-root user, every capability dropped, no new privileges. C17's table
// pins the same networks; this check holds them even if the table is edited beside it. A stack with no review passes.
import { join } from "node:path";
import type { Service } from "../compose-parse.ts";
import { type Check, fail, type Inputs, type Outcome, pass } from "./types.ts";

const DOCKERFILE = "deployment/images/review.Dockerfile";
const NETWORK = "review_web";
/** What interfaces/review/config.ts and the entrypoint schema read, and Node's own options. */
const SETTINGS: ReadonlySet<string> = new Set([
  "UNSET_ENV",
  "UNSET_SERVICE",
  "UNSET_COMMIT",
  "LISTEN_PORT",
  "LOG_ENABLED",
  "REVIEW_CHILDREN",
  "REVIEW_QUEUE",
  "REVIEW_TIMEOUT_MS",
  "REVIEW_ADDRESS_SPACE_MB",
  "NODE_OPTIONS",
]);

const isReview = (service: Service, inputs: Inputs): boolean =>
  service.name === "review" || service.build?.dockerfile === join(inputs.root, DOCKERFILE);

export const c35: Check = {
  id: "C35",
  run: (inputs) => {
    const reviews = inputs.compose.services.filter((s) => isReview(s, inputs));
    if (reviews.length === 0) return pass();
    for (const review of reviews) {
      const problem = isolationProblem(review) ?? settingsProblem(review) ?? hardeningProblem(review);
      if (problem !== null) return problem;
    }
    return networkProblem(inputs, new Set(reviews.map((s) => s.name)));
  },
};

/** Exactly review_web, and nothing to read: no secret, env file or mount. */
function isolationProblem(review: Service): Outcome | null {
  const { name } = review;
  if (review.networkMode !== null || review.networks.length !== 1 || review.networks[0] !== NETWORK)
    return fail(`${name} joins a network other than ${NETWORK}`);
  if (review.ports.length > 0) return fail(`${name} publishes a port`);
  if (review.secrets.length > 0) return fail(`${name} reads a secret`);
  if (review.envFiles.length > 0) return fail(`${name} reads an env file`);
  if (review.mounts.length > 0) return fail(`${name} mounts a file or volume`);
  return null;
}

/** Only the names review reads, each a literal. A value is never printed, only its name. */
function settingsProblem(review: Service): Outcome | null {
  for (const [key, value] of review.environment) {
    if (!SETTINGS.has(key)) return fail(`${review.name} sets a name it does not read`);
    if (!("literal" in value)) return fail(`${key} is not a literal`);
  }
  return null;
}

function hardeningProblem(review: Service): Outcome | null {
  const { readOnly, user, capDrop, capAdd, securityOpt } = review.hardening;
  const uid = user?.split(":")[0];
  if (readOnly !== true) return fail(`${review.name} is not read-only`);
  if (uid === undefined || uid === "" || uid === "0" || uid === "root") return fail(`${review.name} runs as root`);
  if (capDrop.join() !== "ALL" || capAdd.length > 0) return fail(`${review.name} keeps a capability`);
  if (!securityOpt.includes("no-new-privileges:true")) return fail(`${review.name} may gain privileges`);
  return null;
}

/** review_web is internal and holds web and the review services alone. */
function networkProblem(inputs: Inputs, reviews: ReadonlySet<string>): Outcome {
  const network = inputs.compose.networks.find((n) => n.name === NETWORK);
  if (network === undefined) return fail(`network ${NETWORK} is not defined`);
  if (!network.internal) return fail(`${NETWORK} is not internal`);
  const stranger = inputs.compose.services.find(
    (s) => s.networks.includes(NETWORK) && s.name !== "web" && !reviews.has(s.name),
  );
  return stranger === undefined ? pass() : fail(`${stranger.name} is on ${NETWORK}, which only web and review share`);
}
