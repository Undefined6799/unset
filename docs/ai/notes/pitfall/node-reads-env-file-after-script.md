---
id: node-reads-env-file-after-script
type: pitfall
status: current
areas: ["[[deployment]]"]
summary: "Node reads --env-file anywhere before a literal --, even after the script name, and runs the file's NODE_OPTIONS."
code: [deployment/preflight/inputs.ts, deployment/preflight/cli.test.ts, deployment/preflight/stack.ts]
sources: [unset-plan/book-edits/2026-10-12-preflight-compose-inputs.md]
importance: high
related: ["[[deployment]]"]
replaced_by: null
tags: [pitfall, deployment]
checked: 2026-10-13
---
**What happens.** `node script.ts --env-file deploy.env` does not hand `--env-file` to the script alone. Node v26.10.0
scans every argv entry up to a literal `--` for the `--env-file` family (src/node_dotenv.cc:21-66), loads the file and
applies its `NODE_OPTIONS` before the script runs (src/node.cc:982-1003). A line such as
`NODE_OPTIONS=--import=data:text/javascript,process.exit(0)` then runs code inside a CLI that was meant to judge the
file. #677's verifier reproduced it as exit 0 on a file the preflight refuses.

**Why tests missed it.** A real `NODE_OPTIONS` in the environment, even an empty one, wins over the file's
(node.cc:996-998). A developer or CI shell that sets it hides the hole, so a test of it must spawn with only `PATH`
and `HOME`.

**The rule.** No CLI of ours takes a flag named `--env-file*`, `--require` or `--import`; callers write
`node <script> -- <args>`; an env file a CLI judges may not hold `NODE_OPTIONS`.
`deployment/preflight/cli.test.ts` enforces all three for the preflight, whose flags are `CLI_OPTIONS` in
`deployment/preflight/inputs.ts` (moved out of `index.ts` by P1.27j).
`deployment/preflight/stack.ts` (P1.27w), the one way to start the dev stack, calls the preflight in that form and also
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
