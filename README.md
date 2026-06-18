# Game News Hub

大手ゲームメディアの RSS を Cloudflare Worker で集約し、GitHub Pages の静的サイトから最新記事へアクセスしやすくするサイトです。

## 構成

```text
ゲームメディア
  ↓ RSS
Cloudflare Worker
  ↓ JSON API
GitHub Pages
  ↓
あなたのサイト
```

## 収集する RSS

Worker の `FEEDS` で管理しています。初期設定では次の媒体を取得します。

- IGN Japan
- 4Gamer.net
- ファミ通.com
- 電撃オンライン
- GAME Watch
- Game*Spark
- AUTOMATON
- インサイド

RSS を追加・削除する場合は [worker/news-worker.js](worker/news-worker.js) の `FEEDS` を編集してください。

サムネイル画像は RSS 内の `media:thumbnail`、`media:content`、画像 `enclosure`、本文中の最初の `img` から自動で取得します。画像がない記事は、カードから画像枠を非表示にします。

## Cloudflare Worker をデプロイ

1. Cloudflare にログインします。

```bash
npx wrangler login
```

2. Worker をデプロイします。

```bash
npx wrangler deploy
```

3. 表示された Worker URL の末尾に `/news` を付けて、JSON が返ることを確認します。

```bash
curl https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/news
```

## 定期更新

[wrangler.toml](wrangler.toml) では 15 分ごとの Cron Trigger を設定しています。

KV を使うと Cron が取得した記事をキャッシュできます。Cloudflare 側で KV namespace を作成したあと、`wrangler.toml` の `kv_namespaces` コメントを外して `id` を設定してください。

KV を設定しない場合でも、サイトやブラウザが `/news` にアクセスしたタイミングで RSS を取得します。

## GitHub Pages をデプロイ

1. GitHub リポジトリに push します。
2. GitHub の Settings > Pages で Source を `GitHub Actions` にします。
3. `.github/workflows/pages.yml` が静的サイトを GitHub Pages に公開します。

## サイトから Worker を読む

[script.js](script.js) の先頭にある `API_ENDPOINT` を、実際の Worker URL に置き換えます。

```js
const API_ENDPOINT = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/news";
```

置き換え前は、動作確認用のプレビュー記事が表示されます。
