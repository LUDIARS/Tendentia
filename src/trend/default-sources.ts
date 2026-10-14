// 既定のトレンド取得先。 API キー不要で公開されている一覧・ランキングだけを使う。
// 追加・無効化は画面の設定から行える。

import type { TrendSource } from './types.js';

const APPLE = 'https://rss.marketingtools.apple.com/api/v2/jp';
const HATENA = 'https://b.hatena.ne.jp/hotentry';

const INITIAL_SOURCES: TrendSource[] = [
  // ── 総合 ──
  { id: 'google-trends-jp', name: 'Google トレンド (日本・急上昇)', genre: 'general', kind: 'rss', url: 'https://trends.google.co.jp/trending/rss?geo=JP', enabled: true },
  { id: 'wikipedia-ja', name: 'Wikipedia 日本語版 (前日の閲覧数)', genre: 'general', kind: 'wikipedia_top', url: 'https://ja.wikipedia.org', enabled: true },
  { id: 'hatena-all', name: 'はてブ 総合', genre: 'general', kind: 'rss', url: `${HATENA}.rss`, enabled: true },
  // ── ニュース・社会 ──
  { id: 'hatena-social', name: 'はてブ 世の中', genre: 'news', kind: 'rss', url: `${HATENA}/social.rss`, enabled: true },
  { id: 'hatena-economics', name: 'はてブ 政治と経済', genre: 'news', kind: 'rss', url: `${HATENA}/economics.rss`, enabled: true },
  // ── テック ──
  { id: 'hatena-it', name: 'はてブ テクノロジー', genre: 'tech', kind: 'rss', url: `${HATENA}/it.rss`, enabled: true },
  { id: 'zenn', name: 'Zenn トレンド', genre: 'tech', kind: 'rss', url: 'https://zenn.dev/feed', enabled: true },
  { id: 'hacker-news', name: 'Hacker News', genre: 'tech', kind: 'hn_top', url: 'https://news.ycombinator.com', enabled: true },
  { id: 'product-hunt', name: 'Product Hunt', genre: 'tech', kind: 'rss', url: 'https://www.producthunt.com/feed', enabled: true },
  // ── ゲーム ──
  { id: 'hatena-game', name: 'はてブ アニメとゲーム', genre: 'game', kind: 'rss', url: `${HATENA}/game.rss`, enabled: true },
  { id: 'reddit-gaming', name: 'Reddit r/gaming (今日の上位)', genre: 'game', kind: 'rss', url: 'https://www.reddit.com/r/gaming/top/.rss?t=day', enabled: true },
  // ── アニメ・マンガ ──
  { id: 'anilist-anime', name: 'AniList アニメ (トレンド順)', genre: 'anime', kind: 'anilist_anime', url: 'https://anilist.co/search/anime/trending', enabled: true },
  { id: 'anilist-manga', name: 'AniList マンガ (トレンド順)', genre: 'manga', kind: 'anilist_manga', url: 'https://anilist.co/search/manga/trending', enabled: true },
  // ── 音楽 ──
  { id: 'apple-music-jp', name: 'Apple Music トップソング (日本)', genre: 'music', kind: 'apple_top', url: `${APPLE}/music/most-played/50/songs.json`, enabled: true },
  // ── アプリ ──
  { id: 'app-store-free-jp', name: 'App Store 無料アプリ (日本)', genre: 'app', kind: 'apple_top', url: `${APPLE}/apps/top-free/50/apps.json`, enabled: true },
  { id: 'app-store-paid-jp', name: 'App Store 有料アプリ (日本)', genre: 'app', kind: 'apple_top', url: `${APPLE}/apps/top-paid/50/apps.json`, enabled: true },
  // ── 本 ──
  { id: 'apple-books-paid-jp', name: 'Apple Books 有料 (日本)', genre: 'book', kind: 'apple_top', url: `${APPLE}/books/top-paid/50/books.json`, enabled: true },
  // ── エンタメ ──
  { id: 'hatena-entertainment', name: 'はてブ エンタメ', genre: 'entertainment', kind: 'rss', url: `${HATENA}/entertainment.rss`, enabled: true },
  { id: 'hatena-fun', name: 'はてブ おもしろ', genre: 'entertainment', kind: 'rss', url: `${HATENA}/fun.rss`, enabled: true },
  { id: 'apple-podcasts-jp', name: 'Apple Podcasts トップ番組 (日本)', genre: 'entertainment', kind: 'apple_top', url: `${APPLE}/podcasts/top/50/podcasts.json`, enabled: true },
  // ── 暮らし・知識 ──
  { id: 'hatena-life', name: 'はてブ 暮らし', genre: 'life', kind: 'rss', url: `${HATENA}/life.rss`, enabled: true },
  { id: 'hatena-knowledge', name: 'はてブ 学び', genre: 'life', kind: 'rss', url: `${HATENA}/knowledge.rss`, enabled: true },
  // ── 海外 ──
  { id: 'google-trends-us', name: 'Google トレンド (米国・急上昇)', genre: 'global', kind: 'rss', url: 'https://trends.google.com/trending/rss?geo=US', enabled: true },
  { id: 'reddit-popular', name: 'Reddit r/popular', genre: 'global', kind: 'rss', url: 'https://www.reddit.com/r/popular/.rss', enabled: true },
  { id: 'wikipedia-en', name: 'Wikipedia 英語版 (前日の閲覧数)', genre: 'global', kind: 'wikipedia_top', url: 'https://en.wikipedia.org', enabled: true },
];

