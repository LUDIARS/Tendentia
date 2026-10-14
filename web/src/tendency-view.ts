// 「あなたの傾向」。 ログインした本人の直近 90 日に開いた記録から、 ジャンルの割合・週ごとの回数・よく開いた話題を見せる。

import { genreHue, type TrendGenre } from './genres.ts';
import { escapeHtml } from './sanitize.ts';

interface UserTendency {
  total: number;
  genres: { genre: TrendGenre; label: string; count: number; share: number }[];
  weekly: { weekStart: string; total: number; counts: Partial<Record<TrendGenre, number>> }[];
  topics: { title: string; genre: TrendGenre; count: number }[];
}

function genreBars(tendency: UserTendency): string {
  return `<ul class="tt-genres">${tendency.genres.slice(0, 8).map((genre) => `<li>
      <span class="tt-label">${escapeHtml(genre.label)}</span>
      <span class="tt-bar"><span style="--tm-h:${genreHue(genre.genre)};width:${Math.max(4, Math.round(genre.share * 100))}%"></span></span>
      <span class="tt-value muted">${Math.round(genre.share * 100)}% (${genre.count} 回)</span>
    </li>`).join('')}</ul>`;
}

function weeklyBars(tendency: UserTendency): string {
  const max = Math.max(1, ...tendency.weekly.map((week) => week.total));
  return `<div class="tt-weekly" aria-label="週ごとに開いた回数">${tendency.weekly.map((week) => {
    const title = `${week.weekStart} の週: ${week.total} 回`;
    return `<div class="tt-week" title="${escapeHtml(title)}"><span class="tt-week-bar" style="height:${Math.round((week.total / max) * 100)}%"></span><span class="tt-week-label muted">${escapeHtml(week.weekStart.slice(5))}</span></div>`;
  }).join('')}</div>`;
}

function topicList(tendency: UserTendency): string {
  if (tendency.topics.length === 0) return '';
  return `<ol class="tt-topics">${tendency.topics.map((topic) => `<li><span class="tt-dot" style="--tm-h:${genreHue(topic.genre)}"></span>${escapeHtml(topic.title)} <span class="muted">${topic.count} 回</span></li>`).join('')}</ol>`;
}

export async function loadTendency(container: HTMLElement): Promise<void> {
  try {
    const response = await fetch('/api/trend-crawler/tendency');
    if (!response.ok) {
      container.innerHTML = '';
      return;
    }
    const { tendency } = await response.json() as { tendency: UserTendency };
    container.innerHTML = `<details class="tt-view" open>
      <summary>あなたの傾向 <span class="muted">(直近 90 日に開いた ${tendency.total} 件から)</span></summary>
      ${tendency.total === 0
        ? '<p class="muted">まだ記録がありません。 マップから記事を開くと、 あなたの好みを学んで大きさが変わります。</p>'
        : `<div class="tt-grid"><section><h3>よく見るジャンル</h3>${genreBars(tendency)}</section>
           <section><h3>週ごとに開いた回数</h3>${weeklyBars(tendency)}</section>
           <section><h3>よく開いた話題</h3>${topicList(tendency)}</section></div>`}
    </details>`;
  } catch {
    container.innerHTML = '';
  }
}
