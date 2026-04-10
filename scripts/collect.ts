/**
 * ローカル開発用: データ収集を手動実行するスクリプト
 *
 * 使い方:
 *   npm run collect
 *
 * .env.local の ANTHROPIC_API_KEY が必要です。
 * KV_REST_API_URL が未設定の場合、/tmp/ai-news-data/ にファイル保存されます。
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET;

async function main() {
  console.log("=== AI News Radar: 手動データ収集 ===\n");
  console.log(`エンドポイント: ${BASE_URL}/api/cron/collect`);

  const headers: Record<string, string> = {};
  if (CRON_SECRET) {
    headers["Authorization"] = `Bearer ${CRON_SECRET}`;
    console.log("認証: CRON_SECRET を使用");
  } else {
    console.log("認証: CRON_SECRET 未設定（スキップ）");
  }

  console.log("\n収集開始...\n");

  try {
    const res = await fetch(`${BASE_URL}/api/cron/collect`, { headers });

    if (!res.ok) {
      console.error(`HTTP ${res.status}: ${res.statusText}`);
      const body = await res.text();
      console.error(body);
      process.exit(1);
    }

    const data = await res.json();

    console.log("完了!\n");
    console.log(`日付:       ${data.date}`);
    console.log(`処理時間:   ${data.elapsedSeconds}秒`);
    console.log(`収集件数:   ${data.collected?.raw ?? "N/A"}件 (生)`);
    console.log(`重複除去後: ${data.collected?.unique ?? "N/A"}件`);
    console.log(`処理済み:   ${data.collected?.processed ?? "N/A"}件`);
    console.log(`キーワード: ${data.trendingKeywords ?? 0}件`);
    console.log("\nソース別:");
    if (data.sources) {
      for (const [name, status] of Object.entries(data.sources)) {
        const s = status as { status: string; count: number };
        console.log(`  ${name}: ${s.status} (${s.count}件)`);
      }
    }
  } catch (error) {
    console.error("エラー:", error);
    console.error(
      "\ndev サーバーが起動していることを確認してください: npm run dev",
    );
    process.exit(1);
  }
}

main();
