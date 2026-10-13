# Curriculum Tree Phase 10 — Release QA

## 判定

**READY FOR RELEASE REVIEW**

Phase 10 は `feature/curriculum-tree-redesign` 上の非公開プレビューとして確認した。
main への merge、main push、Netlify への deploy は行っていない。

## 対象と基準資料

- Repository: `C:\Users\user\Desktop\zen-course-hub`
- Branch: `feature/curriculum-tree-redesign`
- QA commit: `adb8e1c202f8ad559606180f3942d364bf81519f`（QA時の変更前）
- Official source: `C:\Users\user\Downloads\curriculumtree2025_260310.pdf`
- Local preview: `http://127.0.0.1:8080/?curriculumPreview=1`
- Browser: Microsoft Edge Headless 155 + Chrome DevTools Protocol、専用一時プロファイル

公式PDFは暗号化・コピー制限付きだったため、テキスト抽出や権限制限の回避は行わず、Popplerでページを画像レンダリングして目視照合した。Phase 9の18組の重複座標証拠（`docs/curriculum-tree-phase9-duplicate-evidence.json`）も併せて再確認した。公式PDF画像そのものはリポジトリへ追加していない。

## 自動テスト・静的検証

| Check | Result |
| --- | --- |
| `node --check app.js` | PASS |
| `node --check graduation-requirements.js` | PASS |
| `node --check simulator-rules.js` | PASS |
| `node --check course-sorting.js` | PASS |
| `node --test` | 133/133 PASS, 0 fail, 0 skip |
| Catalog size | 275 |
| Layout positions | 275/275, unique normalized rectangles |
| Advisory relations | 335, no invalid IDs/self relations/duplicates |
| Relation strengths | existing `strongly_recommended` / `recommended` preserved |
| Existing difficulty data | 104 |
| `git diff --check` | PASS after implementation |

既存の卒業要件・シミュレーター・保存ロールバック・検索/ソート・Q制約テストを含む133件を再実行した。テスト内の意図的な定義未読込ログは既存のfail-closedテストによるもので、テストはPASSしている。

## 実ブラウザQA

専用一時プロファイルでページを開き、終了時に保存データを消去した。生成物は `docs/qa/curriculum-tree-phase10/` に保存した。

| Screenshot | 確認内容 |
| --- | --- |
| `A-1440-overview.png` | 1440px全体表示、公式図を基準にした縦横構図・色帯・275カード |
| `B-1440-zoom100.png` | 100%表示、カード文字・Q表示 |
| `C-1440-search-result.png` | 「数学の方法」の検索、センタリング、詳細表示、ハイライト |
| `D-1440-detail.png` | 科目詳細、難易度出典、関連科目、登録操作 |
| `E-1440-dragging.png` | ドラッグ中の通常履修ドロップパネル |
| `F-1440-enrolled.png` | ドロップ登録後の状態 |
| `G-1440-relations-selected.png` | 選択科目の参考関係線 |
| `H-1440-relations-all.png` | 全参考関係線、データ説明との整合 |
| `I-390-overview.png` | 390pxの全体表示、横overflowなし |
| `J-390-detail.png` | 390px詳細パネル、長い説明とリンクの可読性 |
| `K-390-drawer.png` | 390px通常履修ドロワー、登録済み科目と削除 |
| `L-375-overview.png` | 375px表示、横overflowなし |
| `M-existing-list.png` | 既存Hub一覧 |
| `N-existing-simulator.png` | 既存4年計画シミュレーター |
| `O-existing-graduation.png` | 既存卒業要件分析 |

### 機能結果

- 275カードが描画され、course IDは275件すべて一意だった。
- パン、ホイール/ボタンのズーム、全体表示、100%リセット、探索モードを確認した。
- 検索Enterで対象カードへ移動し、詳細パネルが開いた。キーボードのフォーカス可能なカードは全275件で、`aria-label` と `tabindex` が付いている。
- 参考関係線は初期OFF、SELECTED、ALLを切り替えられた。関係は公式の前提条件ではないことをUIで明示している。
- 科目カードの通常クリックで詳細、ドラッグ開始でドロワー表示、ドロップで `myClasses` に登録された。カードのドラッグ終了後に詳細が誤表示される挙動は確認されなかった。
- ドロワーの削除操作、通常一覧の検索・既存登録表示、シミュレーター、卒業要件分析を確認した。
- 390px、375px、1280pxで `documentElement.scrollWidth === clientWidth`、`body.scrollWidth === clientWidth` を確認した。ページ全体の横スクロールは発生しなかった。
- 公式図の全体表示は小さくなるが、100%リセット、拡大、パンで個別カードを読む設計になっている。375/390pxでも操作用ボタンと詳細パネルはviewport内で操作できた。

### localStorage分離・復元

一時プロファイルに、既知の `completedClasses` と空の `fourYearSimulatorPlanV1` を設定してから、`ITリテラシー`を通常履修へ追加した。

1. 追加後 `myClasses` に保存され、完了済みデータとシミュレーター計画は不変。
2. リロード後もボタンは `履修予定 ✓`、`myClasses` は保持。
3. 「マイ履修」の削除後、リロードしても未登録状態。
4. テスト終了時に一時プロファイルのlocalStorageを消去。

## 公開範囲・安全性

- `curriculum-tree-nav` は localhost/127.0.0.1 かつ `curriculumPreview=1` のときだけ表示される。公開URLで通常ナビへ混入しない既存ゲートを維持。
- PDF・公式ロゴ・公式データの転載ではなく、公式図を参考にした非公式プレビューであることを見出し、キャンバス、フッター、関係線説明に明示。
- 科目名、教員名、URL、関係科目ラベルは既存のエスケープ/URLサニタイズ経路を使用している。Phase 10で新しい外部送信や個人情報保存は追加していない。
- 公式の履修登録・卒業要件の最終確認は大学公式情報で行う旨を既存フッターで確認した。

## Phase 10で修正した不具合

フルスクリーン探索モードで「一覧に戻る」と、`curriculum-tree-explorer-mode` が残り、通常Hubの `body` スクロールがロックされる状態を実ブラウザで再現した。`setMode(false)` で fullscreen state、body class、ボタンのaria状態/文言を同時に戻す7行の後始末を追加した。修正後の再確認では、一覧へ戻った時点で `treeHidden=true`、`treeMode=false`、`explorer=false` となった。

## 既知の deferred note

- 全体表示（約25〜28%）ではカード文字が小さい。これは巨大な公式図を一画面に収めるための仕様で、拡大・検索・100%リセット・パンを用いた探索を前提とする。公開前の別UI変更ではなく、利用者テストで優先度を再評価する。
- 公式PDFは暗号化・コピー制限付きであり、判読不能な文字を推測して追加していない。既存のPhase 9監査で確認できた配置だけを採用している。
- `favicon.ico` 404、既存HubのDOMサイズ/CSP課題は今回のツリー変更で悪化していないため、既存の別課題として扱う。

## リリース判定

機能、保存境界、公開ゲート、モバイルoverflow、既存Hub回帰、公式/非公式表示を確認済み。フルスクリーン終了時のスクロールロック不具合は修正・再検証済み。

**READY FOR RELEASE REVIEW**

mainへのmerge、mainへのpush、NetlifyへのdeployはこのQAでは実施していない。
