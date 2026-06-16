export function now(): string {
  return new Date().toISOString();
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function elapsedSeconds(startedAt: string): number {
  return (Date.now() - new Date(startedAt).getTime()) / 1000;
}
