// ============================================================
// FILE: api/rss.js
// PURPOSE: Fetches RSS feeds per country
//          Falls back to GNews search when RSS returns nothing
// ============================================================

const { createClient } = require('@supabase/supabase-js');

// ── RSS feeds per country ─────────────────────────────────────
const COUNTRY_FEEDS = {
  in: [
    'https://www.thehindu.com/news/feeder/default.rss',
    'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
    'https://indianexpress.com/feed/',
    'https://www.hindustantimes.com/feeds/rss/topnews/rssfeed.xml',
    'https://www.livemint.com/rss/news',
    'https://economictimes.indiatimes.com/rssfeedsdefault.cms',
    'https://feeds.feedburner.com/ndtvnews-top-stories',
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
  // For countries with limited English RSS — use DW + Reuters + BBC World
  // These cover the country in English reliably
  de: [
    'https://rss.dw.com/xml/rss-en-ger',
    'https://rss.dw.com/xml/rss-en-all',
    'https://www.thelocal.de/feed/',
    'https://feeds.bbci.co.uk/news/world/europe/rss.xml',
  ],
  sg: [
    'https://www.straitstimes.com/news/singapore/rss.xml',
    'https://www.channelnewsasia.com/rssfeeds/8395884',
    'https://feeds.bbci.co.uk/news/world/asia/rss.xml',
  ],
  ae: [
    'https://www.thenationalnews.com/rss',
    'https://gulfnews.com/rss',
    'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml',
  ],
  jp: [
    'https://www.japantimes.co.jp/feed/',
    'https://www3.nhk.or.jp/rss/news/cat0.xml',
    'https://feeds.bbci.co.uk/news/world/asia/rss.xml',
  ],
};

const CATEGORY_FEEDS = {
  technology: [
    'https://feeds.feedburner.com/TechCrunch',
    'https://www.theverge.com/rss/index.xml',
    'https://feeds.arstechnica.com/arstechnica/index',
    'https://feeds.bbci.co.uk/news/technology/rss.xml',
  ],
  business: [
    'https://feeds.reuters.com/reuters/businessNews',
    'https://feeds.bbci.co.uk/news/business/rss.xml',
  ],
  sports: [
    'https://feeds.bbci.co.uk/sport/rss.xml',
  ],
  science: [
    'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
    'https://www.sciencedaily.com/rss/top/science.xml',
  ],
};

// ── Simple RSS XML parser ─────────────────────────────────────
function parseRSS(xml) {
  const items      = [];
  const itemRegex  = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let match;

  // Try <item> (RSS 2.0)
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = parseItem(match[1]);
    if (item) items.push(item);
  }

  // Try <entry> (Atom)
  if (items.length === 0) {
    while ((match = entryRegex.exec(xml)) !== null) {
      const item = parseItem(match[1]);
      if (item) items.push(item);
    }
  }

  return items;
}

function parseItem(item) {
  const title = extractTag(item, 'title');
  if (!title || title.length < 10) return null;

  // Try multiple link formats
  let link = extractTag(item, 'link');
  if (!link || link.trim() === '') {
    link = extractAttr(item, 'link', 'href');
  }
  if (!link || link.includes('<') || link.trim() === '') return null;

  const desc    = extractTag(item, 'description') ||
                  extractTag(item, 'summary')      ||
                  extractTag(item, 'content');
  const pubDate = extractTag(item, 'pubDate')   ||
                  extractTag(item, 'published')  ||
                  extractTag(item, 'updated')    ||
                  extractTag(item, 'dc:date');

  // Image: try enclosure, media:content, media:thumbnail, og:image
  const image   = extractAttr(item, 'enclosure', 'url')        ||
                  extractAttr(item, 'media:content', 'url')     ||
                  extractAttr(item, 'media:thumbnail', 'url')   ||
                  extractTagAttr(item, 'media:content', 'url');

  return {
    title:       cleanText(title),
    url:         link.trim(),
    description: cleanText(desc),
    publishedAt: pubDate ? safeDate(pubDate) : new Date().toISOString(),
    image:       image || null,
  };
}

