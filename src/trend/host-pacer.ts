// 同じサイトへの連続アクセスに間隔を空ける。 Google ニュース・はてブ・Reddit など 1 つのサイトに
// 複数のソースがあるので、 続けて叩くと 429 (アクセス過多) で断られる。 時計と待ち方は差し替えられる。

export type Sleep = (ms: number) => Promise<void>;

export const DEFAULT_HOST_GAP_MS = 3_000;
/** 無認証の取得に厳しいサイトは長めに空ける。 */
export const STRICT_HOST_GAP_MS: Record<string, number> = {
  'www.reddit.com': 15_000,
};

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return url; }
}

export class HostPacer {
  private readonly lastAt = new Map<string, number>();

  private readonly sleep: Sleep;
  private readonly now: () => number;
  private readonly defaultGapMs: number;

  constructor(sleep: Sleep = realSleep, now: () => number = () => Date.now(), defaultGapMs = DEFAULT_HOST_GAP_MS) {
    this.sleep = sleep;
    this.now = now;
    this.defaultGapMs = defaultGapMs;
  }

  gapFor(host: string): number {
    return STRICT_HOST_GAP_MS[host] ?? this.defaultGapMs;
  }

  /** 前回この host に行ってから間隔が足りなければ待ち、 これから行く時刻を記録する。 */
  async wait(url: string): Promise<void> {
    const host = hostOf(url);
    const last = this.lastAt.get(host);
    if (last !== undefined) {
      const remaining = last + this.gapFor(host) - this.now();
      if (remaining > 0) await this.sleep(remaining);
    }
    this.lastAt.set(host, this.now());
  }
}

/** 同じ host が続かないよう、 host ごとの列から 1 件ずつ順に取り出して並べ直す (host の初出順・各列内の順は保つ)。 */
export function interleaveByHost<T extends { url: string }>(items: readonly T[]): T[] {
  const queues = new Map<string, T[]>();
  for (const item of items) {
    const host = hostOf(item.url);
    const queue = queues.get(host);
    if (queue) queue.push(item);
    else queues.set(host, [item]);
  }
  const out: T[] = [];
  while (out.length < items.length) {
    for (const queue of queues.values()) {
      const next = queue.shift();
      if (next) out.push(next);
    }
  }
  return out;
}
