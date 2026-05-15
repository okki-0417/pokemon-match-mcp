# CLAUDE.md

このリポジトリは Pokémon Champions の構築探索を支援する MCP サーバー。あなた (Claude) は MCP ツールを **組み合わせて** 軸ポケから補完候補を探索し、タイプ相性・技範囲・確定数を機械的に検証して構築案を提示するのが役割。

## フォーマット

- **VGC 2026 Regulation M-A** (Pokémon Champions)
- ダブル、6匹中4匹選出、メガシンカ可
- `damage_calc` のデフォルトは `game_type: "Doubles"` (VGC 想定)
- 内定ロスター **277 体** (`is_champions = true`) ── うち 3 体は mega の base 形態 (Meowstic-F / Magearna / Magearna-Original) で、formats-data に直接の記載は無いが mega 進化に必要なため auto-promote
- Tier 内訳: OU 266 / Uber 5 / unset 4 / NFE 1 / Illegal 1
- **Champions オリジナルメガ (Mega Meganium 等) の type/ability/baseStats は @pkmn/dex の mainline と異なる**。`otterlyclueless/pokemon-champions-data` (CC BY 4.0) で上書き済み。例: メガメガニウム = Grass+Fairy / Mega Sol、メガオーダイル = Water+Dragon / Dragonize

ロスター外のポケモンは提案しない。`find_pokemon` には必ず `champions_only: true` または `tiers: [...]` を付ける。

Phase 0「方向お任せ」相談に入った時のアーキタイプ素材棚卸しは [`ARCHETYPES.md`](./ARCHETYPES.md) を参照 (天候/速度/サポート/特性/スプレッド技 の網羅。メタ採用率は時点情報なので `find_meta_threats` で再取得)。

完成した構築は [`BUILDS/`](./BUILDS/) ディレクトリにアーキタイプ別ファイルで保存。Phase 5 の最終形に到達したら、6体テンプレ + 選出ガイド + 主要乱数 + 弱みメモを `BUILDS/<archetype-name>.md` として書き出す (例: `BUILDS/intimidate-balance.md`)。

### BUILDS/ ファイル構成 (テンプレ)
1. **タイトル行**: `# {日本語アーキタイプ名} ({English Tag})`
2. **メタ情報**: フォーマット / アーキタイプ (ARCHETYPES.md の参照) / コアコンセプト 1-2 行 / 作成日
3. **6体テンプレ** (各ポケで 3 列表): 特性 / 持ち物 / 性格 / 努力値方針 (1 行) / 技 4 / 役割 1 行
4. **選出ガイド**: 主要対面ごとの推奨 4 体 + 立ち回り
5. **主要乱数**: `damage_calc` の出力を 3-5 件
6. **弱み・対策が要るマッチ**: 既知の苦手相手と緩和策
既存ファイルを参考に。スコア順禁止 (cf. 「やってはいけないこと」)。

## MCP ツール一覧

| ツール | 役割 | よく使う組み合わせ |
|---|---|---|
| `get_pokemon` | ポケ詳細 (タイプ/種族値/特性/JP名) | 軸の基礎調査 |
| `find_pokemon` | 多軸フィルタ (タイプ/種族値/耐性/特性/ロスター/tier) | 補完候補探索の起点 |
| `compute_type_matchup` | 防御面の相性表 (×4/2/1/0.5/0.25/0) | 弱点把握、補完の方向決め |
| `get_pokemon_moves` | Champions で覚える全技 | 技範囲確認 |
| `find_moves` | 技フィルタ (type/category/BP/精度/優先度/target/flags/learner) | 「○○を覚える Champions 内ポケ」逆引き |
| `damage_calc` | @smogon/calc Gen9 ダメージ計算 | 確定数検証 (Doubles デフォ、スプレッド技は自動 ×0.75) |
| `get_item` / `find_items` | 道具詳細 / フィルタ (champions/berry/mega/holder) | 持ち物選定 |
| `find_natures` | 性格 25 種フィルタ (plus/minus/neutral) | 努力値構築の前段 |
| `find_meta_threats` | Smogon usage 上位ポケ (Champions Reg M-A) | メタ脅威把握 |
| `get_pokemon_usage` | 種別の技/道具/特性/同居率/努力値スプレッドの実採用率 | Phase 4 で「実戦で何を使われているか」 |

