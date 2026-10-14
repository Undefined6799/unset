// Pins a path, and the Docker daemon's socket, to this machine (P1.33h): C9's walk and localDockerHost, shared by the
// deploy preflight and the local token reader. Generic: it knows nothing of Compose or the preflight.
export { DEFAULT_DOCKER_HOST, hostWalk, localDockerHost, UsageError } from "./docker-host.ts";
export {
  FILESYSTEM_NAMES,
  foreignFilesystem,
  resolveChecked,
  WALK_REASONS,
  type WalkInputs,
  type WalkProblem,
  within,
} from "./walk.ts";
