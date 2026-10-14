// 画面で使うジャンルの名前と色 (色相)。 並び順はサーバの TREND_GENRES と同じ。
// 色はマップのタイル・色見本で `--tm-h` (hsl の色相) として使う。 近いジャンルが隣り合わないよう色相を飛ばして振る。

export type TrendGenre =
  | 'general' | 'youth' | 'news' | 'stock' | 'tech' | 'ai'
  | 'gadget' | 'game' | 'anime' | 'manga' | 'novel' | 'book'
  | 'music' | 'celebrity' | 'entertainment' | 'fashion' | 'drink' | 'packaged_food'
  | 'food' | 'restaurant' | 'meme' | 'app' | 'life' | 'global';

export const GENRE_LABELS: Record<TrendGenre, string> = {
  general: '総合 (検索・閲覧)',
  youth: '若者 (Z世代)',
  news: 'ニュース・社会',
  stock: '株価・マーケット',
  tech: 'IT',
  ai: 'AI',
  gadget: 'ガジェット',
  game: 'ゲーム',
  anime: 'アニメ',
  manga: 'マンガ',
  novel: '小説',
  book: '本',
  music: '音楽',
  celebrity: '芸能',
  entertainment: 'エンタメ',
  fashion: 'ファッション',
  drink: '飲料',
  packaged_food: 'レトルト・加工食品',
  food: '食品',
  restaurant: 'レストラン・外食',
  meme: 'ネットミーム',
  app: 'アプリ',
  life: '暮らし・知識',
  global: '海外',
};

export const GENRE_HUES: Record<TrendGenre, number> = {
  general: 216,
  youth: 302,
  news: 0,
  stock: 140,
  tech: 192,
  ai: 262,
  gadget: 176,
  game: 248,
  anime: 28,
  manga: 12,
  novel: 330,
  book: 82,
  music: 50,
  celebrity: 345,
  entertainment: 318,
  fashion: 288,
  drink: 200,
  packaged_food: 38,
  food: 96,
  restaurant: 20,
  meme: 64,
  app: 125,
  life: 160,
  global: 272,
};

export function genreHue(genre: string): number {
  return GENRE_HUES[genre as TrendGenre] ?? 220;
}
