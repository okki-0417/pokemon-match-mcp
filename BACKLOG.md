# Data & Tooling Backlog

ポケモンデータ収集の現状棚卸しと、未着手タスク。優先順は「低コスト × 高レバレッジ」。

最終更新: 2026-05-14。実装が進んだら本ファイルを更新。

## ✅ 完了 (現状の到達点)

### データ
- `pokemon` 1414 (Champions 内定 274、tier OU/Uber/NFE 設定済み)
  - **+ weightkg / gen / dex_num / base_species / forme / prevo / evos / other_formes / is_mega / is_primal / egg_groups / gender_ratio / tier / doubles_tier / nat_dex_tier / tags**
- `abilities` 310 (EN+JP+短説明、ポケ-特性中間 3101)
  - **+ flags (breakable 等) / desc_long**
- `moves` 887 (EN+JP+type/category/BP/accuracy/PP/priority + target/flags/secondaries)
  - **+ crit_ratio / multihit / drain / recoil / heal / self_switch / volatile_status / ignore_ability / ignore_immunity / non_ghost_target / desc_long**
- `learnsets` 16,892 (Champions 274 体すべてに付与、Gourgeist サイズ違いの fallback 修正済)
- `natures` 25 (EN+JP+plus/minus)
- `items` 580 (Champions 117、`mega_stone`/`fling`/`natural_gift`/`item_user`/`on_memory` + **desc_long** 含む)
- `usage_stats` 263 行 (gen9championsvgc2026regma / 2026-04 / elo 1500 のスナップショット)

### MCP ツール (12 本)
get_pokemon / find_pokemon / compute_type_matchup / get_pokemon_moves / find_moves / damage_calc / get_item / find_items / find_natures / find_meta_threats / get_pokemon_usage / ping

---

## 🟢 B. 完了 (2026-05-14)

すべて済。pokemon に 14 列、moves に 11 列、abilities に 2 列、items に 1 列を追加。詳細は git log および drizzle/0010〜0012 マイグレーション参照。`heightm` は @pkmn/dex に存在しないためドロップ。

---

## 🟡 D. 多言語完全化 (PokéAPI から低コスト追加可)

PokéAPI からは name のみ取得済み。`flavor_text_entries` で description (ja-Hrkt) も取れる。

| 領域 | 現状 | 追加 |
|---|---|---|
| `moves.desc_ja` | EN のみ | JP description |
| `abilities.desc_ja` | EN のみ | JP description |
| `items.desc_ja` | EN のみ | JP description |
| `pokemon.dex_entry_ja` | name のみ | 図鑑説明文 (フレーバー) |

`fetch-jp-names.ts` の拡張で 1 ETL 追加。

---

## 🟠 E. 採用率の時系列・横断拡充 (運用)

| 項目 | 現状 | 追加 |
|---|---|---|
| 過去月の採用率 | 2026-04 のみ | 過去 6-12 ヶ月の一括取込 |
| 月次更新の自動化 | 手動 | cron / GitHub Actions (毎月 5 日頃) |
| Elo cut バリエーション | 1500 のみ | 0 / 1630 / 1760 |
| Bo3 / BSS / OU 形式 | 未取込 | `gen9championsvgc2026regmabo3-*`, `gen9championsbssregma-*`, `gen9championsou-*` |

---

## 🔴 C. 構造化が重い (Showdown に "意味" として存在しない、設計議論が必要)

着手前にスキーマ設計の合意が必要。データ収集ではなく設計フェーズ。

| 項目 | 現状 | メモ |
|---|---|---|
| 特性効果の構造化 | コード側 (`ABILITY_TYPE_MULTIPLIER` 約 15 件) | 浮遊→地面 ×0、もらいび→炎 ×0 で攻撃 ↑ 等。`ability_effects` テーブル設計が必要 |
| 道具効果の構造化 | description 文字列のみ | タイプ強化 (もくたん +20%)、こだわり (A1.5x)、半減実、弱保 — カテゴリ + 数値の正規化 |
| 役割タグ (起点作成/崩し/受け/抜き/場作り) | 無し | CLAUDE.md "オープン論点" に既出。手動キュレーション or LLM 自動分類 |
| Champions ルール (メガ枠 1 体、特殊 clause) | 暗黙 | 仕様調査 + 手動構造化 |
| Champions 禁止技/特性リスト | 暗黙 | Showdown mod から取れる可能性、要調査 |

