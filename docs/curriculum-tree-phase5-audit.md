# Curriculum Tree Phase 5 audit

## Scope

This is a private preview only. The user-provided `curriculumtree2025_260310.pdf` is the visual source of truth; it is not shipped to the site and no public URL is added for it.

The PDF is a single encrypted page with copy extraction disabled. It was inspected as an image using direct Poppler renders: the existing 72 DPI 5×5 overlapping tiles were retained, and 16 regional crops were rendered directly from the PDF at 150 DPI for the remaining small labels. OCR was used only as a locator aid; a placement was marked confirmed only when the rendered label and its position could be matched to a course in `courses.json`.

## Official PDF matching

| Metric | Result |
| --- | ---: |
| Catalog courses | 275 |
| Confirmed before Phase 5 | 92 |
| Confirmed after Phase 5 | 130 |
| New confirmed placements | +38 |
| Remaining provisional catalog courses | 145 |
| Confirmed ratio | 47.3% (130 / 275) |
| Duplicate placement IDs | 0 |
| Placement IDs missing from catalog | 0 |
| Direct high-resolution render | 150 DPI, 16 regions |

The additional high-resolution pass covered the small information/technology cards, philosophy and culture cards, psychology/law/history cards, industry-history cards, illustration and free-course cards, and digital-image/creation/app cards. Confirmed coordinates are normalized to the PDF page and retain the PDF-relative ordering; they are not moved for visual balance.

Three visible labels could not be mapped to the current catalog without guessing and remain explicitly recorded as `pdfOnlySubjects`: `日本文学Ⅱ`, `文化人類学Ⅱ`, and `人生設計とお金の管理`. All other catalog courses remain available through the existing fallback placement and are rendered as provisional, never as official PDF coordinates.

The implementation records the source page, normalized `x/y/width/height`, field/category, confidence, and verification method (`visual-tile-72dpi` or `visual-tile-150dpi`) for every confirmed placement. The PDF's color conventions are retained through the existing 1/2/4-credit card treatment and AP/DP/stage bands. Existing advisory course relations remain advisory and are not presented as official PDF arrows.

## Full-canvas explorer UI

- Tree mode now uses a fixed `100dvh` surface with safe-area padding and no page-level scroll; the graph viewport consumes the remaining height.
- Initial camera state is computed from the actual graph and viewport (`fitCurriculumToViewport`) so the map is visible immediately at every tested viewport. Resize keeps the fit only until the user manually pans or zooms.
- Existing pan, wheel zoom, cursor-centred zoom, 100% reset, fit-to-view, search focus, detail, and mobile pinch interactions remain in place.
- The ordinary enrollment list is a right-side drawer. It is closed by default, opens from the `通常履修` control, preserves the existing list/drop zone/storage path, and has an explicit close state. Legacy mobile rules that made the column static are overridden only while tree mode is active, preventing a stray heading from appearing over the map.
- Dragging a map card automatically opens the drawer and exposes the drop target. A panel opened manually is not auto-closed; a canceled auto-open is closed after drag end. Duplicate registration continues to use the existing state transition and rollback path.

## Browser QA

Chrome Headless + CDP was run against `http://127.0.0.1:8080/?curriculumPreview=1` with isolated temporary profiles. The page rendered 275 nodes in each viewport and reported zero document-level horizontal overflow.

| Viewport | Result |
| --- | --- |
| 1440×900 | Map visible on initial fit; 28% fit scale; drawer open/close works; 0 overflow |
| 1280×800 | Map visible; 602–603px graph viewport; closed drawer is outside the viewport; 0 overflow |
| 390×844 | Map visible; 492px graph viewport; closed drawer hidden and non-interactive; 0 overflow |
| 375×812 | Map visible; 460px graph viewport; closed drawer hidden and non-interactive; 0 overflow |

The isolated interaction run verified a drawer toggle, native CDP mouse drag auto-open, drag target highlighting, drop registration through the existing `myClasses` path, and subsequent state rendering. The temporary profile and local test state are not part of the repository; the native mouse sequence was used for the drag check rather than relying only on synthetic DOM events.

## QA screenshots

The committed screenshots under `docs/qa/curriculum-tree-phase5/` are private-review artifacts:

- `A-1440-initial.png` / `B-1440-fit.png`: initial and fit map overview
- `C-1280.png`: desktop intermediate width
- `D-drawer-closed.png` / `E-drawer-open.png`: ordinary enrollment drawer states
- `F-drag-target.png` / `G-registered.png`: drag target and registered state
- `H-390.png` / `I-375.png`: mobile layouts
- `J-pdf-comparison.png`: implementation view paired with a cropped PDF inspection region; the source PDF itself is not shipped

## Remaining differences / limitations

The web canvas is an interactive reconstruction, not a distribution of the official PDF. Confirmed cards follow inspected PDF coordinates, while the 145 unmatched catalog courses use an explicitly provisional fallback because their individual labels could not yet be read with confidence. The three PDF-only labels above require catalog confirmation before they can receive IDs. These are documented data gaps, not guessed mappings. The feature remains gated behind `?curriculumPreview=1` and is not enabled on production/main.
