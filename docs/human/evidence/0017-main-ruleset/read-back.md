# Main ruleset read-back (ADR 0017)

Read 2026-10-06 22:35Z over REST with the session token, after Alex applied the ruleset by hand
(GitHub settings cannot be changed from an agent session). Commands:
`gh api repos/Undefined6799/unset/rulesets`, `gh api repos/Undefined6799/unset/rulesets/24613527`,
`gh api repos/Undefined6799/unset/private-vulnerability-reporting`.

## Results against step P0.03's read-backs
- ruleset_active: pass. One ruleset, "main", id 24613527, enforcement active, target branch,
  ref `~DEFAULT_BRANCH`, `bypass_actors` empty.
- required_checks_set: pass. Contexts exactly `.github/required-checks.json` (check, audit,
  secrets, actionlint, semgrep, pr-shape), each with `integration_id = 15368` (GitHub Actions),
  `strict_required_status_checks_policy = false`.
- direct_push_refused: pass, as a ruleset read (no push): `non_fast_forward`, `deletion` and
  `pull_request` rules on the default branch with an empty bypass list.
- ruleset_rules: pass on architecture's tick list (record github-pro-protection, 13:05Z):
  `deletion`, `non_fast_forward`, `required_linear_history`, `pull_request`
  (`required_approving_review_count = 0`, `require_code_owner_review = false`,
  `allowed_merge_methods = ["squash"]`), `required_status_checks`. Two differences from the older
  P0.03 text: no `required_signatures` (tick list item 6: off, agent commits are unsigned) and
  `required_review_thread_resolution = false` (the tick list does not ask for it).
- Private vulnerability reporting: `{"enabled": true}`.

## Not readable from an agent session
The Actions permission paths (`actions/permissions`, `.../workflow`, fork pull request approval)
return 403 through this session's proxy, and `security_and_analysis` (secret scanning, push
protection) is not returned. Alex reported them set at 22:28Z; L.04 re-checks them.

## Noted
- `require_extra_approval_for_unattributed_changes = true` is on in the pull request rule. It is
  not on the tick list; if an agent pull request ever cannot merge, it is the first thing to check.
- The repository still allows merge commits and rebase merging in its general settings; the
  ruleset's `allowed_merge_methods = ["squash"]` already forces squash on `main`.

## Raw rules (as returned)
```json
{
  "id": 24613527,
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "exclude": [],
      "include": [
        "~DEFAULT_BRANCH"
      ]
    }
  },
  "rules": [
    {
      "type": "deletion"
    },
    {
      "type": "non_fast_forward"
    },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "required_reviewers": [],
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "require_extra_approval_for_unattributed_changes": true,
        "allowed_merge_methods": [
          "squash"
        ]
      }
    },
    {
      "type": "required_linear_history"
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          {
            "context": "check",
            "integration_id": 15368
          },
          {
            "context": "audit",
            "integration_id": 15368
          },
          {
            "context": "secrets",
            "integration_id": 15368
          },
          {
            "context": "actionlint",
            "integration_id": 15368
          },
          {
            "context": "semgrep",
            "integration_id": 15368
          },
          {
            "context": "pr-shape",
            "integration_id": 15368
          }
        ]
      }
    }
  ]
}
```
