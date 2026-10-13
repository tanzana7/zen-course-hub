# Curriculum Tree Release Runbook

This runbook is preparatory documentation only. None of the release, merge,
push, or deployment steps below were executed in Phase 11.

## Before approval

1. Confirm the repository, remote, branch, and clean working tree.
2. Confirm the release commit and review `git diff origin/main...HEAD`.
3. Run all syntax checks and `node --test`; do not release with failures.
4. Confirm 275 catalog courses, 335 advisory relations, 0 unknown IDs,
   0 self-relations, and 0 duplicate relation pairs.
5. Confirm Netlify production branch, publish directory, build command,
   deploy context, and `_redirects` location in the Netlify UI.
6. Verify a deploy preview returns 404 for docs, tests, tmp, and PDF paths.
7. Obtain explicit permission for publication of the independently rendered
   curriculum-tree reproduction. Technical readiness is not permission.
8. Review the release flag and public-navigation condition; keep the tree
   hidden until this approval checklist is complete.

## Release procedure (future, not executed)

1. Create a dedicated release commit that changes the reviewed release flag
   and public navigation condition only after approval.
2. Run syntax checks, the complete test suite, and `git diff --check`.
3. Run an isolated desktop/mobile browser smoke using a temporary profile.
4. Merge the feature with `git merge --no-ff` on `main` after confirming the
   expected base and feature SHAs.
5. Push `main` through the normal GitHub/Netlify integration. Do not upload
   files manually and do not deploy a dirty worktree.
6. Wait for the Netlify deploy to finish. Verify asset identity, critical
   resource status, console errors, navigation, enrollment, storage reload,
   and responsive overflow in isolated browser profiles.
7. Record the merge SHA, deploy ID, publish directory, test result, and smoke
   result in the release report.

## Rollback

- If the site is unavailable or a critical asset fails, stop further changes
  and use Netlify's previous successful deploy rollback, if authorized. Do not
  edit production files by hand.
- If a code fix is needed, create a forward-fix branch/commit and redeploy
  through the normal main integration after review. Never use force-push,
  reset, rebase, or history rewriting as rollback.
- Preserve `myClasses`, `completedClasses`, and `fourYearSimulatorPlanV1`;
  rollback must not clear or migrate user localStorage.
- If only the curriculum tree is defective, disable its reviewed release flag
  in a normal commit while leaving the existing list, simulator, and graduation
  views intact.
- After rollback, re-run asset, console, storage, and responsive smoke checks
  and document the decision.

## Post-release checks

Confirm `main` and `origin/main` match the release merge commit, the Netlify
production assets correspond to that commit, and the working tree is clean.
Retain QA evidence outside the public asset surface.
