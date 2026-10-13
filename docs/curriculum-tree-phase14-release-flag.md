# Curriculum Tree Phase 14 — Release Flag Report

## Scope

Phase 14 adds an explicit release flag for the curriculum-tree navigation. This branch prepares and verifies the public path but does not publish it, merge to `main`, change Netlify settings, or deploy production.

## Git state

- Branch: `feature/curriculum-tree-redesign`
- Baseline: Phase 13 commit `513803bc9fadd2d448455afa38fa858a095005dd`
- `origin/main`: unchanged during this phase
- Final committed flag: `false`
- Production data and the user's browser storage were not touched.

## Release flag

`app.js` contains the single release setting:

```js
const CURRICULUM_TREE_PUBLIC_ENABLED = false;
```

The runtime gate is `CURRICULUM_TREE_PUBLIC_ENABLED || curriculumTreePreviewEnabled`. The flag is a release-artifact setting; it is not read from URL parameters, `localStorage`, or other user-controlled state.

### OFF behavior

- Ordinary access keeps the existing public navigation hidden.
- The existing three public entry points remain available: list, four-year plan β, and graduation analysis.
- `localhost`/`127.0.0.1` with `?curriculumPreview=1` still initializes the same tree implementation for review.
- No storage key is added or rewritten.

### ON behavior (isolated temporary build only)

An isolated temporary copy with only the explicit flag changed to `true` was exercised through the same app initialization path. On a non-local host, the tree navigation was visible without a query parameter, opened the tree, loaded the layout, opened details, and returned to the list. The ON copy was never committed or served as production.

The non-local check used `foo.localhost:3006` with an empty query string; the
navigation was visible and no JavaScript exception was recorded. The full ON
browser pass used the same temporary build at 1440, 390, and 375px.

## Navigation and state

The existing navigation and `setMode` transition are reused. Graduation analysis remains the existing analysis action, so the public ON experience has four entry points without duplicating the graduation implementation. Returning from the tree clears explorer mode and restores normal page scrolling as before. `myClasses`, `completedClasses`, and `fourYearSimulatorPlanV1` retain their existing meanings and keys.

## Data baseline

- Courses: 275 unique IDs
- Curriculum placements: 275
- Duplicate geometry: 0
- Reference relations: 335
- Unknown/self relation IDs: 0/0

## QA

The Phase 14 browser matrix covers public OFF, localhost preview, and isolated public ON behavior at 1440, 1280, 390, and 375px. Screenshots are stored under `docs/qa/curriculum-tree-phase14/` and are review artifacts, not production assets. Console exceptions and page-level horizontal overflow were checked in the isolated browser.

The enrollment smoke added one isolated test course to `myClasses`, confirmed
the list/detail synchronization, then restored the exact pre-test value. The
`completedClasses` and `fourYearSimulatorPlanV1` values stayed unchanged.

The final automated suite preserves all previous tests and adds release-flag coverage. Syntax checks and `git diff --check` are run before commit.

## Netlify and publication

No Netlify settings or production deployment were changed. Repository-local configuration does not establish the production branch, base/publish directory, build command, auto-deploy policy, or Deploy Preview visibility; those values remain **UNVERIFIED** without authorized Netlify read access.

The official curriculum-tree PDF is encrypted and no reuse permission was verified. Publication rights therefore remain **REQUIRES REVIEW**. Technical readiness and publication permission are separate decisions.

## Remaining release steps (not executed)

1. Obtain publication approval and confirm Netlify settings.
2. In a dedicated release commit, change the single flag to `true` and rerun the full test/browser matrix on a production-like host.
3. Review the diff and merge to `main` with `--no-ff` only after approval.
4. Push `main`, verify the Netlify deploy and production assets, then run isolated production smoke tests.
5. If a blocker appears, use a forward fix or a previously verified Netlify deploy; do not rewrite history or delete user storage.
