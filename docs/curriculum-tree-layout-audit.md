# Curriculum Tree Phase 3 layout audit

## Source

- Primary visual reference: `curriculumtree2025_260310.pdf` (one page, 7594 x 7557 pt).
- The PDF is encrypted with text-copy disabled, so the audit uses rendered visual inspection rather than text extraction.
- The PDF itself is not shipped as a site asset.

## Confirmed structure

The rendered page clearly shows a near-square curriculum map with the following structural bands:

- AP4 across the top, with AP1/AP3 and AP2 colour bands below it.
- A 14-credit introduction band.
- Foundation bands for base literacy, multilingual information understanding, and world understanding.
- A larger advanced-course area grouped by mathematics/information, culture/thought, society/network, and economy/market.
- A separate social-connection area and a free-course area on the right.
- A project-practice band and DP1--DP4 bands at the bottom.

These bands, colours, labels, and their relative order are stored in `curriculum-tree-layout.json` and rendered in one stable coordinate system.

## Course matching

- Catalog courses available to the preview: 275.
- Existing course IDs are reused; no IDs are invented.
- All 275 cards are assigned to a structural column using existing course metadata (`tag`, `category`, and requirement flags).
- Exact per-card coordinates could not be verified for every course because the PDF text is not extractable and the rendered card text is below reliable reading resolution at full-page scale.
- Therefore per-card confidence is `structure-only`, not an assertion that the position is an official course-level mapping.

## Interactive implementation

- `curriculum-tree-layout.json` is the maintenance source for canvas dimensions, bands, and structural columns.
- Cards are HTML elements and reference relation lines are SVG elements in the same coordinate system.
- Pan is pointer-based, zoom is continuous and cursor-centred, and fit-to-view computes scale/translation from the canvas bounds.
- Reference relation lines are dashed and are explicitly not presented as official prerequisite arrows.

## Known unresolved items

1. Individual card placement and official arrow semantics require an unencrypted, text-readable source or a manually reviewed mapping from the curriculum owner.
2. Copyright/licence approval for a faithful public reproduction is still required; this phase remains private-preview only.
