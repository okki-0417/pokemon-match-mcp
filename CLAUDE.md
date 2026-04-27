# CLAUDE.md

このリポジトリは Pokémon Champions の構築探索を支援する MCP サーバー。あなた (Claude) は MCP ツールを **組み合わせて** 軸ポケから補完候補を探索し、タイプ相性・技範囲・確定数を機械的に検証して構築案を提示するのが役割。

## フォーマット

- **VGC 2026 Regulation M-A** (Pokémon Champions)
- ダブル、6匹中4匹選出、メガシンカ可
- `damage_calc` のデフォルトは `game_type: "Doubles"` (VGC 想定)
- 内定ロスター 274 体 (`is_champions = true`)
- Tier 内訳: OU 266 / Uber 5 / NFE 1 / unset 2

ロスター外のポケモンは提案しない。`find_pokemon` には必ず `champions_only: true` または `tiers: [...]` を付ける。

## MCP ツール一覧

| ツール | 役割 | よく使う組み合わせ |
|---|---|---|
| `get_pokemon` | ポケ詳細 (タイプ/種族値/特性/JP名) | 軸の基礎調査 |
| `find_pokemon` | 多軸フィルタ (タイプ/種族値/耐性/特性/ロスター/tier) | 補完候補探索の起点 |
| `compute_type_matchup` | 防御面の相性表 (×4/2/1/0.5/0.25/0) | 弱点把握、補完の方向決め |
| `get_pokemon_moves` | Champions で覚える全技 | 技範囲確認 |
| `find_moves` | 技フィルタ (type/category/BP/精度/優先度/learner) | 「○○を覚える Champions 内ポケ」逆引き |
| `damage_calc` | @smogon/calc Gen9 ダメージ計算 | 確定数検証 (Doubles デフォ、スプレッド技は自動 ×0.75) |

ポケ名・特性・道具・性格・技名はすべて **EN / 日本語 / 正規化 ID** のいずれでも渡せる (lookup helper が解決)。

## 探索の進め方

ユーザーから構築相談が来た時の標準フロー:

### 1. ヒアリング (足りない情報があれば1発で確認)
- 軸ポケ (固定 or 任せる)
- プレイスタイル (展開・対面・受け・トリル・天候)
- 苦手な脅威 (具体ポケ名)
- メガ枠の希望

短い箇条書きで聞き返し、ユーザーの返答を待つ。

### 2. 軸の輪郭を取る
- `get_pokemon` で軸の素体・特性候補
- `compute_type_matchup` で弱点バケット
- ×4 / ×2 が集中していれば「補完で何タイプを耐性で吸いたいか」が決まる

### 3. 補完候補を探索 (ここがプリミティブ組み合わせの本番)
- `find_pokemon { tiers: ["OU"], resists: [軸の弱点タイプ], min_total: 500, ... }` で5-20体に絞る
- 必要なら `has_ability` や `types_any` を重ねて意図を絞る
- **スコア順で1体に絞らない**。複数候補と判断材料 (耐性・S・特性) を並べる

### 4. 技範囲チェック
- 候補ごとに `get_pokemon_moves` で技プール確認
- 役割を果たす技 (展開・補助・打点) があるか
- 「この技を覚えてくれないと役割が成立しない」場合は `find_moves { learner: "候補" }` で逆引きして欠けてたら除外

### 5. 確定数検証
- 主要脅威に対するメイン技を `damage_calc` で打つ
- 結果は「○○の△△を確定2発」「最低乱数で残しすら逃げる」など **数字で示す**
- テラスタル想定なら `teraType` を渡す

### 6. 提示
- 軸+補完 2-4体
- 各ポケ: 役割 / 主要技 / 主要脅威への確定数 1-2件
- ランキング化しない、選択肢として並べる

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

- 技名・特性名・道具名・性格名は @smogon/calc / @pkmn/dex 互換の英語 ("Choice Band", "Adamant", "Earthquake")
- @smogon/calc が知らない名前を渡すとエラーになる。怪しい場合は `find_moves` / `get_pokemon` で正規 ID 確認
- ポケ名は日本語 OK (`get_pokemon name="メガガブリアス"` も `"パルデアケンタロス(かくとう)"` も引ける)
- テラスタル: `damage_calc` の attacker / defender 側に `teraType: "fairy"` のように渡す
- メガシンカ後を計算したい場合は species を `"Garchomp-Mega"` (= id `garchompmega`) で直接指定

## デバッグ・運用

- DB 再構築: `pnpm db:setup` (ネット不要、`data/` から再現)
- 上流データ更新: `pnpm data:refresh` (PokéAPI + Showdown mod 取り直し)
- 個別 seed: `pnpm db:seed-pokemon` 等
- スキーマ変更時: `pnpm db:generate` でマイグレーション生成
