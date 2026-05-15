# pokemon-match-mcp

Pokémon Champions 対戦支援のための MCP サーバー。AI が一次原理(タイプ相性・技範囲・確定数)から構築を探索・評価できるようにするドメインツール群を提供する。

## 目的

「採用率の高い構築を真似る」のではなく、**AIが探索・検証・反復するためのツール**を整える。採用率は補助情報(メタ脅威の認識・埋もれた強技の発掘)として扱い、判断の主軸はタイプ相性・役割充足度・確定数といった機械的に検証可能な指標に置く。

AI クライアントは Claude Code を当面の主とし、MCPプロトコルの上に構築することで Claude Desktop / Cline / ローカル LLM など他クライアントへ差し替え可能にする。

## スコープ

### MVP (フェーズ1): 構築アドバイザー

- 対象フォーマット: **VGC 2026 Regulation M-A** (Pokémon Champions, ダブル, 6匹中4匹選出, メガ可)
- 想定UX: Claude Code との対話。軸ポケモン・プレイスタイル・苦手な脅威をヒアリング → ツールで候補を絞る/評価する/確定数を検証する を反復 → 構築案と選定理由を提示
- AIに「探索」をさせる前提で、フィルタ系・スコア系のツールを充実させる

### フェーズ2 (後追い): 対戦中アドバイザー

- 盤面状態(HP・状態異常・ランク補正・見せ合い情報)を入力に、行動候補を期待値ベースで評価
- 棋譜(Showdown replay)を活用した類似局面参照

### スコープ外

- 自動対戦ボット(対戦の勝率最適化が目的なら検索ベースの実装が筋、本プロジェクトとは別物)
- Web/モバイルUI(MCPクライアントを介して使う)
- Champions OU (6v6シングル) — スキーマで吸収できるようにはするが MVP では非対応

## アーキテクチャ

```
[Claude Code] ──MCP──> [MCP サーバー (TypeScript)] ──> [SQLite (data/db.sqlite)]
                              ↑
                              └── ETL バッチ ── @pkmn/data
                                              smogon/pokemon-showdown
                                              Smogon usage stats
                                              otterlyclueless/pokemon-champions-data
```

- **L1 (本リポジトリ): MCP サーバー** — ステートレス RPC、データアクセス・計算・スコアリングのみ
- **L2: エージェントループ** — Claude Code の agentic 挙動 + `CLAUDE.md` / Skills で吸収。当面は専用実装なし
- **DB**: ローカル SQLite (`better-sqlite3` 経由、`data/db.sqlite` 単一ファイル)。個人利用・単一プロセス・読み専で十分
- **ETL**: 公式・Showdown・Smogon・コミュニティデータの取り込み

### 設計指針: ドメインロジックは MCP、エルゴノミクスは Claude Code

- ドメイン知識・計算・データアクセスは MCP サーバーに集約(再利用可能・クライアント非依存)
- 対話プロセスや探索フローは `CLAUDE.md` / Skills に文章で記述(クライアント移行時もコピペ・書き直しで対応可能)
- MCPツールの粒度は「意味的に完結した入出力」を保つ。LLM のレスポンス文体に依存させない

## データソース

データは「実行時にライブラリとして呼ぶもの」と「ETLでDBに取り込むもの」を明確に分ける。

### 実行時ライブラリ (DBに入れない)

| 用途 | ライブラリ | 理由 |
|---|---|---|
| ダメージ計算 | `@smogon/calc` | 計算式・特性・アイテム・天候等の網羅実装。自前実装は禁忌 |
| ETL時のデータ正規化・バリデーション | `@pkmn/data` | Showdownデータを型付きで扱うためETLパイプライン内でのみ使用 |

### DBに取り込むデータ

