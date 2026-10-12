---
id: git-hooks-export-git-dir
type: pitfall
status: current
areas: ["[[ci]]", "[[tests]]"]
summary: Hooks export GIT_DIR and ~/.gitconfig may sign commits, so git on a temp repo in tests runs with fixtureGitEnv().
code: [scripts/guards/git-env.ts, scripts/githooks/pre-commit]
sources: [https://github.com/git/git/blob/v2.43.0/Documentation/githooks.txt, https://github.com/git/git/blob/v2.43.0/Documentation/git.txt]
importance: high
related: []
replaced_by: null
tags: [pitfall, ci, tests]
checked: 2026-10-12
---
# Git hooks export GIT_DIR to everything they run

**What goes wrong.** The pre-commit hook runs `npm run guards`. Git runs the hook with `GIT_DIR`,
`GIT_INDEX_FILE` and `GIT_WORK_TREE` set to the real repository (githooks(5), git v2.43.0
`Documentation/githooks.txt:30-35`). These variables beat `cwd` and `git -C`, so a test that runs
`git init` and commits in a temp folder writes into the real repository instead. On 2026-10-05 one
hooked commit moved HEAD to a fixture branch, added fixture commits to the working branch and created
the branches `broken`, `deps`, `licence` and `scripts`. Nothing was pushed.

**Why.** Git meant the export for hooks that call git on their own repository; a hook that works on
another repository must clear the variables itself.

**The global config too (P1.23g).** The caller's `~/.gitconfig` and `/etc/gitconfig` also reach a
throwaway repository. In agent containers the global config sets `commit.gpgsign=true` with an external
signer, so every fixture commit ran it: slow enough to time out `job_reads_git_safely`, and signing
throwaway commits with a real key. `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` (git(1)
"Environment Variables", v2.43.0) stop git reading them.

**The rule.** Every git spawn on a throwaway repository, and any child process that runs git there,
gets `env: fixtureGitEnv()` from `scripts/guards/git-env.ts`: `withoutGitEnv()` plus no global or
system config and a fixed author and committer. The test `fixture_helper_strips_git_env` fails a
`scripts/guards/*.test.ts` file that runs `git init` without it, and `fixture_git_ignores_global_config`
proves a signing global config is ignored. Guards reading the real checkout keep `withoutGitEnv()`. As a
second layer the hook unsets the three variables before the guards (`pre_commit_unsets_git_env`).

**Repair.** Only by hand: the stray branches and commits stay in the local repository until someone
deletes them. Check with `git branch` and `git reflog` after a hooked commit that failed oddly.
