# Curriculum Tree Phase 13 — Release Gate

確認日: 2026-10-13 (Asia/Tokyo)

## Git

- Repository: `C:\Users\user\OneDrive\Desktop\zen-course-hub`
- Branch: `feature/curriculum-tree-redesign`
- HEAD: `dd22dc8b64674733b8284738421ef7d66b7541e9`
- origin/main: `c7e9b0ca59e1d81694ad39f30c653c254aff5674`
- Working tree at start: clean
- main merge/push/deploy: not performed

The requested `C:\Users\user\Desktop\zen-course-hub` path does not exist in
this environment. The OneDrive Desktop checkout is the repository with the
expected remote, branch, and SHA.

## Netlify configuration

Repository inspection found no `netlify.toml`, `package.json`, GitHub workflow,
or other repository-local deploy declaration. Therefore the following values
cannot be established from Git and are **UNVERIFIED**:

- production branch
- publish directory/base directory
- build command
- automatic deploy and auto-publish policy
- Deploy Preview/branch-deploy policy
- deploy history and deploy ID

Netlify documentation states that the publish directory is the finished output
directory, that production deploys follow the configured production branch, and
that `_redirects` must end up in the deployed directory. Sources checked on
2026-10-13:

- https://docs.netlify.com/deploy/deploy-overview/
- https://docs.netlify.com/manage/routing/redirects/overview/
- https://docs.netlify.com/manage/routing/redirects/redirect-options/

The Netlify CLI is not installed and no existing Netlify authentication was
available, so no admin/API setting was queried and no credentials were created.

## Distribution audit

The repository is a root-oriented static site. Runtime candidates are the root
HTML, CSS, JavaScript, JSON, verification HTML, sitemap, and `_redirects`
files. `docs/`, `tests/`, `tmp/`, browser profiles, logs, and PDFs are
development material, not runtime inputs.

The Phase 13 asset test checks the required runtime files, local script/style
references, absence of root PDFs, and an empty `tmp/`. It passed. The phase 12
and phase 13 QA images remain under `docs/qa/` for review evidence; they are
not intended as runtime assets. The repository contains no PDF files.

### `_redirects` evaluation

The rules for `/docs/*`, `/tests/*`, and `/tmp/*` use Netlify's documented
trailing splat form and are syntactically suitable for directory paths. The
current `/*.pdf` and `/**/*.pdf` lines are **not** treated as a verified
extension wildcard: Netlify documents that `*` cannot occur in the middle of a
path segment. These lines must not be considered a complete PDF access control
boundary. Because the checkout contains no PDFs, the immediate artifact has no
PDF to expose; before publication, the actual publish directory must be
verified or a whitelist build must be adopted. `_redirects` is at the repository
root, but its deployed location is **UNVERIFIED** until Netlify settings are
read.

Read-only HTTP checks against the existing production site returned:

- `/`: 200
- `/courses.json`: 200
- `/_redirects`, `/docs/...`, `/tests/...`, `/tmp/...`, and a root PDF path:
  404

These checks describe the current production deployment only; they do not prove
that the Phase 13 feature branch is deployed.

## Release control

The current gate is intentionally local-only:

```js
['localhost', '127.0.0.1'].includes(window.location.hostname)
  && new URLSearchParams(window.location.search).get('curriculumPreview') === '1'
```

The navigation button is hidden by default in `index.html`. The same condition
guards tree initialization. Normal access leaves the tree unavailable; local
preview access shows the fourth navigation entry and permits tree rendering.
The tree still uses the existing enrollment storage path and does not write
`completedClasses` or `fourYearSimulatorPlanV1`.

There is no public release flag in this phase. The smallest future release
change is to introduce one reviewed constant at this gate, keep preview and
release predicates separate, expose the navigation only when the release
condition is true, and add an explicit test for both predicates. This is not
enabled or committed as a public release in Phase 13.

The isolated browser run confirmed:

- normal access: navigation hidden, tree hidden, body overflow visible
- preview access: navigation visible, tree initially hidden until selected
- preview tree: map rendered and controls available
- mobile preview at 390px: no horizontal overflow, body scroll lock active only
  while the tree view is open
- returning to the list: body overflow restored and the list remains usable

An ON-equivalent public test was not run because no public flag exists; the
preview path is the only currently implemented enabled state.

## Data and compatibility

- courses: 275, unique IDs: 275
- curriculum placements: 275
- duplicate geometry: 0 (Phase 12 baseline)
- advisory relations: 335 unique, unknown IDs 0, self relations 0
- `myClasses`: unchanged, shared with the existing list and tree enrollment
- `completedClasses`: unchanged
- `fourYearSimulatorPlanV1`: unchanged
- save failure rollback and reload compatibility: covered by the existing test
  suite and still passing

## Official source and publication rights

The downloaded reference PDF `curriculumtree2025_260310.pdf` was inspected
read-only. `pdfinfo` reports one encrypted page, AES-256 encryption, copying
disabled, and no extractable text permission. No reuse licence or permission
statement could be verified from the file metadata; the source PDF is not in
the repository and is not shipped by this branch.

ZEN's public academics page identifies the official curriculum and links to a
course-list PDF, but does not establish permission to reproduce the specific
map layout, color scheme, or institutional marks in this non-official tool:

- https://zen.ac.jp/academics (checked 2026-10-13)

This is a data/rights gap, not a finding that the reproduction is unlawful.
The fact that the service is non-official or that the map was redrawn in HTML
does not itself grant permission. The recommended options are to obtain written
permission/terms from ZEN University or reduce dependence on the official
composition before public release. No inquiry was sent.

## QA and remaining blockers

- Syntax checks: PASS
- Tests: 146/146 PASS (140 existing plus 6 Phase 13 release-gate checks)
- Isolated browser QA: PASS for normal/preview navigation, tree overview,
  detail, enrollment, return-to-list, graduation modal, and 390px mobile tree
- Runtime exceptions during the run: 0
- Screenshots: `docs/qa/curriculum-tree-phase13/`
- Technical readiness: **TECHNICALLY READY**
- Deployment configuration: **UNVERIFIED**
- Publication rights: **REQUIRES REVIEW**

Remaining blockers before publication are Netlify admin configuration
verification, a verified publish whitelist or equivalent PDF exclusion, and
written/otherwise authoritative permission for the official-source-derived
composition. Release authorization is **NOT GRANTED**.
