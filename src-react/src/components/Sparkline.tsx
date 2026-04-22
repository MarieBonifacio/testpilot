/** Composant SVG sparkline partagé — utilisé par Dashboard et ProductionBugs */
export function Sparkline({ data, color }: { data: (number | null)[]; color: string }) {
  const values = data.filter((v): v is number => v !== null);
  if (values.length < 2) return <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>—</span>;
  const max = Math.max(...values, 1);
  const W = 80, H = 28, pts = data.length;
  // pts >= 2 car values.length >= 2 et pts === data.length >= values.length
  const points = data
    .map((v, i) => v !== null ? `${(i / (pts - 1)) * W},${H - (v / max) * H}` : null)
    .filter(Boolean)
    .join(' ');
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
}
