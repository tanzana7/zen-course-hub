# Curriculum Tree Phase 6 audit

## Scope

This remains a private preview. The user-provided `curriculumtree2025_260310.pdf` is a visual source only and is not shipped as a web asset. Phase 6 changes are limited to the placement data, an audit record, and data-integrity tests; the Phase 5 canvas, pan/zoom, details, and enrollment drawer remain unchanged.

## PDF analysis

The source is one encrypted page with copy extraction disabled. No access-control bypass or password recovery was attempted. The page was rendered directly from the PDF with Poppler at 200 DPI into six overlapping regional crops under `tmp/pdfs/phase6/`. The crops covered the introduction/foundation area, information and mathematics tracks, culture/social/economy tracks, digital-industry/social-connection/free-course tracks, and the lower DP/project area. OCR was not used as a source of truth; labels were read from the rendered images and matched against the existing `courses.json` catalog.

The existing 72 DPI tile and 150 DPI regional evidence from Phase 5 was retained. New entries keep the legacy `verificationMethod` vocabulary for compatibility with the Phase 4 validator and carry `verificationDpi: 200` plus a `verificationNote` identifying the direct regional render. Coordinates remain normalized PDF coordinates in the existing schema.

## Course matching

| Metric | Result |
| --- | ---: |
| Catalog courses | 275 |
| Confirmed before Phase 6 | 130 |
| New visually verified placements | 145 |
| Confirmed after Phase 6 | 275 / 275 |
| Remaining provisional catalog placements | 0 |
| Confirmed rate | 100% of the application catalog |
| Duplicate course IDs | 0 |
| Unknown placement IDs | 0 |
| Phase 6 direct-render regions | 6 at 200 DPI |

The 145 additions were matched by subject label, field/category context, and visible card position in the regional renders. Existing confirmed entries were retained unless the source data already contained a separate coordinate collision; no course IDs were invented and no catalog names were changed.

## PDF-only labels

`日本文学Ⅱ`, `文化人類学Ⅱ`, and `人生設計とお金の管理` remain listed in `pdfOnlySubjects`. They are visible in the PDF but do not have a safe one-to-one ID in the current 275-course catalog, so no synthetic placement ID was created.

## Layout and semantics

The JSON keeps the existing `pdf-normalized-v1` coordinate system, card dimensions, category/field metadata, credit-color legend, AP/DP bands, and advisory relation semantics. The map still treats `course-relations.json` as advisory links rather than official PDF arrows. The 275 catalog cards are now all represented by a placement entry; the UI continues to render any future unmapped course through its existing provisional fallback.

## Browser QA

Phase 5's isolated Chrome/CDP run already exercised the unchanged renderer at 1440×900, 1280×800, 390×844, and 375×812, including map fit, pan/zoom, details, drawer registration, and zero document overflow. Phase 6 only changes the JSON placement source. A fresh smoke run was repeated after the data update at the same four viewports; screenshots are stored under `docs/qa/curriculum-tree-phase6/` and are private review artifacts only.

## Remaining notes

- The three PDF-only labels require a future catalog update before they can be linked to stable IDs.
- Existing coordinate collisions from the earlier visual-tile dataset are preserved for auditability; they are distinct course IDs and do not change the catalog or relationship data.
- No main merge, main push, or Netlify deployment was performed in Phase 6.
