/** 指定時間以内に公開されたかチェック */
export function isWithinHours(dateString: string, hours: number): boolean {
  const publishedAt = new Date(dateString);
  if (isNaN(publishedAt.getTime())) return true; // パース不能な場合は含める
  const diffMs = Date.now() - publishedAt.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours <= hours && diffHours >= 0;
}
