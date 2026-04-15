/**
 * Utilitaires de formatage / parsing de durées (secondes ↔ chaîne lisible)
 */

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}min`;
}

export function formatDurationShort(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}h${m}` : `${h}h`;
}

/** Parse "2h 34min" ou "45min 30s" ou "90s" → secondes */
export function parseDuration(formatted: string): number {
  let total = 0;
  const h = formatted.match(/(\d+)\s*h/);
  const m = formatted.match(/(\d+)\s*min/);
  const s = formatted.match(/(\d+)\s*s(?!ec)/);
  if (h) total += parseInt(h[1]) * 3600;
  if (m) total += parseInt(m[1]) * 60;
  if (s) total += parseInt(s[1]);
  return total;
}