| 層 | 内容 | ソース | 取り込み頻度 |
|---|---|---|---|
| ベース | 種族値・技・タイプ・特性・アイテム | `@pkmn/data` / `smogon/pokemon-showdown` | 週次 |
| シリーズメタ | Champions 内定・許可技・メガ可否 | `smogon/pokemon-showdown` Champions mod | 週次(数ヶ月ごとの参戦追加に追従) |
| 学習技 | `(pokemon, move, series_version)` の関係 | `@pkmn/data` | 週次 |
| 採用率・組合せ | フォーマット別 usage stats | Smogon usage stats (`gen9champions*`) | 月次 |
| 棋譜 (フェーズ2) | 対戦ログ | Showdown replay API | 都度 |

### 設計判断: なぜハイブリッドか

- **多軸フィルタとJOIN**(「採用率5%未満で鋼に抜群を取れる威力90以上の技を覚える素早さ100以上のポケモン」のような検索)はDBが圧倒的に得意
- 採用率データはライブラリに存在しないためETLは必須 → ベースデータも同じDBに入れた方がJOINが自然で一貫性がある
- 計算ロジックは Showdown と同じ実装を共有したいので、計算系はライブラリ呼び出しに統一

公式サイトの直接スクレイピングは原則行わない(Showdown が一次に近い形で取り込み済みのため)。

### Champions オリジナル species データのソース

Champions オリジナル メガ進化 (e.g. Mega Meganium with Mega Sol、Mega Excadrill with Piercing Drill) は @pkmn/dex に反映されておらず、type/ability/baseStats が mainline と異なる。これを補うため、コミュニティ管理のオープンデータセットを取り込む:

