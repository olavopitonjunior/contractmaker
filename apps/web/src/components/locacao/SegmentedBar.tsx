interface Segment {
  /** valor absoluto (vai virar % no total) */
  value: number;
  /** classe Tailwind do background (ex.: "bg-emerald-500") */
  color: string;
  label?: string;
}

interface Props {
  segments: Segment[];
  /** Altura da barra. Default `h-3`. */
  height?: string;
  /** Mostra legenda abaixo com cor + label + valor. */
  showLegend?: boolean;
}

/**
 * Barra segmentada inline (verde/amarelo/vermelho) — replica visual Superlógica
 * pra resumo de cobranças. Cada segmento ocupa % proporcional ao seu value.
 */
export function SegmentedBar({ segments, height = "h-3", showLegend = false }: Props) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  if (total === 0) {
    return <div className={`w-full ${height} rounded-full bg-muted`} />;
  }

  return (
    <div className="space-y-2">
      <div className={`flex w-full overflow-hidden rounded-full bg-muted ${height}`}>
        {segments.map((seg, i) => {
          const pct = (seg.value / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={i}
              className={seg.color}
              style={{ width: `${pct}%` }}
              title={`${seg.label ?? ""}: ${seg.value}`}
            />
          );
        })}
      </div>
      {showLegend && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {segments.map((seg, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${seg.color}`} />
              <span>
                {seg.value} {seg.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