function extractTag(xml, tag) {
  // Handle CDATA and regular content
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[[\\s\\S]*?\\]\\]><\\/${tag}>`, 'i'),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'),
  ];
  for (const re of patterns) {
    const m = xml.match(re);
    if (m) {
      return m[0]
        .replace(new RegExp(`^<${tag}[^>]*>`, 'i'), '')
        .replace(new RegExp(`<\\/${tag}>$`, 'i'), '')
        .replace(/^<!\[CDATA\[/, '')
        .replace(/\]\]>$/, '')
        .trim();
    }
  }
  return null;
}

function extractAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, 'i');
  const m  = xml.match(re);
  return m ? m[1] : null;
}

function extractTagAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}\\s[^>]*${attr}=["']([^"']+)["']`, 'i');
  const m  = xml.match(re);
  return m ? m[1] : null;
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,   '&')
    .replace(/&lt;/g,    '<')
    .replace(/&gt;/g,    '>')
    .replace(/&quot;/g,  '"')
    .replace(/&#39;/g,   "'")
    .replace(/&nbsp;/g,  ' ')
    .replace(/&#\d+;/g,  c => {
      try { return String.fromCharCode(parseInt(c.match(/\d+/)[0])); } catch { return ''; }
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function safeDate(str) {
  try {
    const d = new Date(str);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch { return new Date().toISOString(); }
}

function isGoodArticle(item) {
  if (!item.title || item.title.length < 15) return false;
  if (/^\d{6}-[A-Z]/.test(item.title)) return false;
  if (/\[image \d+/i.test(item.title)) return false;
  if (item.title === '[Removed]') return false;
  const words = item.title.split(' ').filter(w => /[a-zA-Z]{3,}/.test(w));
  return words.length >= 3;
}

function getSourceName(url) {
  try {
    const host = new URL(url).hostname.replace('www.', '').replace('feeds.', '').replace('rss.', '');
    const map  = {
      'thehindu.com':            'The Hindu',
      'timesofindia.indiatimes': 'Times of India',
      'indianexpress.com':       'Indian Express',
      'hindustantimes.com':      'Hindustan Times',
      'livemint.com':            'Mint',
      'economictimes':           'Economic Times',
      'ndtvnews':                'NDTV',
      'npr.org':                 'NPR',
      'cnn.com':                 'CNN',
      'nbcnews.com':             'NBC News',
      'abcnews.go.com':          'ABC News',
      'washingtonpost.com':      'Washington Post',
      'nytimes.com':             'New York Times',
      'reuters.com':             'Reuters',
      'bbci.co.uk':              'BBC',
      'bbc.co.uk':               'BBC',
      'theguardian.com':         'The Guardian',
      'skynews.com':             'Sky News',
      'independent.co.uk':       'The Independent',
      'abc.net.au':              'ABC Australia',
      'smh.com.au':              'Sydney Morning Herald',
      'theaustralian.com.au':    'The Australian',
      'dw.com':                  'Deutsche Welle',
      'thelocal.de':             'The Local Germany',
      'straitstimes.com':        'The Straits Times',
      'channelnewsasia.com':     'Channel News Asia',
      'thenationalnews.com':     'The National',
      'gulfnews.com':            'Gulf News',
      'japantimes.co.jp':        'Japan Times',
      'nhk.or.jp':               'NHK World',
      'techcrunch.com':          'TechCrunch',
      'theverge.com':            'The Verge',
      'arstechnica.com':         'Ars Technica',
      'sciencedaily.com':        'Science Daily',
    };
    for (const [key, name] of Object.entries(map)) {
      if (host.includes(key)) return name;
    }
    const parts = host.split('.');
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  } catch { return 'News'; }
}

function getRelativeTime(d) {
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  const h = Math.floor(m / 60);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isBreaking(d) {
  return (Date.now() - new Date(d)) / 60000 < 30;
}

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const { country = 'us', category = 'general', max = 20 } = request.query;

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const GNEWS_API_KEY     = process.env.GNEWS_API_KEY;
  const supabase          = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const cacheKey          = `rss-${country}-${category}`;

  // Check cache (20 min TTL)
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
    const countryFeeds  = COUNTRY_FEEDS[country]   || COUNTRY_FEEDS.us;
    const categoryFeeds = CATEGORY_FEEDS[category] || [];
    const feedUrls      = category !== 'general'
      ? [...categoryFeeds, ...countryFeeds.slice(0, 2)]
      : countryFeeds;

    // Fetch all feeds in parallel with 5s timeout
    const feedResults = await Promise.allSettled(
      feedUrls.slice(0, 6).map(async url => {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Verityn/1.0 (news aggregator)' },
          signal:  AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        const items = parseRSS(xml);
        return { url, items };
      })
    );

    const allItems = [];
    let feedsFetched = 0;

    for (const result of feedResults) {
      if (result.status === 'fulfilled' && result.value.items?.length > 0) {
        feedsFetched++;
        const sourceName = getSourceName(result.value.url);
        result.value.items.forEach(item => {
          allItems.push({ ...item, sourceName });
        });
      }
    }

    // ── GNews fallback if RSS returns nothing ─────────────
    // This ensures Germany, Singapore, UAE always have content
    if (allItems.length < 5 && GNEWS_API_KEY) {
      try {
        const gnewsUrl  = `https://gnews.io/api/v4/top-headlines?category=${category}&lang=en&country=${country}&max=10&apikey=${GNEWS_API_KEY}`;
        const gnewsRes  = await fetch(gnewsUrl);
        const gnewsData = await gnewsRes.json();
        if (gnewsData.articles) {
          gnewsData.articles.forEach(a => {
            allItems.push({
              title:       a.title,
              url:         a.url,
              description: a.description,
              publishedAt: a.publishedAt,
              image:       a.image,
              sourceName:  a.source?.name || 'News',
            });
          });
        }
      } catch (e) {}
    }

    // Filter + deduplicate
    const filtered = allItems.filter(isGoodArticle);
    const seen     = new Set();
    const deduped  = filtered.filter(item => {
      const key = item.title.slice(0, 50).toLowerCase().replace(/[^a-z]/g, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    const TOPIC_MAP = { general:'world', technology:'tech', business:'finance', sports:'sports', science:'climate' };
    const LABEL_MAP = { general:'World', technology:'Tech', business:'Finance', sports:'Sports', science:'Climate' };

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
      velocity:    i < 3
        ? { label: '🔥 Top story', level: 'high' }
        : { label: '↑ Trending',   level: 'med'  },
      sourceCount: 1,
      bookmarked:  false,
    }));

    // Cache 20 minutes
    try {
      await supabase.from('news_cache').upsert({
        cache_key:      cacheKey,
        articles,
        fetched_at:     new Date().toISOString(),
        expires_at:     new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        velocity_level: 'med',
      }, { onConflict: 'cache_key' });
    } catch (e) {}

    return response.status(200).json({
      success:      true,
      fromCache:    false,
      country:      country.toUpperCase(),
      category,
      feedsFetched,
      totalArticles: articles.length,
      articles,
    });

  } catch (error) {
    return response.status(500).json({ error: 'RSS fetch failed.', details: error.message });
  }
};
