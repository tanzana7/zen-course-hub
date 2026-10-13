# Curriculum Tree Phase 12 — QA / Release Asset Validation

## Scope and Git safety

This phase refines the mobile curriculum-tree layout and validates the static
release inputs. No `main` merge, `main` push, production deploy, Netlify
setting change, or production-user storage access was performed. The requested
Desktop path is not present in this environment; the Git repository used was
`C:\Users\user\OneDrive\Desktop\zen-course-hub`, with the requested remote
and `feature/curriculum-tree-redesign` branch.

Baseline before the change:

- branch: `feature/curriculum-tree-redesign`
- HEAD / origin feature: `67b0bfcde617e865d51fe235829e6329cb4fe024`
- origin/main: `c7e9b0ca59e1d81694ad39f30c653c254aff5674`
- working tree: clean
- existing tests: 133/133 passed

## Implementation

The tree search input previously inherited a column flex layout and expanded
to 131px on narrow screens. The final mobile rules keep the toolbar in a
wrapping row, constrain the search field to 40–48px (42px measured), and give
the year/field controls flexible half-width rows. The control strip remains
 horizontally scrollable without increasing page width.

Fit-to-screen now uses both the map viewport width and height. The shared
`calculateCurriculumFit` helper can intentionally select a scale below the
ordinary 25% manual zoom floor, then centers the graph in the available map
area. Manual zoom/reset behavior is unchanged.

## Browser QA (isolated Chrome CDP)

The QA run used a temporary headless Chrome profile and the local static server
at `http://127.0.0.1:3004/`; no normal browser profile or user localStorage was
used. Runtime exception collection reported zero exceptions.

| viewport | search height | toolbar | map | fit scale | graph in fit | page overflow |
|---|---:|---:|---:|---:|---|---|
| 1440×900 | 32px | 32px | 1422×703 | 28% | 679×676, centered | none (1440/1440) |
| 1280×800 | 32px | 32px | 1262×603 | 24% | 578×576, centered | none (1280/1280) |
| 390×844 | 42px | 103px | 378×459 | 15% | 350×348, centered | none (390/390) |
| 375×812 | 42px | 103px | 363×420 | 14% | 335×333, centered | none (375/375) |
| 844×390 | 32px | 32px | 826×193 | 7% | 166×165, centered | none in emulated page viewport |

Additional checks:

- 390px search results state: the candidate list increases the toolbar to
  141px and the map remains usable at its 420px minimum; no horizontal
  overflow was introduced.
- 390px/375px graph reset remains 100% for detailed exploration, while fit
  returns to 15%/14% respectively.
- Clicking a tree node opened the course detail panel at 1440px and 375px.
- Existing list view loaded at 390px with no page-width overflow.
- Preview screenshots include overview, fit, reset, search, detail, landscape,
  and existing-list states in `docs/qa/curriculum-tree-phase12/`.

## Data and storage regression

- courses: 275, unique IDs: 275
- curriculum placements: 275
- advisory relations: 335 unique; self relations: 0; unknown IDs: 0
- Existing list, simulator, graduation, `myClasses`,
  `completedClasses`, and `fourYearSimulatorPlanV1` paths were not changed.
- Existing storage compatibility and transaction tests remained green.

## Static checks and tests

- `node --check app.js`: PASS
- `node --check graduation-requirements.js`: PASS
- `node --check simulator-rules.js`: PASS
- `node --check course-sorting.js`: PASS
- `node --test`: **140/140 PASS**, 0 failed, 0 skipped (133 existing plus 7
  Phase 12 checks)
- `git -c core.whitespace=cr-at-eol diff --check`: PASS

## Netlify / distribution audit

No repository-local `netlify.toml`, `package.json`, or CI workflow declares the
Netlify production branch, publish directory, build command, deploy context,
or deploy history; those values remain **UNVERIFIED** from this checkout. No
deploy was attempted.

The root `_redirects` file denies `/docs/*`, `/tests/*`, `/tmp/*`, and PDF
paths. `.gitignore` excludes future temporary output and PDFs. The intended
runtime assets are the root HTML/CSS/JS/JSON files; QA screenshots, tests, tmp
files, and source PDFs are not intended runtime inputs. Whether Netlify is
configured to publish the directory containing `_redirects` must be confirmed
in the Netlify project before release.

The tree remains preview-only (localhost/127.0.0.1 plus
`?curriculumPreview=1`). The JSON asset itself is not an access-control
boundary. Official-PDF publication rights remain **UNVERIFIED**; the PDF is
not present in this repository.

## Release assessment

- Technical: **TECHNICALLY READY** for this phase's mobile/layout scope.
- Publication permission: **UNVERIFIED**.
- Production: unchanged; release not performed.

Before a future public release, verify Netlify's actual publish directory and
deploy context, obtain/record permission for the official-source-derived
layout, replace the local preview gate with an explicitly approved release
flag, and run the production smoke plan from Phase 11.