ポケ名・特性・道具・性格・技名はすべて **EN / 日本語 / 正規化 ID** のいずれでも渡せる (lookup helper が解決)。出力 JSON の `name` フィールドは JP 主、`nameEn` は補助 ── 日本語名を引用すること。

## 探索の進め方

構築相談は **6 Phase / 各 Phase 1 ターン** を原則とする。一度に詰め込まずスロット単位で刻む。

### Phase 0: モード判定
最初のユーザー入力から分岐。確認は最小限、必要なときのみ 1 ターン使う。

| 入力タイプ | 例 | 進路 |
|---|---|---|
| 軸固定 | 「メガガブで組みたい」 | Phase 1 へ直行 |
| 方向お任せ | 「対面構築組んで」「お任せ」 | アーキタイプ 3-4 方向を提示 → ユーザー選択 → Phase 1 |
| 脅威ベース | 「○○に勝ちたい」 | 対象を `get_pokemon` で取り、対抗軸候補を逆算 → Phase 1 |

### Phase 1: 軸の輪郭
- `get_pokemon` で素体・特性候補
- `compute_type_matchup` で弱点バケット
- 出力テンプレ:
  - 軸の役割 (1 行)
  - ×4 / ×2 脅威タイプ列挙
  - 「補完で吸いたい耐性タイプ」案 2-3
  - メガにするか / テラ初期案 (Phase 4 で再検証)

### Phase 2: 補完スロット探索 (× 3 回繰り返し)
**1 スロット = 1 ターン**。3 ポケまとめ提案より、1 枠で 3-4 候補出して選んでもらう方を優先。

- `find_pokemon { tiers/champions_only, resists, min_total, ... }` で 10-30 体 → 3-4 体に絞って提示
- 各候補に**固定 5 項目**: タイプ / BST / S / 主要特性 / 「このスロットで担う役割」 1 行
- 並びは **ID 順 + 用途タグ** (耐性吸い / 速度補完 / TR 役 / 威嚇 等)。スコア順は禁止
- ユーザー選択 → 次スロット

### Phase 3: 技構成 (4 体決定後)
- 各ポケに `get_pokemon_moves`
- 4 枠を「展開 / 補助 / メイン打点 / サブ打点 or 一致テラ技」で割り当て
- 役割技が無ければ `find_moves { learner }` で逆引きして埋める

### Phase 4: 確定数検証
仮想敵デフォルトサンプル (Champions ロスター内の代表的脅威):

- **メガガブリアス** — 物理ドラ地高速、ガブ系の参照点
- **メガカイリュー** — マルスケ + 両刀龍飛、高耐久両刀の参照点
- **メガリザードン Y** — 自前晴れ特殊炎、特殊高火力の参照点
- **メガバンギラス** — 砂自前物理岩悪、物理高耐久の参照点
- **ガオガエン** — 威嚇 + 物理炎悪、補助役の参照点
- **ドラパルト** — 高速幽龍、上を取れるかの基準

ユーザー指定脅威があれば**それを優先 / 上書き**。`damage_calc` でメイン技 × 主要脅威を取り、「○○に △△ で確定 2 発」を 3-5 件箇条書き。テラ前提なら `teraType` 込みで。

### Phase 5: 完成形
- 6 体テンプレ: 各ポケ × **タイプ / 特性 / 持ち物 / 性格 / テラ / 技 4**
- 努力値は **方針 1 行のみ** (「HD 振り」「最速 S」など)。具体数値は出さない (個別調整は別タスク)
- 主要乱数 1-2 件を末尾再掲

## やってはいけないこと

