import type { DailyDigest, SourceStatus } from "./types";
import dayjs from "dayjs";
import fs from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// ストレージバックエンド判定
// ---------------------------------------------------------------------------

const useKV =
  !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

// ---------------------------------------------------------------------------
// キー定数
// ---------------------------------------------------------------------------

const KEY_PREFIX = "news";
const KEY_LATEST = `${KEY_PREFIX}:latest`;
const KEY_SOURCE_STATUS = `${KEY_PREFIX}:source_status`;
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30日

function dateKey(date: string): string {
  return `${KEY_PREFIX}:${date}`;
}

// =========================================================================
// Vercel KV バックエンド
// =========================================================================

async function getKV() {
  const { kv } = await import("@vercel/kv");
  return kv;
}

const kvBackend = {
  async set(key: string, value: string, ttl?: number): Promise<void> {
    const kv = await getKV();
    if (ttl) {
      await kv.set(key, value, { ex: ttl });
    } else {
      await kv.set(key, value);
    }
  },

  async get(key: string): Promise<string | null> {
    const kv = await getKV();
    const data = await kv.get<string>(key);
    return data ?? null;
  },

  async keys(pattern: string): Promise<string[]> {
    const kv = await getKV();
    return kv.keys(pattern);
  },
};

// =========================================================================
// ファイルシステム フォールバック（ローカル開発用）
// =========================================================================

const FS_DIR = path.join(
  process.env.TMPDIR ?? process.env.TMP ?? "/tmp",
  "ai-news-data",
);

async function ensureFsDir(): Promise<void> {
  await fs.mkdir(FS_DIR, { recursive: true });
}

/** キーをファイル名に変換（: → _） */
function keyToFile(key: string): string {
  return path.join(FS_DIR, `${key.replace(/:/g, "_")}.json`);
}

const fsBackend = {
  async set(key: string, value: string, _ttl?: number): Promise<void> {
    await ensureFsDir();
    await fs.writeFile(keyToFile(key), value, "utf-8");
  },

  async get(key: string): Promise<string | null> {
    try {
      return await fs.readFile(keyToFile(key), "utf-8");
    } catch {
      return null;
    }
  },

  async keys(pattern: string): Promise<string[]> {
    try {
      await ensureFsDir();
      const prefix = pattern.replace("*", "").replace(/:/g, "_");
      const files = await fs.readdir(FS_DIR);
      return files
        .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
        .map((f) => f.replace(".json", "").replace(/_/g, ":"));
    } catch {
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// 統合ストレージ
// ---------------------------------------------------------------------------

const store = useKV ? kvBackend : fsBackend;

if (!useKV) {
  console.log(
    "[storage] KV_REST_API_URL/KV_REST_API_TOKEN が未設定 — ファイルシステムフォールバックを使用",
  );
}

// ---------------------------------------------------------------------------
// JSON ヘルパー
// ---------------------------------------------------------------------------

function serialize(data: unknown): string {
  return JSON.stringify(data);
}

function deserialize<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : (raw as T);
  } catch {
    return null;
  }
}

// =========================================================================
// 公開 API
// =========================================================================

/**
 * 日次ダイジェストを保存する。
 * - キー `news:${date}` に TTL 30日で保存
 * - キー `news:latest` にも最新データのコピーを保存
 */
export async function saveDailyDigest(
  digest: DailyDigest,
): Promise<void> {
  const key = dateKey(digest.date);
  const json = serialize(digest);

  await Promise.all([
    store.set(key, json, TTL_SECONDS),
    store.set(KEY_LATEST, json, TTL_SECONDS),
  ]);

  console.log(
    `[storage] DailyDigest 保存: ${digest.date} (${digest.articles.length}件)`,
  );
}

/**
 * 指定日のダイジェストを取得する。
 */
export async function getDailyDigest(
  date: string,
): Promise<DailyDigest | null> {
  const raw = await store.get(dateKey(date));
  return deserialize<DailyDigest>(raw);
}

/**
 * 最新のダイジェストを取得する（`news:latest` から）。
 */
export async function getLatestDigest(): Promise<DailyDigest | null> {
  const raw = await store.get(KEY_LATEST);
  return deserialize<DailyDigest>(raw);
}

/**
 * 直近 N 日分のダイジェストを取得する（新しい順）。
 */
export async function getArchive(
  days: number,
): Promise<DailyDigest[]> {
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    dates.push(dayjs().subtract(i, "day").format("YYYY-MM-DD"));
  }

  const results = await Promise.all(dates.map(getDailyDigest));

  return results.filter((d): d is DailyDigest => d !== null);
}

// =========================================================================
// ソースステータス（cron 収集中に個別更新するため独立管理）
// =========================================================================

/**
 * 個別ソースのステータスを更新する。
 */
export async function updateSourceStatus(
  status: SourceStatus,
): Promise<void> {
  const all = await getSourceStatuses();
  all[status.name] = status;
  await store.set(KEY_SOURCE_STATUS, serialize(all));
}

/**
 * 全ソースのステータスを取得する。
 */
export async function getSourceStatuses(): Promise<
  Record<string, SourceStatus>
> {
  const raw = await store.get(KEY_SOURCE_STATUS);
  return deserialize<Record<string, SourceStatus>>(raw) ?? {};
}
