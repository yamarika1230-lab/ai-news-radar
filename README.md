# AI News Radar

AI/テクノロジー関連ニュースを6つのソースから自動収集し、Claude API で日本語に要約・分類してダッシュボードに表示するアプリケーションです。

## 技術スタック

- **フレームワーク**: Next.js 16 (App Router) + TypeScript
- **スタイリング**: Tailwind CSS v4
- **AI 要約**: Claude API (Anthropic SDK / Azure AI 経由)
- **データストレージ**: Vercel KV (ローカル開発時はファイルシステムフォールバック)
- **デプロイ**: Vercel

## 収集ソース

| ソース | API | 内容 |
|---|---|---|
| Hacker News | Firebase API | AI関連トップストーリー |
| Reddit | JSON API | r/MachineLearning, r/LocalLLaMA, r/ClaudeAI 等 |
| Product Hunt | RSS フィード | AI関連プロダクト |
| GitHub Trending | gitterapp API | AI/MLリポジトリ |
| arXiv | Atom API | cs.AI, cs.CL, cs.LG カテゴリの論文 |
| RSS/Blogs | rss-parser | Anthropic, OpenAI, Google AI, Meta AI, Mistral 公式ブログ |

## セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 環境変数の設定

```bash
cp .env.local.example .env.local
```

`.env.local` を開き、以下の値を設定してください:

| 変数 | 必須 | 説明 |
|---|---|---|
| `ANTHROPIC_BASE_URL` | Yes | Azure AI エンドポイント |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API キー |
| `KV_REST_API_URL` | No | Vercel KV の URL (ローカルでは不要) |
| `KV_REST_API_TOKEN` | No | Vercel KV のトークン (ローカルでは不要) |
| `CRON_SECRET` | No | Cron ジョブ認証用シークレット (ローカルでは不要) |

> ローカル開発時に KV 環境変数が未設定の場合、`/tmp/ai-news-data/` にJSONファイルとして保存されます。

### 3. 開発サーバーの起動

```bash
npm run dev
```

http://localhost:3000 でダッシュボードが表示されます。

## データ収集の手動実行

dev サーバーを起動した状態で、別ターミナルから:

```bash
npm run collect
```

このコマンドは以下を実行します:

1. 6つのソースからニュースを並列収集
2. Claude API で日本語要約・カテゴリ分類・スコアリング
3. トレンドキーワードを抽出
4. ストレージに保存

完了後、ブラウザをリロードするとニュースが表示されます。

または curl で直接叩くことも可能です:

```bash
# CRON_SECRET が未設定の場合
curl http://localhost:3000/api/cron/collect

# CRON_SECRET が設定されている場合
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/collect
```

## API エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/news` | 最新のダイジェストを取得 |
| GET | `/api/news?date=2026-04-10` | 指定日のダイジェストを取得 |
| GET | `/api/news?category=llm` | カテゴリでフィルター |
| GET | `/api/cron/collect` | データ収集を実行 (要認証) |

## Vercel へのデプロイ

### 1. Vercel にプロジェクトをインポート

```bash
npx vercel
```

### 2. 環境変数を設定

Vercel ダッシュボードの Settings > Environment Variables で以下を設定:

- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_API_KEY`
- `KV_REST_API_URL` (Vercel KV を作成後に自動設定)
- `KV_REST_API_TOKEN` (Vercel KV を作成後に自動設定)
- `CRON_SECRET` (任意のランダム文字列。`openssl rand -hex 32` で生成)

### 3. Vercel KV の作成

Vercel ダッシュボードの Storage から KV データベースを作成し、プロジェクトに接続してください。
環境変数 `KV_REST_API_URL` と `KV_REST_API_TOKEN` が自動的に設定されます。

### 4. Cron ジョブ

`vercel.json` で毎日 UTC 22:00 (JST 07:00) に自動収集が設定されています:

```json
{
  "crons": [{ "path": "/api/cron/collect", "schedule": "0 22 * * *" }]
}
```

> Vercel Cron は Pro プラン以上で利用可能です。

## プロジェクト構成

```
src/
  app/
    page.tsx                    # ダッシュボード
    archive/page.tsx            # 過去ニュース一覧
    api/
      news/route.ts             # ニュースAPI (CORS対応, 5分キャッシュ)
      cron/collect/route.ts     # 収集Cronエンドポイント
  lib/
    types.ts                    # 型定義
    storage.ts                  # Vercel KV / ファイルシステムストレージ
    summarizer.ts               # Claude API 要約・分類
    collectors/
      utils.ts                  # fetchWithTimeout ユーティリティ
      hackernews.ts             # Hacker News コレクター
      reddit.ts                 # Reddit コレクター
      producthunt.ts            # Product Hunt コレクター
      github-trending.ts        # GitHub Trending コレクター
      arxiv.ts                  # arXiv コレクター
      rss-blogs.ts              # RSS/ブログ コレクター
  components/
    Dashboard.tsx               # メインダッシュボード
    Header.tsx                  # ヘッダー
    Sidebar.tsx                 # サイドバー
    NewsCard.tsx                # ニュースカード (展開/折りたたみ)
    TrendingKeywords.tsx        # トレンドキーワード
    SourceStatus.tsx            # ソースステータス
```
