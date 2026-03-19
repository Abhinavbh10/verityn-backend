// ============================================================
// FILE: api/rss.js  (NEW FILE)
// PURPOSE: Fetches RSS feeds per country — unlimited, free
//          Parses XML inline — no extra dependencies needed
// Upload to GitHub → api/rss.js
// ============================================================

const { createClient } = require('@supabase/supabase-js');

// ── RSS feeds per country ─────────────────────────────────────
// Multiple feeds per country = volume
const COUNTRY_FEEDS = {
  in: [
    'https://www.thehindu.com/news/feeder/default.rss',
    'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
    'https://feeds.feedburner.com/ndtvnews-top-stories',
    'https://indianexpress.com/feed/',
    'https://www.hindustantimes.com/feeds/rss/topnews/rssfeed.xml',
    'https://www.livemint.com/rss/news',
    'https://economictimes.indiatimes.com/rssfeedsdefault.cms',
  ],
  us: [
    'https://feeds.npr.org/1001/rss.xml',
    'https://rss.cnn.com/rss/edition.rss',
    'https://feeds.nbcnews.com/nbcnews/public/news',
    'https://abcnews.go.com/abcnews/topstories',
    'https://feeds.washingtonpost.com/rss/politics',
    'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    'https://feeds.reuters.com/reuters/topNews',
  ],
  gb: [
    'https://feeds.bbci.co.uk/news/rss.xml',
    'https://feeds.bbci.co.uk/news/uk/rss.xml',
    'https://www.theguardian.com/uk/rss',
    'https://feeds.skynews.com/feeds/rss/home.xml',
    'https://www.independent.co.uk/news/uk/rss',
  ],
  au: [
    'https://www.abc.net.au/news/feed/51120/rss.xml',
    'https://www.smh.com.au/rss/feed.xml',
    'https://www.theaustralian.com.au/feed/',
    'https://www.news.com.au/content-feeds/latest-news-national/',
  ],
  de: [
    'https://www.dw.com/en/top-stories/s-9097/rss',
    'https://rss.spiegel.de/spiegel/international',
    'https://www.thelocal.de/feed/',
  ],
  sg: [
    'https://www.straitstimes.com/news/singapore/rss.xml',
    'https://www.channelnewsasia.com/rssfeeds/8395884',
  ],
  ae: [
    'https://gulfnews.com/rss',
    'https://www.thenationalnews.com/rss',
    'https://www.khaleejtimes.com/rss',
  ],
  jp: [
    'https://www.japantimes.co.jp/feed/',
    'https://www3.nhk.or.jp/rss/news/cat0.xml',
  ],
};

// Category-specific feeds (supplement country feeds)
const CATEGORY_FEEDS = {
  technology: [
    'https://feeds.feedburner.com/TechCrunch',
    'https://www.theverge.com/rss/index.xml',
    'https://feeds.arstechnica.com/arstechnica/index',
  ],
  business: [
    'https://feeds.reuters.com/reuters/businessNews',
    'https://feeds.bloomberg.com/markets/news.rss',
  ],
  sports: [
    'https://feeds.bbci.co.uk/sport/rss.xml',
    'https://www.espn.com/espn/rss/news',
  ],
  science: [
    'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
    'https://www.sciencedaily.com/rss/top/science.xml',
  ],
};

// ── Simple RSS XML parser ─────────────────────────────────────
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];

    const title = extractTag(item, 'title');
    const link  = extractTag(item, 'link') || extractAttr(item, 'link', 'href');
    const desc  = extractTag(item, 'description') || extractTag(item, 'summary');
    const pubDate = extractTag(item, 'pubDate') || extractTag(item, 'published') || extractTag(item, 'updated');
    const enclosure = extractAttr(item, 'enclosure', 'url') || extractAttr(item, 'media:content', 'url');

    if (title && link) {
      items.push({
        title:       cleanText(title),
        url:         link.trim(),
        description: cleanText(desc),
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        image:       enclosure || null,
      });
    }
  }

  return items;
}

function extractTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function extractAttr(xml, tag, attr) {
  const regex = new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, 'i');
  const match = xml.match(regex);
  return match ? match[1] : null;
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Quality filter ────────────────────────────────────────────
function isGoodArticle(item) {
  if (!item.title || item.title.length < 15) return false;
  if (/^\d{6}-[A-Z]/.test(item.title)) return false;
  if (/\[image \d+/i.test(item.title)) return false;
  const words = item.title.split(' ').filter(w => /[a-zA-Z]{3,}/.test(w));
  if (words.length < 3) return false;
  return true;
}

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const {
    country  = 'us',
    category = 'general',
    max      = 20,
  } = request.query;

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const supabase          = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Cache key — RSS cached for 20 minutes
  const cacheKey = `rss-${country}-${category}`;

  // Check cache
  try {
    const { data: cached } = await supabase
      .from('news_cache')
      .select('articles, fetched_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();
    if (cached && cached.articles?.length > 0) {
      return response.status(200).json({
        success: true, fromCache: true,
        totalArticles: cached.articles.length,
        articles: cached.articles,
      });
    }
  } catch (e) {}

  try {
    // Pick feeds — country feeds + category feeds if specified
    const countryFeedUrls  = COUNTRY_FEEDS[country]  || COUNTRY_FEEDS.us;
    const categoryFeedUrls = CATEGORY_FEEDS[category] || [];

    // Use category feeds for non-general, country feeds for general
    const feedUrls = category !== 'general'
      ? [...categoryFeedUrls, ...countryFeedUrls.slice(0, 2)]
      : countryFeedUrls;

    // Fetch all feeds in parallel with timeout
    const feedResults = await Promise.allSettled(
      feedUrls.slice(0, 5).map(async url => {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Verityn News Bot 1.0' },
          signal:  AbortSignal.timeout(4000),
        });
        const xml = await res.text();
        return { url, items: parseRSS(xml) };
      })
    );

    // Collect source name from URL
    const getSourceName = url => {
      try {
        const host = new URL(url).hostname.replace('www.', '').replace('feeds.', '');
        const map = {
          'thehindu.com': 'The Hindu',
          'timesofindia.indiatimes.com': 'Times of India',
          'ndtvnews': 'NDTV',
          'indianexpress.com': 'Indian Express',
          'hindustantimes.com': 'Hindustan Times',
          'livemint.com': 'Mint',
          'economictimes': 'Economic Times',
          'npr.org': 'NPR',
          'cnn.com': 'CNN',
          'nbcnews.com': 'NBC News',
          'abcnews.go.com': 'ABC News',
          'washingtonpost.com': 'Washington Post',
          'nytimes.com': 'New York Times',
          'reuters.com': 'Reuters',
          'bbci.co.uk': 'BBC',
          'bbc.co.uk': 'BBC',
          'theguardian.com': 'The Guardian',
          'skynews.com': 'Sky News',
          'independent.co.uk': 'The Independent',
          'abc.net.au': 'ABC Australia',
          'smh.com.au': 'Sydney Morning Herald',
          'dw.com': 'Deutsche Welle',
          'spiegel.de': 'Der Spiegel',
          'straitstimes.com': 'The Straits Times',
          'channelnewsasia.com': 'Channel News Asia',
          'gulfnews.com': 'Gulf News',
          'thenationalnews.com': 'The National',
          'japantimes.co.jp': 'Japan Times',
          'nhk.or.jp': 'NHK World',
          'techcrunch.com': 'TechCrunch',
          'theverge.com': 'The Verge',
          'arstechnica.com': 'Ars Technica',
          'bloomberg.com': 'Bloomberg',
          'espn.com': 'ESPN',
          'sciencedaily.com': 'Science Daily',
        };
        for (const [key, name] of Object.entries(map)) {
          if (host.includes(key)) return name;
        }
        return host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1);
      } catch { return 'News'; }
    };

    // Merge all articles
    const allItems = [];
    for (const result of feedResults) {
      if (result.status === 'fulfilled' && result.value.items) {
        const sourceName = getSourceName(result.value.url);
        result.value.items.forEach(item => {
          allItems.push({ ...item, sourceName });
        });
      }
    }

    // Filter quality
    const filtered = allItems.filter(isGoodArticle);

    // Deduplicate by title similarity
    const seen    = new Set();
    const deduped = filtered.filter(item => {
      const key = item.title.slice(0, 50).toLowerCase().replace(/[^a-z]/g, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by recency
    deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // Transform to Verityn format
    const TOPIC_MAP  = { general:'world', technology:'tech', business:'finance', sports:'sports', science:'climate' };
    const LABEL_MAP  = { general:'World', technology:'Tech', business:'Finance', sports:'Sports', science:'Climate' };

    const articles = deduped.slice(0, parseInt(max)).map((item, i) => ({
      id:          `rss-${country}-${category}-${i}-${Date.now()}`,
      headline:    item.title,
      summary:     item.description || '',
      source:      item.sourceName,
      sourceUrl:   item.url,
      image:       item.image,
      publishedAt: item.publishedAt,
      time:        getRelativeTime(item.publishedAt),
      topic:       TOPIC_MAP[category] || 'world',
      topicLabel:  LABEL_MAP[category] || 'World',
      breaking:    isBreaking(item.publishedAt),
      country:     country.toUpperCase(),
      velocity:    i < 3 ? { label: '🔥 Top story', level: 'high' } : { label: '↑ Trending', level: 'med' },
      sourceCount: 1,
      bookmarked:  false,
    }));

    // Cache for 20 minutes
    await supabase.from('news_cache').upsert({
      cache_key:  cacheKey,
      articles,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      velocity_level: 'med',
    }, { onConflict: 'cache_key' });

    return response.status(200).json({
      success: true, fromCache: false,
      country: country.toUpperCase(), category,
      totalArticles: articles.length,
      feedsFetched: feedResults.filter(r => r.status === 'fulfilled').length,
      articles,
    });

  } catch (error) {
    return response.status(500).json({ error: 'RSS fetch failed.', details: error.message });
  }
};

function getRelativeTime(d) {
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  const h = Math.floor(m / 60);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isBreaking(d) {
  return (Date.now() - new Date(d)) / 60000 < 30;
}
