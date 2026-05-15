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

## DB スキーマ概要

- `pokemon` — ベース層(普遍的なポケモンデータ)
- `moves`, `abilities`, `items` — マスター
- `learnsets` — `(pokemon, move, series_version)`
- `series_metadata` — シリーズ固有(Champions内定可否・メガ可否、`series_version` でバージョン管理し差分追加に対応)
- `usage_stats` — `(format, month, pokemon)` 採用率・テラスタル傾向(Champions では非該当)・技採用率・組合せ統計
- `replays` (フェーズ2) — Showdown replay の正規化形

## MCP ツール一覧 (案)

### 検索 / フィルタ
- `find_pokemon(filters)` — タイプ耐性・タイプ無効・素早さ帯・覚える技・役割などの多軸絞り込み
- `find_moves(filters)` — BP/タイプ/効果/覚えるポケモン/採用率(`neglected=true` で埋もれた強技発掘)
- `find_complementary_partners(pokemon, n)` — 弱点を耐性で補う候補をスコア順

### 評価 / 計算
- `analyze_team_coverage(team)` — 攻撃面/防御面のタイプ穴を数値で
- `analyze_role_balance(team)` — 起点作成・崩し・受け・抜き・場作りの充足度
- `damage_calc(attacker, defender, move, conditions)` — `@smogon/calc` ラッパー、確定数を返す
- `speed_tier_analysis(team, meta_threats)` — メタ脅威に対する抜ける/抜かれる関係表
- `evaluate_team(team)` — 上記の総合スコア

### メタ参照
- `get_meta_threats(format, top_n)` — 対策必須ポケモン上位(対策フェーズで使う)
- `get_common_teammates(pokemon)` — 同居率の高いポケモン(参考情報)

### 取得 (lookup)
- `get_pokemon(name)`, `get_move(name)`, `get_ability(name)`, `get_item(name)`

## マイルストーン

- **M1** リポジトリ初期化、SQLite (better-sqlite3)、DB スキーマ、ETL スケルトン
- **M2** ベースデータ + Champions 差分の取り込み完了
- **M3** MCP サーバー基盤、`get_*` / `find_pokemon` / `damage_calc` 実装
- **M4** 評価系ツール(`analyze_team_coverage`, `analyze_role_balance`, `evaluate_team` 等)
- **M5** Claude Code から実用、`CLAUDE.md` と Skills で探索プロセスを誘導
- **M6** usage stats 取り込み、メタ参照ツール、`find_moves(neglected=true)` の実装
- **M7 (フェーズ2)** 棋譜取り込み、対戦中アドバイザーツール

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

- **探索の深さ**: Claude Code の agentic ループで「浅い提案で終わる」現象が頻発する場合、`CLAUDE.md` の指示強化で対応するか、専用エージェント層 (L2) を後付けするかを判断する
- **メタデータの更新運用**: Showdown 側の Champions mod 構造が安定してくるまで、ETL 側のスキーマ追従コストを観察する必要がある
- **役割タグの付与**: 「起点作成」「崩し」「受け」等の役割は Showdown データには無いため、Smogon フォーラムの分析記事や手動キュレーションで補う必要がある(自動分類できる部分は速度・耐久・技構成から推定する余地あり)
