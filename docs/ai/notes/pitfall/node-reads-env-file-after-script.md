---
id: node-reads-env-file-after-script
type: pitfall
status: current
areas: ["[[deployment]]"]
summary: "Node reads --env-file anywhere before a literal --, even after the script name, and runs the file's NODE_OPTIONS."
code: [deployment/preflight/inputs.ts, deployment/preflight/regular-file.ts, deployment/preflight/cli.test.ts, deployment/preflight/stack.ts, deployment/preflight/served-leaf.ts, scripts/dev-precheck.ts]
sources: [unset-plan/book-edits/2026-10-12-preflight-compose-inputs.md]
importance: high
related: ["[[deployment]]"]
replaced_by: null
tags: [pitfall, deployment]
checked: 2026-10-27
---
**What happens.** `node script.ts --env-file deploy.env` does not hand `--env-file` to the script alone. Node v26.12.0
scans every argv entry up to a literal `--` for the `--env-file` family (src/node_dotenv.cc:21-66), loads the file and
applies its `NODE_OPTIONS` before the script runs (src/node.cc:990-1011). A line such as
`NODE_OPTIONS=--import=data:text/javascript,process.exit(0)` then runs code inside a CLI that was meant to judge the
file. #677's verifier reproduced it as exit 0 on a file the preflight refuses.

**Why tests missed it.** A real `NODE_OPTIONS` in the environment, even an empty one, wins over the file's
(node.cc:1004-1006). A developer or CI shell that sets it hides the hole, so a test of it must spawn with only `PATH`
and `HOME`.

**The rule.** No CLI of ours takes a flag named `--env-file*`, `--require` or `--import`; callers write
`node <script> -- <args>`; an env file a CLI judges may not hold `NODE_OPTIONS`.
`deployment/preflight/cli.test.ts` enforces all three for the preflight, whose flags are `CLI_OPTIONS` in
`deployment/preflight/inputs.ts` (moved out of `index.ts` by P1.27j).
`deployment/preflight/stack.ts` (P1.27w), the one way to start the dev stack, calls the precheck in that form and also
sets an empty `NODE_OPTIONS` for both children; `stack.test.ts` spawns the hook case with only `PATH` and `HOME`. The
wrapper takes the same `node stack.ts -- up …` form, stripping one leading `--` and refusing any other.

Re-checked at P1.27u (#700), which changed `index.ts`'s real-path resolution, its usage text and its `readlink`
and `statfs` deps; the flag parsing and the three rules above are unchanged.
Re-checked at P1.34p (#704), which reads env files through an `O_NOFOLLOW|O_NONBLOCK` descriptor; the rules
above still hold, and the reader never loads a file into a Node process.
P1.34s lists the wrapper's own flags in `WRAPPER_OPTIONS`, and `stack.test.ts` bans any starting `env-file`, `require`
or `import`, as `cli.test.ts` does for the preflight's.
Re-checked at P1.27l, which adds `local` to `--env`'s values and the usage text; no flag changed, and the rules
above still hold.
Re-checked at P1.33k, which drops `stack.ts`'s unused `node:fs` and `node:path` imports left by P1.33h's move to
`shared/host-pin`; no flag, argv form or child environment changed, and the rules above still hold.
Re-checked at P1.35a, which adds a `readdir` input to `inputs.ts` for the dev CA folder walk; no flag, argv form or
env-file read changed, and the rules above still hold.
Re-checked at P1.34d, which lets `stack.ts` take `--env local` and, after `up`, run `served-leaf.ts` as a third child.
That child gets the same environment, empty `NODE_OPTIONS` included, and is called as `node served-leaf.ts -- --env
local`, which refuses any other form; `stack.test.ts` pins the argv. No `--env-file*`, `--require` or `--import` flag
was added, and the rules above still hold. The four `npm run` scripts call the wrapper the same way, as
`node deployment/preflight/stack.ts -- up …`.
Re-checked at P1.35p, which moves the env files' `O_NOFOLLOW|O_NONBLOCK` reader from `inputs.ts` to `regular-file.ts`
unchanged and gives C18 the same reader for the dev root copies; no flag, argv form or child environment changed, and
the rules above still hold.
Re-checked at P1.01a, which spells `stack.ts`'s host-pin import as `@unset/shared-host-pin`; no flag, argv form or
child environment changed, and the rules above still hold.
Re-checked at P1.29s: `up` runs `scripts/dev-precheck.ts` as the first child, same `node … --` form; its `CLI_OPTIONS`
are env, compose, interpolation-env, none of which Node reads, and it then runs the preflight the same way.
Re-checked at P1.37n, which swaps `--build` for `--no-build` in the docker child under `dev` only; the precheck child,
its argv form and the child environment are unchanged.
Re-checked at P1.36g, which makes `inputs.ts` also record each service's env-file names for C30; the files are read
by the same reader, and no flag, argv form or child environment changed.
Re-checked at P2.26b, which runs verify-images as `/usr/bin/env PATH=<cosign's folder> node <script> <lock>
--trusted-root <file>`: every argument is a fixed path under the checkout, none is `--env-file`, and the child's PATH
narrows to the pinned cosign's folder, so the rules above still hold.
Re-checked at P2.26v, which adds an optional `arch` dep to `inputs.ts` for picking the pinned cosign; no flag
changed, and the rules above still hold.
Re-checked at P1.34r, which gives env files their own reader in `inputs.ts` (walk, then `O_NOFOLLOW|O_NONBLOCK` open,
fstat, 64 KiB cap; `regular-file.ts` now serves C18 only) and moves `cli.test.ts`'s fixtures out of `/tmp` into the
user's `~/.cache`, since the walk refuses a world-writable parent; the two tests still spawn with only `PATH` and
`HOME`, no flag or argv form changed, and the rules above still hold.
