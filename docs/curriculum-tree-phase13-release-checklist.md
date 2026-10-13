# Curriculum Tree Phase 13 — Release Checklist

Status values: PASS / FAIL / UNVERIFIED / NOT APPLICABLE

| Item | Status | Evidence / next action |
|---|---|---|
| Technical implementation | PASS | Phase 12 baseline plus Phase 13 gate tests |
| Netlify production branch | UNVERIFIED | Confirm in Netlify project settings |
| Publish directory/base directory | UNVERIFIED | Confirm actual deployed directory |
| Build command | UNVERIFIED | No repository-local declaration; confirm UI |
| Auto deploy / auto publish | UNVERIFIED | Confirm production branch and deploy policy |
| Deploy Preview policy | UNVERIFIED | No existing preview was available for read-only verification |
| Runtime asset allowlist | PASS (local) | Required root assets and references audited |
| `_redirects` directory rules | PASS (syntax) | `/docs/*`, `/tests/*`, `/tmp/*` use trailing splats |
| PDF exclusion | UNVERIFIED | `*.pdf` suffix wildcards are not verified; use publish whitelist or confirm deploy behavior |
| QA/test/tmp exclusion | PASS (local) | Not runtime inputs; `_redirects` denies directories; tmp empty |
| Public release flag | PASS (OFF) | No public flag enabled; local preview gate only |
| Public navigation | PASS (OFF) | Hidden by default in normal access |
| Existing 3-screen compatibility | PASS | Browser and 146 automated tests |
| localStorage protection | PASS | Existing keys and rollback behavior unchanged |
| Catalog/relations baseline | PASS | 275 courses, 275 placements, 335 relations |
| Mobile behavior | PASS | 390px and prior 375px QA; no horizontal overflow |
| Official source terms | UNVERIFIED | PDF encrypted; no explicit reuse grant confirmed |
| Publication rights | REQUIRES REVIEW | Obtain written permission or revise composition |
| Deployment approval | NOT APPLICABLE | Release authorization was not granted |

## Approval-gated procedure

After the owner grants release authorization, confirm the Netlify values and
rights items above, then follow the updated runbook. Do not enable a public flag,
merge, push main, or deploy while any required item remains UNVERIFIED.
