// P0.09j: git spawned for a throwaway repository must not follow the caller's GIT_* variables. Git exports GIT_DIR,
// GIT_WORK_TREE and the like to hooks so that git commands they run find the hook's repository (githooks(5), git
// v2.43.0 Documentation/githooks.txt:30-35), and GIT_DIR, GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY and GIT_COMMON_DIR
// override `cwd` and `-C` (git(1) "Environment Variables"). Under the pre-commit hook the guard tests' fixture
// repositories wrote into the real one: commits, branches, HEAD and index.

/** `env` without any GIT_* variable, so `cwd` or `-C` alone decides which repository git uses. */
export function withoutGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith("GIT_")));
}

// P1.23g: a throwaway repository must not read the caller's ~/.gitconfig or /etc/gitconfig either. A global
// `commit.gpgsign` made every fixture commit run an external signer, slow enough to time tests out and signing
// throwaway commits with a real key. GIT_CONFIG_GLOBAL and GIT_CONFIG_NOSYSTEM (git(1) "Environment Variables",
// git v2.43.0) replace and skip those files; the fixed identity stands in for the user.* they no longer supply.

// P1.23h: with no config file at all, git still reads $XDG_CONFIG_HOME/git/ignore and git/attributes (or
// ~/.config/git/...) as the defaults of core.excludesFile and core.attributesFile (git v2.43.0
// Documentation/config/core.txt), so a home `*.secret` ignore hid a file from a secrets fixture. GIT_CONFIG_COUNT with
// GIT_CONFIG_KEY_<n> and GIT_CONFIG_VALUE_<n> add runtime config above every file (Documentation/git-config.txt,
// "ENVIRONMENT"); the count is set here, never added to a caller's, whose GIT_* variables are already gone.

/** `withoutGitEnv(env)` that reads no global, system or home git file and commits as a fixed identity. */
export function fixtureGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...withoutGitEnv(env),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.excludesFile",
    GIT_CONFIG_VALUE_0: "/dev/null",
    GIT_CONFIG_KEY_1: "core.attributesFile",
    GIT_CONFIG_VALUE_1: "/dev/null",
    GIT_AUTHOR_NAME: "fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
}
