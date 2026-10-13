# Curriculum Tree Phase 8 audit

## Scope

- Private preview only (`curriculumPreview=1` on localhost).
- Official source: `curriculumtree2025_260310.pdf`; the PDF is not shipped.
- Catalog and layout are compared by existing course IDs; no subject ID is invented.

## PDF review method

- The encrypted, copy-restricted PDF was rendered as a 72dpi overview and a 200dpi full-page raster with Poppler; the duplicate slots were inspected at the corresponding page regions. No password bypass, text extraction, or source coordinate guessing was used.
- Each exact duplicate rectangle was rechecked as a raster slot. Where the raster did not uniquely assign a second normalized rectangle, the coordinates were preserved and the renderer exposes a keyboard-accessible stack.
- The audit is intentionally conservative: `coordinateCorrections: 0`, `demotedEntries: 0`.

## Position totals

- Catalog courses: 275
- Placement entries: 275
- Confirmed before / after: 275 / 275
- Exact duplicate slots / entries: 18 / 36
- Provisional entries: 0

## Exact duplicate slot audit

All 18 pairs below were inspected against the rendered PDF regions. The raster does not provide a safe, unique normalized rectangle for either member in these slots; moving one would be an invented correction. JSON coordinates remain unchanged. The renderer offsets only the interaction stack, never the source coordinate.

1. 数学の方法 / インターネット概論
2. 逆さ科学史 / プロジェクトマネジメント概論
3. 初等代数概論 / Webアプリケーション開発3
4. 線形代数1 / Linux概論
5. 線形代数2 / オブジェクト指向プログラミング
6. 解析学1 / コンピューターサイエンス概論
7. 解析学2 / JavaScriptによる自動化、効率化
8. グラフ理論 / 情報処理概論
9. 数理構造の発見と活用 / コンピュータ概論
10. 集合と論理 / Webアプリケーション開発4
11. 記号論理 / 機械学習概論
12. 解析学3 / 計算機実験で学ぶ確率とモンテカルロ法
13. 距離空間 / ディープラーニング2
14. 複素解析 / ビッグデータ分析概論
15. 日常に現れる物理学 / R言語プログラミング
16. 社会学Ⅰ / 心理学
17. ネット情報発信概論 / デジタル画像技法論Ⅰ（デジタルイラストツール基礎）
18. ネットワーク産業論 / デジタル画像創作論Ⅱ（キャラクターデザイン）

Result for every pair: `unresolved exact-normalized-slot`, `coordinateAction=preserved`, `accessibleStack=true`.

## Remaining stacks

- 18 exact normalized slots remain, containing 36 courses.
- Each stack is labeled `同一座標` and exposes an accessible position `n/m`.
- No duplicate course IDs exist; all 275 placement IDs resolve to `courses.json`.

## Navigation changes

- Search Enter is the only action that auto-centers and zooms. It clamps to 100–150%, centers the match in the visible graph area, and adds a short highlight. Reduced-motion users receive a static highlight and shorter timeout.
- Card click, pan, wheel/pinch zoom, reset/fit, drawer toggle, and relation mode changes do not auto-zoom.
- SELECTED relation mode keeps unrelated cards readable (~78% opacity); only relation edges are strongly muted.
- Relation lines remain OFF by default, with SELECTED/ALL opt-in, dashed muted paths, pointer-events disabled, and an explicit app-specific note.

## Storage and regression

- `myClasses`, `completedClasses`, `fourYearSimulatorPlanV1`, and rollback/localStorage paths are unchanged.
- Public navigation remains hidden outside localhost preview.

## Browser QA

Recorded by isolated Chrome/CDP against the local preview; screenshots are stored under `docs/qa/curriculum-tree-phase8/`.

| Capture | Viewport | Checks |
|---|---:|---|
| A overview | 1440px | 275 nodes, OFF mode |
| B search zoom | 1440px | Enter centers a result at readable zoom and highlights it |
| C selected readability | 1440px | unrelated nodes remain readable; selected relations visible |
| D all relations | 1440px | 335 dashed advisory paths |
| E duplicate stack | 1440px | duplicate slot remains accessible without coordinate rewrite |
| F detail | 1440px | detail opens from a course card |
| G drawer | 1440px | normal enrollment drawer opens and remains usable |
| H search | 390px | search/center action works without page overflow |
| I overview | 375px | no page-level horizontal overflow |

## Remaining issues

- The 18 duplicate rectangles require a future source revision or manually supplied unambiguous source coordinates before they can be split in JSON.
- The official PDF is not bundled or published.
- The curriculum tree remains a private preview and is not merged to main or deployed.
