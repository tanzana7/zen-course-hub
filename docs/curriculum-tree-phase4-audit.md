# Curriculum Tree Phase 4 visual audit

## Scope

This private preview uses `curriculumtree2025_260310.pdf` as the visual source of truth. The PDF is not shipped to the site and no public URL is added for it.

The source is a single encrypted page (`7594 × 7557 pt`). Copy extraction is disabled, so the page was rendered with Poppler `pdftoppm` at 72 DPI and inspected as 25 overlapping 1950px tiles (5 columns × 5 rows, 1800px step, 150px overlap). Inspection was manual from the rendered images, not an automatic structure-only placement.

## Placement result

- Existing catalog: 275 courses.
- Visually confirmed course placements: 92.
- Provisional placements: the remaining catalog courses continue to use the existing field/stage fallback and are explicitly marked `data-official-confidence="provisional"` in the preview.
- Duplicate placement IDs: 0.
- Placement IDs absent from `courses.json`: 0.
- Coordinates are normalized to the PDF page (`0..1`) and converted to the interactive 2400 × 2388 preview canvas at runtime.
- Confirmed placement metadata includes `field`, `category`, `confidence`, and `verificationMethod`.

The 91 confirmed cards cover the visible introductory, foundation, multilingual, culture/thought, society/network, economy/market, digital-industry, social-connection, and project areas. Long or absent catalog names are not silently invented. The explicit `pdfOnlySubjects` list records visible PDF labels that could not be matched to the current catalog (for example `コンピュータサイエンス概論` and `文化人類学Ⅱ`).

## Visual conventions recorded from the PDF

- Light blue card: 1 credit.
- White card: 2 credits.
- Pale yellow card: 4 credits.
- Orange/blue/pink/turquoise AP and DP bands are represented by the stage bands in the layout definition.
- Confirmed cards use a solid card treatment; provisional cards use a dashed, slightly muted treatment so an unverified location is never presented as official.

## Verification notes

The page is intentionally a local-only preview (`?curriculumPreview=1` on localhost/127.0.0.1). Pan, zoom, fit, fullscreen, search, detail, related-course navigation, and enrollment/drop interactions remain the Phase 3 implementation. The relations drawn by the app remain advisory course relations; they are not claimed to be the arrows in the official PDF.

Remaining differences are limited to areas where a PDF label was clipped, unreadable, or not present in the 275-course catalog. Those courses are left provisional or listed as PDF-only rather than assigned a guessed official coordinate.
