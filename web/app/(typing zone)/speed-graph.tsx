import type { TypingSample } from "./typing-stats";

export default function SpeedGraph({ samples, grossWpm, errorRate, adjustedWpm }: {
  samples: TypingSample[];
  grossWpm: number;
  errorRate: number | null;
  adjustedWpm: number;
}) {
  const last = samples[samples.length - 1];
  const maxSeconds = Math.max(10, Math.ceil((last?.seconds ?? 0) / 10) * 10);
  const maxWpm = Math.max(50, Math.ceil(samples.reduce((max, sample) => Math.max(max, sample.grossWpm), 0) / 50) * 50);
  const x = (seconds: number) => 48 + (seconds / maxSeconds) * 504;
  const y = (value: number, maximum: number) => 200 - (value / maximum) * 160;
  const wpmPoints = samples.map((sample) => `${x(sample.seconds)},${y(sample.grossWpm, maxWpm)}`).join(" ");
  const errorPoints = samples.map((sample) => `${x(sample.seconds)},${y(sample.errorRate, 100)}`).join(" ");

  return (
    <section className="space-y-3" aria-labelledby="speed-title">
      <h2 id="speed-title" className="text-lg font-semibold">Typing performance</h2>
      <div className="flex flex-wrap gap-5 text-sm tabular-nums">
        <span className="text-blue-500">— Gross WPM: {grossWpm.toFixed(1)}</span>
        <span className="text-orange-500">┄ Error rate: {errorRate === null ? "—" : `${errorRate.toFixed(1)}%`}</span>
        <span className="font-semibold">Adjusted WPM: {adjustedWpm.toFixed(1)}</span>
      </div>

      <div className="rounded-lg border border-gray-500 p-3 sm:p-5">
        {samples.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-500">Start typing to see your graph.</p>
        ) : (
          <svg viewBox="0 0 600 244" className="w-full font-mono text-xs" role="img" aria-labelledby="graph-title graph-description">
            <title id="graph-title">Gross WPM and error rate over time</title>
            <desc id="graph-description">Blue solid line: gross WPM on the left axis. Orange dashed line: error percentage on the right axis. Latest sample at {last.seconds.toFixed(1)} seconds: {last.grossWpm.toFixed(1)} WPM and {last.errorRate.toFixed(1)}% errors.</desc>
            <text x="48" y="18" fill="currentColor" className="text-blue-500">WPM</text>
            <text x="552" y="18" textAnchor="end" fill="currentColor" className="text-orange-500">Error %</text>
            {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
              <g key={fraction} className="text-gray-500">
                <line x1="48" x2="552" y1={y(fraction, 1)} y2={y(fraction, 1)} stroke="currentColor" strokeOpacity="0.25" />
                <text x="40" y={y(fraction, 1) + 4} textAnchor="end" fill="currentColor">{Math.round(maxWpm * fraction)}</text>
                <text x="560" y={y(fraction, 1) + 4} fill="currentColor">{100 * fraction}</text>
              </g>
            ))}
            {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
              <text key={fraction} x={x(maxSeconds * fraction)} y="220" textAnchor="middle" fill="currentColor" className="text-gray-500">{maxSeconds * fraction}s</text>
            ))}
            <polyline points={errorPoints} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" className="text-orange-500" />
            <polyline points={wpmPoints} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" className="text-blue-500" />
            {samples.map((sample, index) => (
              <g key={index}>
                <title>{sample.seconds.toFixed(1)}s: {sample.grossWpm.toFixed(1)} WPM · {sample.errorRate.toFixed(1)}% errors</title>
                <circle cx={x(sample.seconds)} cy={y(sample.errorRate, 100)} r="3" fill="currentColor" className="text-orange-500" />
                <circle cx={x(sample.seconds)} cy={y(sample.grossWpm, maxWpm)} r="3" fill="currentColor" className="text-blue-500" />
              </g>
            ))}
          </svg>
        )}
      </div>
    </section>
  );
}
