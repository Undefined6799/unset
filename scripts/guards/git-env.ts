// P0.09j: git spawned for a throwaway repository must not follow the caller's GIT_* variables. Git exports GIT_DIR,
// GIT_WORK_TREE and the like to hooks so that git commands they run find the hook's repository (githooks(5), git
// v2.43.0 Documentation/githooks.txt:30-35), and GIT_DIR, GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY and GIT_COMMON_DIR
// override `cwd` and `-C` (git(1) "Environment Variables"). Under the pre-commit hook the guard tests' fixture
// repositories wrote into the real one: commits, branches, HEAD and index.

/** `env` without any GIT_* variable, so `cwd` or `-C` alone decides which repository git uses. */
export function withoutGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith("GIT_")));
}
