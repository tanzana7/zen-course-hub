# Curriculum Tree Phase 7 audit

## Scope

Phase 7 keeps the private preview gate and the Phase 6 full-canvas renderer. It
adds a transparent audit record, an access affordance for exact coordinate
collisions, and opt-in display modes for the app's advisory relation lines.
The official PDF remains the visual source; `course-relations.json` is not
treated as an official prerequisite diagram.

## Position audit

- Catalog courses: 275
- Placement entries: 275
- Confirmed before: 275
- Confirmed after: 275
- Demoted: 0
- Coordinate corrections: 0
- PDF-only labels: 3 (kept separate from catalog IDs)
- Full per-course audit: `docs/curriculum-tree-phase7-course-audit.json`

The Phase 6 normalized coordinates were re-read against the 200 DPI regional
renders. No course ID, subject name, or official coordinate was changed in
Phase 7. The audit marks exact shared rectangles as `coordinateVerified: false`
until a future PDF revision or catalog correction distinguishes them.

## Duplicate geometry

The previous “18 slots” are all exact `x/y/width/height` duplicate rectangles
(category B in the requested classification). They are not caused by CSS
scaling or a coordinate rounding pass. They are retained in the JSON because
the source position is not safely separable from the available PDF evidence.

The pairs are:

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

There are no duplicate course IDs. The renderer now creates a vertical,
keyboard-accessible stack for each exact collision and labels each card with
its position in the stack. This changes only the interaction offset; it does
not rewrite the official JSON coordinate.

## Reference relation lines

All 335 relations are preserved. The canvas control now has three modes:

- `OFF` (default): no advisory relation paths are painted.
- `SELECTED`: only paths touching the selected course are painted.
- `ALL`: all 335 advisory paths are painted.

Paths are dashed, muted, behind cards, and `pointer-events: none`. The control
explicitly says that these are app-specific references, not official
prerequisite requirements.

## Operation and storage

Search, focus/detail, normal-enrollment registration, drag registration, and
the existing rollback/localStorage paths remain unchanged. No writes are made
to `completedClasses` or `fourYearSimulatorPlanV1` by the new relation control
or collision stack.

## Browser QA

An isolated headless Chrome/CDP profile was used against the local preview.

- 1440px: 275 nodes, 36 collision cards, and 0 relation paths in OFF mode.
- 1440px: 335 relation paths in ALL mode; 12 paths for a selected course in
  SELECTED mode; course detail opened for a collision card.
- Search moved focus to 数学の方法 and opened its detail panel.
- 390px / 375px: 275 nodes, no document-level horizontal overflow, and no
  structure-bar overflow after the mobile wrapping adjustment.
- The temporary server, Chrome process, profile, and test storage were
  cleaned up after the run.

Screenshots are stored in `docs/qa/curriculum-tree-phase7/`.

## Remaining issues

- The 18 exact rectangle pairs need a future source revision or a manually
  confirmed PDF separation before their JSON coordinates can be corrected.
- The official PDF is not bundled or published.
- This branch remains a private preview; no main merge, main push, or Netlify
  deployment is part of Phase 7.