/** Google ニュースの検索結果 RSS (既定は直近 7 日)。 公開ランキングが無いジャンルは報道から拾う。 */
function googleNewsSearch(query: string, locale: 'ja' | 'en', period: '1d' | '7d' = '7d'): string {
  const q = encodeURIComponent(`${query} when:${period}`);
  return locale === 'ja'
    ? `https://news.google.com/rss/search?q=${q}&hl=ja&gl=JP&ceid=JP:ja`
    : `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

/** 版 2: 若者 (Z世代) ジャンル。 TikTok・Instagram・X の公式トレンドは API キーが要るので含めない。 */
const YOUTH_SOURCES: TrendSource[] = [
  { id: 'youth-gn-genz', name: 'Google ニュース「Z世代 トレンド」', genre: 'youth', kind: 'rss', url: googleNewsSearch('Z世代 トレンド', 'ja'), enabled: true },
  { id: 'youth-gn-tiktok', name: 'Google ニュース「TikTok 流行」', genre: 'youth', kind: 'rss', url: googleNewsSearch('TikTok 流行', 'ja'), enabled: true },
  { id: 'youth-gn-highschool', name: 'Google ニュース「女子高生 流行」', genre: 'youth', kind: 'rss', url: googleNewsSearch('女子高生 流行', 'ja'), enabled: true },
  { id: 'youth-gn-slang', name: 'Google ニュース「若者言葉」', genre: 'youth', kind: 'rss', url: googleNewsSearch('若者言葉', 'ja'), enabled: true },
  { id: 'youth-gn-genz-en', name: 'Google News "Gen Z trend" (英語圏)', genre: 'youth', kind: 'rss', url: googleNewsSearch('Gen Z trend', 'en'), enabled: true },
  { id: 'reddit-genz', name: 'Reddit r/GenZ (今日の上位)', genre: 'youth', kind: 'rss', url: 'https://www.reddit.com/r/GenZ/top/.rss?t=day', enabled: true },
];

/** 版 3: ジャンル拡充 (株価・IT・AI・ガジェット・ゲーム・アニメ・マンガ・小説・芸能・ファッション・食品・外食・ミーム)。 各ジャンルのニュースサイトの RSS / API。 */
const GENRE_EXPANSION_SOURCES: TrendSource[] = [
  // ── 株価・マーケット ──
  { id: 'yahoo-business', name: 'Yahoo!ニュース 経済', genre: 'stock', kind: 'rss', url: 'https://news.yahoo.co.jp/rss/topics/business.xml', enabled: true },
  { id: 'gn-stock-surge', name: 'Google ニュース「株価 急騰」', genre: 'stock', kind: 'rss', url: googleNewsSearch('株価 急騰', 'ja', '1d'), enabled: true },
  { id: 'gn-nikkei', name: 'Google ニュース「日経平均」', genre: 'stock', kind: 'rss', url: googleNewsSearch('日経平均 株価', 'ja', '1d'), enabled: true },
  { id: 'gn-us-stock', name: 'Google ニュース「米国株」', genre: 'stock', kind: 'rss', url: googleNewsSearch('米国株 相場', 'ja', '1d'), enabled: true },
  // ── IT ──
  { id: 'yahoo-it', name: 'Yahoo!ニュース IT', genre: 'tech', kind: 'rss', url: 'https://news.yahoo.co.jp/rss/topics/it.xml', enabled: true },
  { id: 'itmedia-news', name: 'ITmedia NEWS', genre: 'tech', kind: 'rss', url: 'https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml', enabled: true },
  // ── AI ──
  { id: 'itmedia-aiplus', name: 'ITmedia AI+', genre: 'ai', kind: 'rss', url: 'https://rss.itmedia.co.jp/rss/2.0/aiplus.xml', enabled: true },
  { id: 'gn-genai', name: 'Google ニュース「生成AI」', genre: 'ai', kind: 'rss', url: googleNewsSearch('生成AI', 'ja'), enabled: true },
  { id: 'gn-ai-en', name: 'Google News "AI model" (英語圏)', genre: 'ai', kind: 'rss', url: googleNewsSearch('AI model launch', 'en'), enabled: true },
  // ── ガジェット ──
  { id: 'gizmodo-jp', name: 'GIZMODO JAPAN', genre: 'gadget', kind: 'rss', url: 'https://www.gizmodo.jp/index.xml', enabled: true },
  { id: 'itmedia-mobile', name: 'ITmedia Mobile', genre: 'gadget', kind: 'rss', url: 'https://rss.itmedia.co.jp/rss/2.0/mobile.xml', enabled: true },
  { id: 'the-verge', name: 'The Verge', genre: 'gadget', kind: 'rss', url: 'https://www.theverge.com/rss/index.xml', enabled: true },
  { id: 'gn-gadget', name: 'Google ニュース「ガジェット 新製品」', genre: 'gadget', kind: 'rss', url: googleNewsSearch('ガジェット 新製品', 'ja'), enabled: true },
  // ── ゲーム ──
  { id: '4gamer', name: '4Gamer.net', genre: 'game', kind: 'rss', url: 'https://www.4gamer.net/rss/index.xml', enabled: true },
  { id: 'automaton', name: 'AUTOMATON', genre: 'game', kind: 'rss', url: 'https://automaton-media.com/feed/', enabled: true },
  { id: 'gamespark', name: 'Game*Spark', genre: 'game', kind: 'rss', url: 'https://www.gamespark.jp/rss/index.rdf', enabled: true },
  // ── アニメ・マンガ・小説 ──
  { id: 'animeanime', name: 'アニメ!アニメ!', genre: 'anime', kind: 'rss', url: 'https://animeanime.jp/rss/index.rdf', enabled: true },
  { id: 'comic-natalie', name: 'コミックナタリー', genre: 'manga', kind: 'rss', url: 'https://natalie.mu/comic/feed/news', enabled: true },
  { id: 'narou-daily', name: '小説家になろう 日間ランキング', genre: 'novel', kind: 'narou_ranking', url: 'https://api.syosetu.com/novelapi/api/?order=dailypoint', enabled: true },
  { id: 'narou-weekly', name: '小説家になろう 週間ランキング', genre: 'novel', kind: 'narou_ranking', url: 'https://api.syosetu.com/novelapi/api/?order=weeklypoint', enabled: true },
  { id: 'gn-lightnovel', name: 'Google ニュース「ライトノベル」', genre: 'novel', kind: 'rss', url: googleNewsSearch('ライトノベル 話題', 'ja'), enabled: true },
  // ── 音楽・芸能・エンタメ ──
  { id: 'music-natalie', name: '音楽ナタリー', genre: 'music', kind: 'rss', url: 'https://natalie.mu/music/feed/news', enabled: true },
  { id: 'yahoo-entertainment', name: 'Yahoo!ニュース エンタメ', genre: 'celebrity', kind: 'rss', url: 'https://news.yahoo.co.jp/rss/topics/entertainment.xml', enabled: true },
  { id: 'owarai-natalie', name: 'お笑いナタリー', genre: 'celebrity', kind: 'rss', url: 'https://natalie.mu/owarai/feed/news', enabled: true },
  { id: 'gn-geino', name: 'Google ニュース「芸能」', genre: 'celebrity', kind: 'rss', url: googleNewsSearch('芸能 話題', 'ja', '1d'), enabled: true },
  { id: 'eiga-natalie', name: '映画ナタリー', genre: 'entertainment', kind: 'rss', url: 'https://natalie.mu/eiga/feed/news', enabled: true },
  // ── ファッション ──
  { id: 'wwdjapan', name: 'WWDJAPAN', genre: 'fashion', kind: 'rss', url: 'https://www.wwdjapan.com/feed', enabled: true },
  { id: 'elle-jp', name: 'ELLE Japan', genre: 'fashion', kind: 'rss', url: 'https://www.elle.com/jp/rss/all.xml/', enabled: true },
  { id: 'gn-fashion', name: 'Google ニュース「ファッション トレンド」', genre: 'fashion', kind: 'rss', url: googleNewsSearch('ファッション トレンド', 'ja'), enabled: true },
  // ── 食品 (飲料 / レトルト・加工食品 / 食品) ・外食 ──
  { id: 'ssnp-beverage', name: '食品産業新聞 飲料', genre: 'drink', kind: 'rss', url: 'https://www.ssnp.co.jp/beverage/feed/', enabled: true },
  { id: 'gn-drink', name: 'Google ニュース「新商品 飲料」', genre: 'drink', kind: 'rss', url: googleNewsSearch('新商品 飲料 発売', 'ja'), enabled: true },
  { id: 'gn-retort', name: 'Google ニュース「レトルト 新商品」', genre: 'packaged_food', kind: 'rss', url: googleNewsSearch('レトルト 新商品', 'ja'), enabled: true },
  { id: 'gn-frozen', name: 'Google ニュース「冷凍食品 新商品」', genre: 'packaged_food', kind: 'rss', url: googleNewsSearch('冷凍食品 新商品', 'ja'), enabled: true },
  { id: 'gn-instant', name: 'Google ニュース「カップ麺 新商品」', genre: 'packaged_food', kind: 'rss', url: googleNewsSearch('カップ麺 新商品', 'ja'), enabled: true },
  { id: 'ssnp', name: '食品産業新聞', genre: 'food', kind: 'rss', url: 'https://www.ssnp.co.jp/feed/', enabled: true },
  { id: 'gn-food', name: 'Google ニュース「新商品 食品」', genre: 'food', kind: 'rss', url: googleNewsSearch('新商品 食品 発売', 'ja'), enabled: true },
  { id: 'diamond-rm', name: 'ダイヤモンド・チェーンストアオンライン', genre: 'restaurant', kind: 'rss', url: 'https://diamond-rm.net/feed/', enabled: true },
  { id: 'gn-restaurant', name: 'Google ニュース「飲食店 オープン」', genre: 'restaurant', kind: 'rss', url: googleNewsSearch('飲食店 新店 オープン', 'ja'), enabled: true },
  { id: 'gn-gourmet', name: 'Google ニュース「グルメ トレンド」', genre: 'restaurant', kind: 'rss', url: googleNewsSearch('グルメ トレンド', 'ja'), enabled: true },
  // ── ネットミーム ──
  { id: 'netlab', name: 'ねとらぼ', genre: 'meme', kind: 'rss', url: 'https://rss.itmedia.co.jp/rss/2.0/netlab.xml', enabled: true },
  { id: 'knowyourmeme', name: 'Know Your Meme', genre: 'meme', kind: 'rss', url: 'https://knowyourmeme.com/memes.rss', enabled: true },
  { id: 'gn-meme', name: 'Google ニュース「ネットミーム」', genre: 'meme', kind: 'rss', url: googleNewsSearch('ネットミーム', 'ja'), enabled: true },
  // ── ニュース・アプリ ──
  { id: 'yahoo-top-picks', name: 'Yahoo!ニュース 主要', genre: 'news', kind: 'rss', url: 'https://news.yahoo.co.jp/rss/topics/top-picks.xml', enabled: true },
  { id: 'gn-app', name: 'Google ニュース「アプリ 話題」', genre: 'app', kind: 'rss', url: googleNewsSearch('アプリ 話題', 'ja'), enabled: true },
];

/**
 * 既定ソースを追加した版ごとに並べる。 保存済み設定は defaultsVersion より新しい版のソースだけを
 * 読み込み時に足す (config.ts withNewDefaultSources)。 既定を増やすときは新しい版を足す。
 */
export const DEFAULT_TREND_SOURCE_RELEASES: { version: number; sources: TrendSource[] }[] = [
  { version: 1, sources: INITIAL_SOURCES },
  { version: 2, sources: YOUTH_SOURCES },
  { version: 3, sources: GENRE_EXPANSION_SOURCES },
];

export const DEFAULT_TREND_SOURCES: TrendSource[] = DEFAULT_TREND_SOURCE_RELEASES.flatMap((release) => release.sources);
