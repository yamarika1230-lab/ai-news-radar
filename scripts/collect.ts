/**
 * ローカル開発用: データ収集を手動実行するスクリプト
 *
 * 使い方:
 *   1. 別ターミナルで npm run dev を起動
 *   2. npm run collect を実行
 *
 * .env.local の ANTHROPIC_API_KEY が必要です。
 * KV_REST_API_URL が未設定の場合、/tmp/ai-news-data/ にファイル保存されます。
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET;

async function main() {
  console.log("=== AI News Radar: 手動データ収集 ===\n");
  console.log(`エンドポイント: ${BASE_URL}/api/cron/collect`);

  // dev サーバーの起動チェック
  try {
    const check = await fetch(BASE_URL, {
      signal: AbortSignal.timeout(3000),
    });
    // HTML が返ってきたら OK（Next.js が動いている）
    await check.text();
  } catch {
    console.error(
      "\n❌ dev サーバーに接続できません。先に別ターミナルで以下を実行してください:\n\n  npm run dev\n",
    );
    process.exit(1);
  }

  const headers: Record<string, string> = {};
  if (CRON_SECRET) {
    headers["Authorization"] = `Bearer ${CRON_SECRET}`;
    console.log("認証: CRON_SECRET を使用");
  } else {
    console.log("認証: CRON_SECRET 未設定（スキップ）");
  }

  console.log("\n収集開始...\n");

  try {
    const res = await fetch(`${BASE_URL}/api/cron/collect`, {
      headers,
      signal: AbortSignal.timeout(300_000), // 5分タイムアウト
    });

    const body = await res.text();

    if (!res.ok) {
      console.error(`HTTP ${res.status}: ${res.statusText}`);
      // HTML が返ってきた場合はタグを除去して表示
      if (body.startsWith("<!") || body.startsWith("<html")) {
        console.error("エラー: HTMLレスポンスが返りました（APIルートではなくページが返されています）");
      } else {
        console.error(body.substring(0, 500));
      }
      process.exit(1);
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(body);
    } catch {
      console.error("エラー: JSONパース失敗。レスポンス先頭200文字:", body.substring(0, 200));
      process.exit(1);
    }

    console.log("完了!\n");
    console.log(`日付:       ${data.date}`);
    console.log(`処理時間:   ${data.elapsedSeconds}秒`);
    const collected = data.collected as Record<string, number> | undefined;
    console.log(`収集件数:   ${collected?.raw ?? "N/A"}件 (生)`);
    console.log(`重複除去後: ${collected?.unique ?? "N/A"}件`);
    console.log(`処理済み:   ${collected?.processed ?? "N/A"}件`);
    console.log(`キーワード: ${data.trendingKeywords ?? 0}件`);
    console.log("\nソース別:");
    if (data.sources) {
      for (const [name, status] of Object.entries(
        data.sources as Record<string, { status: string; count: number }>,
      )) {
        console.log(`  ${name}: ${status.status} (${status.count}件)`);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      console.error("\nタイムアウト: 5分以内に処理が完了しませんでした。");
    } else {
      console.error("エラー:", error);
    }
    process.exit(1);
  }

  // 明示的にプロセスを終了（未クローズの接続によるハングを防止）
  process.exit(0);
}

main();