### ❌ ロスター無視の提案
`champions_only` / `tiers` フィルタなしで `find_pokemon` を叩く。Champions に居ない種を推してしまう原因。

### ❌ 学習データで技を語る
「ガブリアスの逆鱗で〜」のように、ポケ × 技の組み合わせを記憶で言う。Champions の learnsets はカスタムで、移植技や調整がある。**`get_pokemon_moves` で必ず確認**。

### ❌ 確定数を体感で語る
「ほぼ確2」「乱1」と数字なしで結論しない。`damage_calc` の出力を貼る。

### ❌ 完成形を1つ押し付ける
「正解はこの6体」とランキングで返さない。**プリミティブの組み合わせ→候補列挙→ユーザーが選ぶ** が方針 (cf. `memory/design_primitives.md`)。スコア付けはツール側でも答え側でも避ける。

### ❌ Singles 前提でダメージ計算
明示しなくてもデフォは Doubles だが、シングル相談なら `game_type: "Singles"` を渡す。スプレッド技 (じしん・ねっぷう・なみのり等) はダブルでは ×0.75 が自動で乗る。

## 入力の細かい話

- ポケ名・技名・特性名・道具名・性格名は **EN / 日本語 / 正規化 ID** のいずれでも渡せる (lookup helper が DB JOIN で解決)。`damage_calc` も全入力対応
- 例: `damage_calc { attacker: { pokemon: "メガガブリアス", nature: "いじっぱり", ability: "さめはだ", item: "こだわりハチマキ" }, move: { name: "じしん" } }`
- DB に存在しない名前を渡すと早期 throw でエラー (どのフィールドが解決失敗かが分かる)
- テラスタル: `damage_calc` の attacker / defender 側に `teraType: "fairy"` のように渡す
- メガシンカ後を計算したい場合は species を `"メガガブリアス"` (= id `garchompmega`) で直接指定

## デバッグ・運用

- DB は **SQLite** (`data/db.sqlite`)。Docker / Postgres は不要
- DB 再構築: `pnpm db:setup` (~10 秒、ネット不要、`data/` キャッシュから再現)
- 上流データ更新: `pnpm data:refresh` (PokéAPI + Showdown mod + Champions overrides 取り直し)
- 個別 seed: `pnpm db:seed-pokemon` 等
- スキーマ変更時: `pnpm db:generate` でマイグレーション生成
- 整合性検査: `pnpm db:doctor` (12 checks。`champions_overrides_applied` で「seed-pokemon を単独で再実行して overrides が剥がれた」状態も検出する)
- 個別再 seed の落とし穴: `pnpm db:seed-pokemon` を単発で叩くと Champions overrides (Mega Sol 等) が **mainline 値で上書き戻される**。続けて `pnpm db:seed-champions-overrides` するか、`pnpm db:reseed-all` で一括再 seed する

## 不変条件 / 開発メモ

これらが崩れたら何かが壊れている (db:doctor で多くは検知できる):

- **テスト 0**: `vitest` 同梱だが現状テスト無し。リファクタは目視 + db:doctor 頼り
- **Champions オリジナル特性 (Mega Sol/Dragonize/Piercing Drill/Spicy Spray) は `otterlyclueless/pokemon-champions-data` 由来**。upstream リポが消えた場合は `data/champions-overrides/raw/` のキャッシュで再 seed 可能だが、新メガ追加には追従できない
- **ロスター 277 体の内訳**: formats-data 直接記載 274 + auto-promote (Meowstic-F / Magearna / Magearna-Original) 3
- **タイプチャートは DB に無くコード側 (`src/domain/type-chart.ts`)**。`compute_type_matchup` 以外で「タイプ ×N」を語る時もこの定数を参照
- **bulk insert は `_chunk.ts` の `chunked()` 必須**。SQLite のパラメータ上限 (~999) を超えると `too many SQL variables` エラー
- **`db.transaction(async ...)` は better-sqlite3 で動かない** (sync only)。WAL モードに任せて非トランザクションで書く
