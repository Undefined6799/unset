---
id: secret-finding-on-a-branch-reddens-main
type: pitfall
status: current
areas: ["[[ci]]", "[[tests]]"]
summary: A key-shaped test literal on any pushed branch reddens the secrets scan on main; a later fix does not clear it.
code: [.github/workflows/ci.yml, .github/.gitleaksignore, scripts/ci/secrets-fixtures.ts]
sources: [https://github.com/gitleaks/gitleaks/blob/v8.30.1/detect/detect.go, https://github.com/gitleaks/gitleaks/blob/v8.30.1/cmd/root.go]
importance: high
related: ["[[git-hooks-export-git-dir]]"]
replaced_by: null
tags: [pitfall, ci, tests]
checked: 2026-11-23
---
# A secret-shaped test value on a branch keeps main red

**What goes wrong.** On 2026-11-20 and 21 four chat test files committed a made-up Megolm `sender_key` as a literal
base64 string. gitleaks' default `generic-api-key` rule reads it as a secret. The branch was a draft, and drafts
run only the `code` job, so its own `secrets` check never ran. The push to main that followed scans the full
history of every branch (P0.07a), found four findings, and every later main push stayed red for a day. Ready
pull requests scan only their own commits, so all of them stayed green and nothing blocked a merge or told
anyone.

**Why it does not go away.** gitleaks scans each commit's own diff. Replacing the literal in a later commit
leaves the old commit's finding in place for as long as any branch holds that commit. Only rewriting those
branches or naming the finding in `.github/.gitleaksignore` clears it.

**The ignore file's reach** (gitleaks v8.30.1 `detect/detect.go`, `AddFinding`): an entry
`commit:file:rule:line` hides that one finding in that one commit. An entry `file:rule:line` hides the line in
every commit and the working tree, so ours never uses that form
(`ignore_entries_name_one_commit_and_a_test_file`). `cmd/root.go` also reads a `.gitleaksignore` in the
scanned folder unasked, so the file lives in `.github/` and only the two history scans name it.

**The rule.** A test never commits a key-shaped literal. Build it when the test runs (the chat tests'
`unpadded("label")`), or use a short low-entropy stand-in. Before pushing any branch, draft or not, run gitleaks
over `origin/main..HEAD` with the repository config. A new ignore entry loosens secret scanning and needs Alex's
typed line (ADR 0059).

**Repair.** Delete an ignore entry once no branch on origin holds its commit: fetch every branch
(`+refs/heads/*:refs/remotes/origin/*`) and check that `git branch -r --contains <commit>` prints nothing.
