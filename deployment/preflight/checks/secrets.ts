// C9 (P1.30): every env file and secret file the stack reads exists, holds something, is readable by its owner only
// (mode 0600) and belongs to the user running the deploy.
import { type Check, fail, missing, pass } from "./types.ts";

export const c9: Check = {
  id: "C9",
  run: ({ secretPaths, stat, uid }) => {
    for (const path of secretPaths) {
      const info = stat(path);
      if (info === null) return missing(path);
      if (!info.isFile() || info.size === 0) return fail(`${path} is empty or not a file`);
      if ((info.mode & 0o777) !== 0o600) return fail(`${path} is not mode 0600`);
      if (info.uid !== uid) return fail(`${path} is not owned by the deploy user`);
    }
    return pass(`${secretPaths.length} files`);
  },
};
