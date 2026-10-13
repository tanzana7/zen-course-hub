# Curriculum Tree Phase 9 — duplicate-position evidence audit

## Scope and source

This audit covers the 18 exact duplicate rectangles (36 courses) identified in
`curriculum-tree-layout.json` after Phase 8. The official source was
`C:\Users\user\Downloads\curriculumtree2025_260310.pdf`, page 1. The PDF is
encrypted and copy-restricted; it was not decrypted and no text-extraction
bypass was attempted. Instead, the page was rendered directly with Poppler at
200 DPI and inspected in regional crops. The temporary crops were removed after
QA and are not web assets; the evidence JSON retains their page-point bounds
and stable region labels.

The per-pair evidence, including the exact crop rectangle used, is in
`docs/curriculum-tree-phase9-duplicate-evidence.json`.

## Coordinate conversion audit

| Item | Observed value |
| --- | --- |
| PDF page | 1 of 1 |
| MediaBox | 0,0–7594,7557 pt |
| CropBox | 0,0–7594,7557 pt |
| Rotation | 0° |
| Regional render | 200 DPI, direct Poppler crop |
| Web canvas | 2400 × 2388 |
| Web coordinate basis | `pdf-normalized-v1`, normalized against the web canvas |
| Card rectangle | normalized `x`, `y`, `width`, `height` in the layout JSON |
| Evidence precision | regional crop rectangle in PDF points; row/column is recorded separately because the encrypted raster source does not expose a text bounding-box API |

The 18 duplicates were not caused by MediaBox/CropBox, rotation, or a DPI
conversion error. The PDF shows separate cards, while the old layout reused
the same coarse normalized rectangle for cards in separate sub-columns or
rows. The correction keeps the existing canvas and interaction model, but uses
distinct source coordinates for the inspected positions.

## Pair results

All 18 pairs are `DIFFERENT_POSITION` (root cause A: PDF positions are distinct,
but the former JSON rectangles were identical). The labels were legible in the
regional crops. No pair was treated as same-position merely to remove a stack.

| # | A | B | PDF evidence | Correction |
| ---: | --- | --- | --- | --- |
| 1 | 数学の方法 | インターネット概論 | left-mid: 数理上段行1 vs 情報下段行1 | B y/x separated |
| 2 | 逆さ科学史 | プロジェクトマネジメント概論 | left-mid: 数理上段行1 vs 情報下段行1 | B y/x separated |
| 3 | 初等代数概論 | Webアプリケーション開発3 | left-mid: 数理上段行1 vs 情報下段行1 | B y/x separated |
| 4 | 線形代数1 | Linux概論 | left-mid: 数理上段行1 vs 情報下段行1 | B y/x separated |
| 5 | 線形代数2 | オブジェクト指向プログラミング | left-mid: 数理上段行2 vs 情報下段行2 | B y/x separated |
| 6 | 解析学1 | コンピューターサイエンス概論 | left-mid: 数理上段行2 vs 情報下段行2 | B y/x separated |
| 7 | 解析学2 | JavaScriptによる自動化、効率化 | left-mid: 数理上段行2 vs 情報下段行2 | B y/x separated |
| 8 | グラフ理論 | 情報処理概論 | left-mid: 数理上段行2 vs 情報下段行2 | B y/x separated |
| 9 | 数理構造の発見と活用 | コンピュータ概論 | left-mid: 数理下段行3 vs 情報下段行3 | B y/x separated |
| 10 | 集合と論理 | Webアプリケーション開発4 | left-mid: 数理下段行3 vs 情報下段行3 | B y/x separated |
| 11 | 記号論理 | 機械学習概論 | left-mid: 数理下段行3 vs 情報下段行3 | B y/x separated |
| 12 | 解析学3 | 計算機実験で学ぶ確率とモンテカルロ法 | left-mid: 数理下段行3 vs 情報下段行3 | B y/x separated |
| 13 | 距離空間 | ディープラーニング2 | left-mid: 数理下段行4 vs 情報下段行4 | B y/x separated |
| 14 | 複素解析 | ビッグデータ分析概論 | left-mid: 数理下段行4 vs 情報下段行4 | B y/x separated |
| 15 | 日常に現れる物理学 | R言語プログラミング | left-mid: 数理下段行4 vs 情報下段行4 | B y/x separated |
| 16 | 社会学Ⅰ | 心理学 | right-mid: 社会・ネットワーク vs 文化・思想 foundation row | B x separated |
| 17 | ネット情報発信概論 | デジタル画像技法論Ⅰ（デジタルイラストツール基礎） | connection: 社会接続 upper card grid | B x separated |
| 18 | ネットワーク産業論 | デジタル画像創作論Ⅱ（キャラクターデザイン） | connection: 社会接続 lower card grid | B x separated |

The resulting data contains zero exact duplicate `x|y|width|height` keys. The
Phase 7 stack renderer remains in place for any future source collision; no
stack was used to hide a known distinct PDF position.

## Search and interaction QA

Phase 8 search centering/highlight, selected/all relation modes, keyboard
detail access, ordinary enrollment, drag enrollment, rollback, and the local
preview gate remain unchanged. Phase 9 browser QA records the results in the
release report and stores only application screenshots under
`docs/qa/curriculum-tree-phase9/`; official PDF images are not committed.

## Remaining limitation

The official PDF is an encrypted raster-like source with copy disabled. The
evidence JSON therefore records direct regional crop bounds plus a human-readable
row/column locator, rather than claiming unavailable glyph-level PDF text
rectangles. This is intentional and prevents fabricated precision.