---

## ⚠ 既知の上流データギャップ (`db:doctor` 警告)

- ~~**Champions オリジナル特性 4 件**~~ ✅ 解決済 (otterlyclueless 取込で seed)
- **Pikachu-Starter**: Light Ball.itemUser に含まれるが @pkmn/dex 未収録。Let's Go Pikachu の専用形態でコスメ的、対戦には影響なし
- **chaos JSON の空キー** (1 move + 1 teammate): Smogon の元 JSON にある "no item" / "no slot" のプレースホルダー。実害なし

## 🔄 Champions オリジナル species データ取込 (新規)

`otterlyclueless/pokemon-champions-data` (CC BY 4.0) を取り込み、Champions メガの type/ability/baseStats を mainline @pkmn/dex 値の上に上書き。

- 共通内部型 `ChampionsOverride` / `ChampionsAbility` / `ChampionsSource` interface 定義 (`src/etl/sources/types.ts`)
- 第一実装: `otterlycluelessSource` (`src/etl/sources/otterlyclueless.ts`)
- 取込: `pnpm data:fetch-champions-overrides` → `data/champions-overrides/raw/`
- 適用: `pnpm db:seed-champions-overrides` (`db:setup` 末尾に統合済)

**カバー範囲**: 60 mega + 一部 base 形態 = 259 上書き。新特性 4 件 (Mega Sol/Dragonize/Piercing Drill/Spicy Spray) は手動 JP 名マップ付きで abilities テーブルに INSERT。

**ソース切替の余地**: `ChampionsSource` インターフェース実装を差し替えれば yakkun / Showdown 直 / 手書き JSON に変更可能。

## ⚪ F. 保留 (フェーズ2)

- 棋譜 (Showdown replay) のスキーマ + ETL
- 対戦中アドバイザー用データ (盤面状態履歴)
- pgvector を使った類似ポケ/類似構築検索

---

## 推奨着手順

1. ~~**B**~~ ✅ 完了 (2026-05-14)
2. **D** (JP description 拡張) — 1 ETL 追加。「英語名がわかりにくい」課題に直結
3. **E** (採用率の月次蓄積) — fetch script を多月対応化、cron 整備
4. **C** (item effects 構造化) — ハイブリッド方針で 25-26 列 + jsonb (BACKLOG 上に試算あり)。117 Champions アイテム × 平均 2-3 効果のセル埋めが本体作業
5. **F** (棋譜) — 必要になってから

## C. 詳細設計案 (item effects 構造化)

ユーザー提案「全パラメータをカラム化」に対し、ハイブリッド推奨。

**ステータス系 (フラット 9 列):** atk_mult, def_mult, spa_mult, spd_mult, spe_mult, hp_mult, accuracy_mult, evasion_mult, crit_rate_boost

**行動タイミング系 (フラット 4 列):** priority_mod, locks_to_first_move, forces_switch_holder, forces_switch_target

**特殊系 (個別フラット 9 列):** end_of_turn_heal_frac, end_of_turn_damage_frac, contact_damage_frac, causes_self_status, hp_threshold_trigger, hp_heal_on_trigger_frac, boosts_on_trigger (jsonb), single_use, removed_on_use

**型依存・条件 (jsonb 必須 2 列):** type_modifiers (例: もくたん→{"fire":1.2})、trigger_condition (例: Sitrus→{"hp_lte":0.5})

合計 25-26 列。Showdown には数値構造化されておらずコード関数で埋まっているため、**手動マッピング または LLM 初稿 → レビュー** が必要。117 Champions × 平均 2-3 効果 = 300-400 セル。