- ソース: [`otterlyclueless/pokemon-champions-data`](https://github.com/otterlyclueless/pokemon-champions-data) (CC BY 4.0)
- 取込: `pnpm data:fetch-champions-overrides` → `data/champions-overrides/raw/`
- 適用: `pnpm db:seed-champions-overrides` (Champions 値で上書き)

ソース切替を将来できるよう、共通インターフェース `ChampionsSource` (`src/etl/sources/types.ts`) を経由する。新ソース追加時は同インターフェースを実装するだけ。

## DB スキーマ概要 (SQLite)

| テーブル | 行数 | 主な列 |
|---|---:|---|
| `pokemon` | 1,414 (Champions 277) | type1/2 / 種族値 / abilities (中間) / weightkg / gen / dex_num / forme 関係 (base_species, prevo, evos, other_formes, is_mega, is_primal) / Smogon tier 系 / tags |
| `pokemon_abilities` | 3,101 | (pokemon_id, ability_id) + slot (primary/secondary/hidden) |
| `abilities` | 314 | EN/JP 名 / desc / desc_long / flags (breakable 等) |
| `moves` | 887 | type / category / BP / accuracy / PP / priority / target / flags / secondaries / crit_ratio / multihit / drain / recoil / heal / self_switch / volatile_status / ignore_ability / ignore_immunity |
| `learnsets` | 17,084 | (pokemon_id, move_id) + sources (`9L13` / `9M` 等) |
| `natures` | 25 | EN/JP 名 / plus / minus stat |
| `items` | 580 (Champions 117) | desc / is_champions / is_berry / mega_stone (jsonb) / fling / natural_gift / item_user / on_memory |
| `usage_stats` | 263 | (format, year_month, elo_cutoff, pokemon_id) + usage_pct / raw_count / moves/items/abilities/teammates/spreads (各 jsonb) |

JSON 列は better-sqlite3 + Drizzle が JS 側で自動 parse / stringify。タイプチャートは `src/domain/type-chart.ts` (DB 化せずコード側固定)。

## MCP ツール一覧 (12 本)

| ツール | 役割 |
|---|---|
| `ping` | ヘルスチェック + データソース帰属表記 |
| `get_pokemon` | 種族詳細 (タイプ・種族値・特性 slot 付き) |
| `find_pokemon` | 多軸フィルタ (タイプ/耐性/種族値範囲/特性/Champions/tier) |
| `compute_type_matchup` | 防御面相性表 (×4/2/1/0.5/0.25/0、特性無効化対応) |
| `get_pokemon_moves` | Champions で覚える全技 |
| `find_moves` | 技フィルタ (type/category/BP/精度/優先度/target/flags/learner) |
| `damage_calc` | @smogon/calc Gen 9。Doubles 既定、スプレッド技自動 ×0.75 |
| `get_item` / `find_items` | 持ち物詳細 / フィルタ (champions/berry/mega/holder/memory) |
| `find_natures` | 性格 25 種フィルタ |
| `find_meta_threats` | Smogon usage 上位ポケ |
| `get_pokemon_usage` | 種別の実採用 (技/道具/特性/同居率/努力値スプレッド) |

入出力ともポケ名・技名・特性・道具・性格は **EN / 日本語 / 正規化 ID** どれでも受け付け。出力 JSON の `name` は JP 主、`nameEn` 補助。

設計指針 (cf. `memory/design_primitives.md`): **総合スコア / ランキングを返すツールは作らない**。プリミティブを AI が組み合わせて探索する方式。

## マイルストーン

- **M1** ✅ リポジトリ初期化、SQLite (better-sqlite3)、DB スキーマ、ETL スケルトン
- **M2** ✅ ベースデータ + Champions 差分の取り込み (Smogon mod + @pkmn/dex)
- **M3** ✅ MCP サーバー基盤、12 ツール実装
- **M4** ✅ Champions オリジナルメガの type/ability/baseStats overrides (otterlyclueless 取込)
- **M5** ✅ Claude Code 実用、`CLAUDE.md` + `ARCHETYPES.md` + `BUILDS/` で探索プロセス誘導
- **M6** ✅ Smogon usage stats 取込、`find_meta_threats` / `get_pokemon_usage`
- **M7** ✅ 整合性検査 `db:doctor` (12 checks)
- **M8 (将来)** テスト基盤・item effects 構造化・採用率時系列拡充 → `BACKLOG.md`
- **M9 (フェーズ2)** 棋譜取り込み、対戦中アドバイザーツール

## 技術スタック

- 言語: **TypeScript** (`@smogon/calc` / `@pkmn/data` のエコシステム前提)
- ランタイム: Node.js
- DB: **SQLite (better-sqlite3)** ── 単一プロセス・読み専・小規模個人利用に最適
- MCP SDK: `@modelcontextprotocol/sdk`
- ETL: TypeScript スクリプト

## セットアップ

```bash
pnpm install
pnpm db:setup        # ~10 秒で data/db.sqlite を再構築 (Smogon 採用率はキャッシュがあれば自動反映)

# MCPサーバ起動確認(JSON-RPC スモークテスト)
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ping","arguments":{}}}' | pnpm tsx src/server.ts
```


### Claude Code から使う

プロジェクト直下の `.mcp.json` で `pokemon-match` サーバが登録されている。Claude Code をプロジェクトディレクトリで起動すれば自動接続され、`ping` ツールが利用可能になる。

## オープンな論点

- **テスト基盤**: vitest 同梱だが現状テスト 0。`type-chart.ts` / `lookup.ts` / `seed-learnsets.ts:resolveLearnset` は単体テストの第一候補
- **役割タグの付与**: 「起点作成」「崩し」「受け」等は Showdown / otterlyclueless にも無い。手動キュレーション or LLM 自動分類が必要 (cf. BACKLOG C)
- **採用率の時系列**: 現状 1 スナップショット (2026-04 / elo 1500)。月次蓄積 + cron 化は未着手 (cf. BACKLOG E)
- **Champions オリジナル species の上流追従**: `otterlyclueless/pokemon-champions-data` は ★少のコミュニティ管理リポ。新メガ追加で更新が止まったら代替ソース調査が必要 (`ChampionsSource` interface で差替可)
- **メガ枠制約のデータ化**: Champions の「1 体までメガ進化可」ルールは現在データ未表現。AI 側のマナー任せ
