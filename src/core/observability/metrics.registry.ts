export type MetricLabels = Record<string, string | number | boolean | null | undefined>;

const HISTOGRAM_BUCKETS = [
  1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
];

interface CounterEntry {
  name: string;
  labels: MetricLabels;
  value: number;
}

interface HistogramEntry {
  name: string;
  labels: MetricLabels;
  count: number;
  sum: number;
  buckets: Map<number, number>;
}

interface GaugeEntry {
  name: string;
  labels: MetricLabels;
  value: number;
}

/**
 * Registre de métriques en mémoire, sans dépendance externe.
 * Les métriques sont exposées au format Prometheus par `/api/v1/observability/metrics`.
 */
export class MetricsRegistry {
  private readonly counters = new Map<string, CounterEntry>();
  private readonly histograms = new Map<string, HistogramEntry>();
  private readonly gauges = new Map<string, GaugeEntry>();

  inc(name: string, labels: MetricLabels = {}, value = 1): void {
    const key = this.key(name, labels);
    const current = this.counters.get(key);

    if (current) {
      current.value += value;
    } else {
      this.counters.set(key, { name, labels, value });
    }
  }

  observe(name: string, value: number, labels: MetricLabels = {}): void {
    const key = this.key(name, labels);
    let histogram = this.histograms.get(key);

    if (!histogram) {
      histogram = {
        name,
        labels,
        count: 0,
        sum: 0,
        buckets: new Map(HISTOGRAM_BUCKETS.map((bucket) => [bucket, 0])),
      };
      this.histograms.set(key, histogram);
    }

    histogram.count += 1;
    histogram.sum += value;

    for (const bucket of HISTOGRAM_BUCKETS) {
      if (value <= bucket) {
        histogram.buckets.set(bucket, (histogram.buckets.get(bucket) ?? 0) + 1);
      }
    }
  }

  setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    this.gauges.set(this.key(name, labels), { name, labels, value });
  }

  render(): string {
    const lines: string[] = [];

    for (const entry of [...this.counters.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      lines.push(
        `${entry.name}${this.formatLabels(entry.labels)} ${entry.value}`,
      );
    }

    for (const entry of [...this.gauges.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      lines.push(
        `${entry.name}${this.formatLabels(entry.labels)} ${entry.value}`,
      );
    }

    for (const entry of [...this.histograms.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      for (const bucket of HISTOGRAM_BUCKETS) {
        lines.push(
          `${entry.name}_bucket${this.formatLabels({
            ...entry.labels,
            le: bucket,
          })} ${entry.buckets.get(bucket) ?? 0}`,
        );
      }

      lines.push(
        `${entry.name}_bucket${this.formatLabels({
          ...entry.labels,
          le: '+Inf',
        })} ${entry.count}`,
      );
      lines.push(`${entry.name}_sum${this.formatLabels(entry.labels)} ${entry.sum}`);
      lines.push(`${entry.name}_count${this.formatLabels(entry.labels)} ${entry.count}`);
    }

    return lines.join('\n');
  }

  private key(name: string, labels: MetricLabels): string {
    const serialized = Object.entries(labels)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(',');

    return `${name}|${serialized}`;
  }

  private formatLabels(labels: MetricLabels): string {
    const entries = Object.entries(labels)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));

    if (entries.length === 0) {
      return '';
    }

    const serialized = entries
      .map(
        ([key, value]) =>
          `${key}="${this.escapeLabel(String(value ?? ''))}"`,
      )
      .join(',');

    return `{${serialized}}`;
  }

  private escapeLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }
}

export const metrics = new MetricsRegistry();
