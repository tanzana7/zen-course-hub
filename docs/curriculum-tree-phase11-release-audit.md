# Curriculum Tree Phase 11 — Release Audit

## Scope and safety

This audit prepares `feature/curriculum-tree-redesign` for a future release. No
merge to `main`, production deploy, production-data access, or Netlify setting
change was performed. The working tree was checked before and after the audit.
The requested `C:\Users\user\Desktop\zen-course-hub` path is not mounted in this
environment; the same Git repository is available at
`C:\Users\user\OneDrive\Desktop\zen-course-hub` with the requested remote,
branch, and commit.

## Baseline and data integrity

- Catalog: 275 courses, 275 unique IDs.
- Curriculum placements: 275 entries in `curriculum-tree-layout.json`.
- Advisory relations: 335 unique pairs; 0 unknown IDs; 0 self-relations.
- Existing automated tests: 133/133 passed, 0 failed, 0 skipped.
- JavaScript syntax checks passed for `app.js`, `graduation-requirements.js`,
  `simulator-rules.js`, and `course-sorting.js`.

## Netlify and distribution audit

The repository contains no `netlify.toml`, `package.json`, `.github` workflow,
or other repository-local Netlify build declaration. Therefore the Netlify UI
values for production branch, publish directory, build command, deploy context,
and deploy history cannot be verified from this checkout and are marked
**UNVERIFIED**. The site is a static root application and does not require a
build command in the repository.

This branch adds `_redirects` while keeping the existing static layout. The
rules return 404 for `/docs/*`, `/tests/*`, `/tmp/*`, and PDF paths, preventing
QA evidence, test code, temporary files, and source PDFs from being served when
the Netlify publish directory is the repository root. `.gitignore` now ignores
future local `tmp/` output and PDFs; it does not pretend to untrack existing
historical documentation. A future release check must confirm that Netlify is
using the directory containing `_redirects`.

### Intended included assets

`index.html`, `style.css`, `app.js`, `courses.json`, `difficulty.json`,
`course-relations.json`, `curriculum-tree-layout.json`,
`graduation-requirements.js`, `graduation-requirements.json`,
`simulator-rules.js`, `course-sorting.js`, `quality-utils.js`, `tutorial.json`,
`sitemap.xml`, `google05151c606a13d780.html`, and the favicon/other static assets
present at release time.

### Intended excluded assets

`docs/`, `tests/`, `tmp/`, local PDFs, local logs, and browser profiles. The
repository currently has no tracked `tmp/` files and no PDF files. Historical
QA images remain in Git for review evidence but are denied by `_redirects`.

## Preview and release control

The curriculum navigation is hidden unless both conditions hold:

1. hostname is `localhost` or `127.0.0.1`; and
2. query parameter `curriculumPreview=1` is present.

The same gate controls drawing and event wiring; normal production access does
not show the curriculum-tree navigation. This is a UI/release gate, not an
access-control boundary: if the JSON assets are served by a root-publish host,
their URLs can still be requested directly. A future public release should
replace the local-only query gate with an explicitly reviewed release flag and
public navigation condition in one commit. No release flag was enabled here.

## Navigation and storage compatibility

The existing list, four-year simulator, and graduation views remain the primary
views. Preview navigation is a peer view and does not remove or rewrite their
state. Curriculum enrollment uses the existing `myClasses` transaction path;
it does not write `completedClasses` or `fourYearSimulatorPlanV1`. The Phase 10
browser smoke confirmed add/reload/delete/reload behavior and no horizontal
overflow at 390px and 375px. The existing storage compatibility tests cover
legacy, malformed, unknown-ID, rollback, and duplicate-state cases.

## Browser QA (isolated Edge/CDP profile)

Screenshots are under `docs/qa/curriculum-tree-phase11/`. The local static
server was used only for read-only verification and was not deployed.

- Normal navigation (1440px): tree nav hidden; list loads.
- Preview navigation (1440px): tree nav visible; tree opens with 275 nodes.
- Tree overview/detail/enrollment: rendered; detail and existing enrollment
  action were usable.
- 1280px preview: 275 nodes; document width equals viewport width.
- 390px normal/preview: tree gate and rendering work; width 390 equals client
  width.
- 375px preview: 275 nodes; width 375 equals client width.
- No JavaScript exception was observed in the smoke flow; no critical resource
  failure was observed in the local HTTP checks.

The local Node static server does not execute Netlify redirect rules, so deny
responses must be confirmed in a Netlify deploy preview before publication.

## Security, privacy, and official/unofficial status

No API keys, auth tokens, personal data, or official PDF files are present in
the tracked tree. The app uses localStorage only for the documented enrollment,
completed, and simulator plan keys. Existing external links are ordinary HTTPS
links and use the existing safe URL handling. The UI identifies itself as an
unofficial ZEN University support tool and labels curriculum relations as app
reference relations, not official prerequisites.

The official PDF is used as a visual reference for an independently rendered
map; the PDF itself is not in the repository or distribution list. Copyright,
trademark, and permission to publish a derived reproduction were not supplied
or verifiable from Git/Netlify, so publication permission is **UNVERIFIED**.
This is a release-governance blocker even though the implementation is
technically testable.

## Remaining issues

1. Confirm Netlify production branch/publish directory/build settings in the
   Netlify UI and ensure `_redirects` is in that publish directory.
2. Confirm that `/docs/*`, `/tests/*`, `/tmp/*`, and PDF URLs return 404 in a
   deploy preview.
3. Obtain explicit permission for the official curriculum-tree-derived
   reproduction before enabling public navigation.
4. Replace the localhost-only preview query with a reviewed release flag when
   publication is approved.

## Audit conclusion

Technical state: **TECHNICALLY READY WITH RELEASE-GATE FOLLOW-UPS**.

Publication permission: **UNVERIFIED**. This branch was not merged or deployed.
