# 0011 — No orchestrator until a measured need

Status: accepted (Alex, 2026-10-04, decision 35 "Adopt all", which adopted rule AB-3 and findings F-23).

## Context
unset.sh runs on one host with Docker Compose. Hosting is chosen at Phase 5 (decision 14), and
infrastructure as code arrives with it (P5.00). Rule AB-3 says a new process, role or orchestrator
needs an ADR naming its driver. Findings F-23 asked for this record so that nobody adds an
orchestrator because it is the usual pattern rather than because the system needs it.

## Decision
No Kubernetes, service mesh, operator, autoscaler or multi-region deployment until there is a
measured need beyond one host that Compose with `docker-rollout` cannot meet. A pull request that
adds an orchestrator cites that measurement (load, availability or recovery figures from
production) and supersedes this record.

## Alternatives
- k3s now: one-node Kubernetes from the start. Rejected: it adds a control plane, its own upgrade
  cycle and a larger attack surface for no measured benefit on one host.
- Nomad: a lighter scheduler. Rejected for the same reason; it is still a second system to run.
- Compose plus `docker-rollout` (chosen): one file describes the stack, and rolling web deploys
  need no scheduler.

## Consequences
The Kubernetes patterns that matter are realised in Compose: health and readiness checks, restart
policies, per-service resource limits (P1.29, P5.02), rolling web deploys (P5.03) and
digest-pinned signed images (P1.27). Scaling past one host means revisiting this record with
numbers; until then, capacity grows by a larger host.

## Compliance
Rule AB-3: a later orchestrator PR must link the measurement and a new ADR superseding this one.
Reviewed when that trigger fires, and in the Phase 5 hosting refine step (P5.00).
