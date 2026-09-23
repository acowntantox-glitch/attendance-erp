/** "09:00:00" -> "09:00" — display only, never used for any calculation. */
export function formatTime(time: string): string {
  return time.slice(0, 5);
}

export function formatTimeRange(startTime: string, endTime: string): string {
  return `${formatTime(startTime)} – ${formatTime(endTime)}`;
}
