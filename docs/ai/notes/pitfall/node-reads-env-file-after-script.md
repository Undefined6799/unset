---
id: node-reads-env-file-after-script
type: pitfall
status: current
areas: ["[[deployment]]"]
summary: "Node reads --env-file anywhere before a literal --, even after the script name, and runs the file's NODE_OPTIONS."
code: [deployment/preflight/index.ts, deployment/preflight/cli.test.ts, deployment/preflight/stack.ts]
sources: [unset-plan/book-edits/2026-10-12-preflight-compose-inputs.md]
importance: high
related: ["[[deployment]]"]
replaced_by: null
tags: [pitfall, deployment]
checked: 2026-10-12
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
`deployment/preflight/cli.test.ts` enforces all three for the preflight.
`deployment/preflight/stack.ts` (P1.27w), the one way to start the dev stack, calls the preflight in that form and also
sets an empty `NODE_OPTIONS` for both children; `stack.test.ts` spawns the hook case with only `PATH` and `HOME`. The
wrapper takes the same `node stack.ts -- up …` form, stripping one leading `--` and refusing any other.
