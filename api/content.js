// ============================================================
// FILE: api/content.js
// REPLACES: news.js, rss.js, search.js, image.js
// ROUTE via: ?action=news | rss | search | image
// ============================================================

const { createClient } = require('@supabase/supabase-js');

// ── Shared helpers ────────────────────────────────────────────

function inferTopic(headline, description) {
  const text = ((headline || '') + ' ' + (description || '')).toLowerCase();
  if (/\btech\b|\bai\b|\bsoftware\b|\bdigital\b|\bcyber\b|\bstartup\b|\binternet\b|\bsilicon\b|\bgoogle\b|\bapple\b|\bmicrosoft\b|\bmeta\b|\bopenai\b/.test(text))
    return { topic: 'tech',     label: 'Tech'     };
  if (/\beconomy\b|\bmarket\b|\bbank\b|\binflation\b|\bfinance\b|\btrade\b|\bstock\b|\bgdp\b|\brupee\b|\beuro\b|\bdollar\b|\bsensex\b|\bnifty\b|\bdax\b|\binvestment\b|\bfed\b|\brbi\b/.test(text))
    return { topic: 'finance',  label: 'Finance'  };
  if (/\belection\b|\bparliament\b|\bminister\b|\bgovernment\b|\bvote\b|\bpolicy\b|\bparty\b|\bpolitical\b|\bpresident\b|\bcongress\b|\bsenate\b/.test(text))
    return { topic: 'politics', label: 'Politics' };
  if (/\bfootball\b|\bcricket\b|\bmatch\b|\bleague\b|\btournament\b|\bplayer\b|\bteam\b|\bgoal\b|\bsport\b|\bolympic\b|\bipl\b|\bnba\b|\bnfl\b|\bfifa\b/.test(text))
    return { topic: 'sports',   label: 'Sports'   };
  if (/\bclimate\b|\benergy\b|\brenewable\b|\bemission\b|\benvironment\b|\bsolar\b|\bgreen\b|\bcarbon\b|\bweather\b/.test(text))
    return { topic: 'climate',  label: 'Climate'  };
  return { topic: 'world', label: 'World' };
}

function getRelativeTime(d) {
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  const h = Math.floor(m / 60);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&apos;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => { try { return String.fromCharCode(parseInt(hex, 16)); } catch { return ''; } })
    .replace(/&#(\d+);/g, (_, dec) => { try { return String.fromCharCode(parseInt(dec)); } catch { return ''; } })
    .replace(/\s+/g, ' ').trim();
}

// ── RSS feeds per country ─────────────────────────────────────
const COUNTRY_FEEDS = {
  in: [
    'https://www.thehindu.com/news/feeder/default.rss',
    'https://feeds.ndtv.com/ndtvnews-top-stories',
    'https://indianexpress.com/feed/',
    'https://economictimes.indiatimes.com/rssfeedstopstories.cms',
    'https://www.hindustantimes.com/rss/topnews/rssfeed.xml',
  ],
  us: [
    'https://feeds.npr.org/1001/rss.xml',
    'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    'https://feeds.washingtonpost.com/rss/national',
    'https://feeds.reuters.com/reuters/topNews',
    'https://feeds.apnews.com/rss/apf-topnews',
  ],
  gb: [
    'https://feeds.bbci.co.uk/news/rss.xml',
    'https://www.theguardian.com/world/rss',
    'https://feeds.reuters.com/reuters/UKTopNews',
  ],
  de: [
    'https://rss.dw.com/xml/rss-en-all',
    'https://www.thelocal.de/feed/',
    'https://www.spiegel.de/international/index.rss',
    'https://www.euronews.com/rss?format=mrss&level=theme&name=news',
  ],
  au: [
    'https://www.abc.net.au/news/feed/51120/rss.xml',
    'https://www.smh.com.au/rss/feed.xml',
  ],
  sg: [
    'https://www.straitstimes.com/news/singapore/rss.xml',
    'https://www.channelnewsasia.com/rssfeeds/8395884',
  ],
  ae: [
    'https://gulfnews.com/rss',
    'https://www.thenationalnews.com/rss',
    'https://www.aljazeera.com/xml/rss/all.xml',
  ],
  jp: [
    'https://www.japantimes.co.jp/feed/',
    'https://www3.nhk.or.jp/rss/news/cat0.xml',
  ],
  ca: ['https://www.theglobeandmail.com/arc/outboundfeeds/rss/'],
  fr: [
    'https://www.france24.com/en/rss',
    'https://www.euronews.com/rss?format=mrss&level=theme&name=news',
  ],
  za: ['https://www.dailymaverick.co.za/feed/'],
  br: ['https://www.bbc.com/portuguese/topics/c2lef194ex8t'],
};

const BAD_SOURCES = ['news', 'unknown', 'feedburner', ''];

// ── Unsplash topic map ────────────────────────────────────────
const UNSPLASH_TOPICS = {
  tech: 'technology computer digital', finance: 'business finance market',
  politics: 'government parliament city', sports: 'sports stadium',
  climate: 'nature environment', world: 'city skyline travel',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || 'news';

  // ── ACTION: news ──────────────────────────────────────────────
  if (action === 'news') {
    const GNEWS_KEY = process.env.GNEWS_API_KEY;
    const MEDIASTACK = process.env.MEDIASTACK_KEY;
    const { country = 'us', category = 'general', max = '10' } = req.query;

    const TOPIC_MAP  = { general:'world', technology:'tech', business:'finance', sports:'sports', science:'climate' };
    const LABEL_MAP  = { general:'World', technology:'Tech', business:'Finance', sports:'Sports', science:'Climate' };
    const COUNTRY_SOURCES = {
      in: ['the-hindu','ndtv','times-of-india'],
      us: ['the-new-york-times','cnn','npr'],
      gb: ['bbc-news','the-guardian-uk'],
      de: ['der-tagesspiegel','spiegel-online'],
      au: ['abc-news-au'], sg: [], ae: [], jp: ['google-news-jp'],
    };

    const NYT_KEY      = process.env.NYT_API_KEY;
    const GUARDIAN_KEY = process.env.GUARDIAN_API_KEY;

    try {
      const fetches = [];

      // GNews
      if (GNEWS_KEY) {
        fetches.push(
          fetch(`https://gnews.io/api/v4/top-headlines?category=${category}&lang=en&country=${country}&max=${max}&apikey=${GNEWS_KEY}`)
            .then(r => r.json()).then(d => ({ src: 'gnews', data: d })).catch(() => ({ src: 'gnews', data: {} }))
        );
      }

      // Mediastack — improved with category support
      if (MEDIASTACK) {
        const sources = COUNTRY_SOURCES[country]?.join(',') || '';
        const msUrl = sources
          ? `http://api.mediastack.com/v1/news?access_key=${MEDIASTACK}&sources=${sources}&languages=en&limit=8`
          : `http://api.mediastack.com/v1/news?access_key=${MEDIASTACK}&countries=${country}&languages=en&limit=8`;
        fetches.push(fetch(msUrl).then(r => r.json()).then(d => ({ src: 'ms', data: d })).catch(() => ({ src: 'ms', data: {} })));
      }

      // NYT Top Stories API (free, high quality, full abstracts + images)
      if (NYT_KEY) {
        const nytSection = category === 'technology' ? 'technology' : category === 'business' ? 'business' : category === 'science' ? 'science' : category === 'sports' ? 'sports' : 'world';
        fetches.push(
          fetch(`https://api.nytimes.com/svc/topstories/v2/${nytSection}.json?api-key=${NYT_KEY}`)
            .then(r => r.json()).then(d => ({ src: 'nyt', data: d })).catch(() => ({ src: 'nyt', data: {} }))
        );
      }

      // Guardian API (free, full trail text + images)
      if (GUARDIAN_KEY) {
        const gSection = category === 'technology' ? 'technology' : category === 'business' ? 'business' : category === 'sports' ? 'sport' : 'world';
        fetches.push(
          fetch(`https://content.guardianapis.com/${gSection}?api-key=${GUARDIAN_KEY}&show-fields=trailText,thumbnail&page-size=10&lang=en`)
            .then(r => r.json()).then(d => ({ src: 'guardian', data: d })).catch(() => ({ src: 'guardian', data: {} }))
        );
      }

      const results = await Promise.all(fetches);
      const articles = [];

      for (const result of results) {
        const { src, data } = result;
        if (!src || !data) continue;

        if (src === 'gnews' && data?.articles) {
          for (const a of data.articles) {
            const t = inferTopic(a.title, a.description);
            // Filter out low-quality lifestyle/celebrity/sports from GNews
            const skipPatterns = /taylor swift|kardashian|celebrity|red carpet|nfl draft|nba trade|iheartradio|oscars|emmys|grammys|recipe|horoscope|zodiac|best buy|sale deal|review.*car|suv reveal/i;
            if (skipPatterns.test(a.title)) continue;
            articles.push({
              id: `gnews-${country}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
              headline: cleanText(a.title), summary: cleanText(a.description || ''),
              source: a.source?.name || 'Unknown', sourceUrl: a.url,
              image: a.image || null, publishedAt: a.publishedAt,
              time: getRelativeTime(a.publishedAt),
              topic: t.topic, topicLabel: t.label,
              country: country.toUpperCase(), sourceCount: 1,
            });
          }
        }

        if (src === 'ms' && data?.data) {
          for (const a of data.data) {
            const t = inferTopic(a.title, a.description);
            articles.push({
              id: `ms-${country}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
              headline: cleanText(a.title), summary: cleanText(a.description || ''),
              source: a.source || 'Unknown', sourceUrl: a.url,
              image: null, publishedAt: a.published_at,
              time: getRelativeTime(a.published_at),
              topic: t.topic, topicLabel: t.label,
              country: country.toUpperCase(), sourceCount: 1,
            });
          }
        }

        if (src === 'nyt' && data?.results) {
          for (const a of (data.results || []).slice(0, 10)) {
            if (!a.title) continue;
            const t = inferTopic(a.title, a.abstract);
            const img = (a.multimedia || []).find(m => m.format === 'Super Jumbo' || m.format === 'threeByTwoSmallAt2X');
            articles.push({
              id: `nyt-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
              headline: cleanText(a.title), summary: cleanText(a.abstract || ''),
              source: 'New York Times', sourceUrl: a.url,
              image: img?.url || null, publishedAt: a.published_date,
              time: getRelativeTime(a.published_date),
              topic: t.topic, topicLabel: t.label,
              country: 'US', sourceCount: 1,
            });
          }
        }

        if (src === 'guardian' && data?.response?.results) {
          for (const a of data.response.results) {
            if (!a.webTitle) continue;
            const t = inferTopic(a.webTitle, a.fields?.trailText);
            articles.push({
              id: `guardian-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
              headline: cleanText(a.webTitle), summary: cleanText(a.fields?.trailText || ''),
              source: 'The Guardian', sourceUrl: a.webUrl,
              image: a.fields?.thumbnail || null, publishedAt: a.webPublicationDate,
              time: getRelativeTime(a.webPublicationDate),
              topic: t.topic, topicLabel: t.label,
              country: country.toUpperCase(), sourceCount: 1,
            });
          }
        }
      }
      // Dedup by headline
      const seen = new Set();
      const deduped = articles.filter(a => {
        const k = a.headline?.slice(0, 50).toLowerCase().replace(/[^a-z]/g, '');
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
      });

      return res.status(200).json({ success: true, articles: deduped });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── ACTION: rss ───────────────────────────────────────────────
  if (action === 'rss') {
    const { country = 'us', max = '15' } = req.query;
    const feeds = COUNTRY_FEEDS[country] || COUNTRY_FEEDS['us'];

    try {
      const results = await Promise.all(
        feeds.map(url =>
          fetch(url, { 
            headers: { 
              'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
              'Accept': 'application/rss+xml, application/xml, text/xml, */*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Cache-Control': 'no-cache',
            },
            signal: AbortSignal.timeout(8000),
          })
            .then(r => r.text())
            .catch(() => '')
        )
      );

      const articles = [];
      for (let fi = 0; fi < results.length; fi++) {
        const xml = results[fi];
        if (!xml) continue;
        const items = xml.match(/<item[\s\S]*?<\/item>/g) || [];
        for (const item of items) {
          const title       = cleanText((item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]);
          const link        = ((item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
          // Try content:encoded first (full abstract), fall back to description
          const rawEncoded   = (item.match(/<content:encoded>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/) || [])[1] || '';
          const rawDesc_     = (item.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || '';
          // Prefer content:encoded if it exists and is longer
          const rawBest      = rawEncoded.length > rawDesc_.length ? rawEncoded : rawDesc_;
          const cleanedDesc_ = cleanText(rawBest);
          // Discard if cleaned result is still HTML-like
          const description  = /^<[a-z]/i.test(cleanedDesc_.trim()) ? '' : cleanedDesc_;
          const pubDate     = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
          const sourceName  = cleanText((item.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || feeds[fi].replace(/https?:\/\/(www\.)?/, '').split('/')[0]);
          const imgMatch    = item.match(/url="([^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i) ||
                              item.match(/<media:content[^>]+url="([^"]+)"/i) ||
                              item.match(/src="([^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i);
          const image       = imgMatch ? imgMatch[1] : null;
          if (!title || title.length < 15) continue;
          if (/<[a-z]/i.test(title)) continue;
          if (BAD_SOURCES.includes(sourceName.toLowerCase().trim())) continue;
          const pub = pubDate ? new Date(pubDate) : new Date();
          if (isNaN(pub.getTime())) continue;
          const ageHours = (Date.now() - pub) / 3600000;
          if (ageHours > 72) continue;
          const t = inferTopic(title, description);
          articles.push({
            id: `rss-${country}-${fi}-${articles.length}-${Date.now()}`,
            headline: title, summary: description || '',
            source: sourceName, sourceUrl: link,
            image, publishedAt: pub.toISOString(),
            time: getRelativeTime(pub),
            topic: t.topic, topicLabel: t.label,
            country: country.toUpperCase(), sourceCount: 1,
          });
        }
      }

      const seen = new Set();
      const deduped = articles
        .filter(a => {
          const k = a.headline.slice(0, 60).toLowerCase().replace(/[^a-z0-9]/g, '');
          if (seen.has(k)) return false;
          seen.add(k); return true;
        })
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
        .slice(0, parseInt(max));

      return res.status(200).json({ success: true, articles: deduped });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── ACTION: search — RSS-based, no quota consumed ────────────
  if (action === 'search') {
    const { q = '', country = 'us', max = '30' } = req.query;
    if (!q.trim()) return res.status(400).json({ error: 'Query required.' });

    const terms = q.toLowerCase().trim().split(/\s+/).filter(t => t.length > 2);
    if (!terms.length) return res.status(400).json({ error: 'Query too short.' });

    // Search across major RSS feeds — broad coverage, no quota
    const SEARCH_FEEDS = [
      'https://feeds.bbci.co.uk/news/rss.xml',
      'https://www.theguardian.com/world/rss',
      'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
      'https://rss.dw.com/xml/rss-en-all',
      'https://feeds.npr.org/1001/rss.xml',
      'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms',
      'https://indianexpress.com/feed/',
      'https://www.thehindu.com/news/feeder/default.rss',
      'https://feeds.washingtonpost.com/rss/national',
      'https://www.smh.com.au/rss/feed.xml',
      'https://www.straitstimes.com/news/singapore/rss.xml',
    ];

    // Add country-specific feeds
    const COUNTRY_FEEDS_EXTRA = {
      in: ['https://feeds.feedburner.com/ndtvnews-top-stories'],
      de: ['https://www.thelocal.de/feed/'],
      au: ['https://www.abc.net.au/news/feed/51120/rss.xml'],
      gb: ['https://feeds.bbci.co.uk/news/uk/rss.xml'],
      ae: ['https://gulfnews.com/rss'],
      jp: ['https://www.japantimes.co.jp/feed/'],
    };
    const extraFeeds = COUNTRY_FEEDS_EXTRA[country] || [];
    const allFeeds = [...new Set([...SEARCH_FEEDS, ...extraFeeds])];

    try {
      // Fetch all feeds in parallel
      const feedResults = await Promise.all(
        allFeeds.map(url =>
          fetch(url, { 
            headers: { 
              'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
              'Accept': 'application/rss+xml, application/xml, text/xml, */*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Cache-Control': 'no-cache',
            },
            signal: AbortSignal.timeout(8000),
          })
            .then(r => r.text())
            .catch(() => '')
        )
      );

      const articles = [];
      for (let fi = 0; fi < feedResults.length; fi++) {
        const xml = feedResults[fi];
        if (!xml) continue;
        const items = xml.match(/<item[\s\S]*?<\/item>/g) || [];
        for (const item of items) {
          const title = cleanText((item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]);
          const desc  = cleanText((item.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1]);
          const link  = ((item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
          const pub   = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
          const imgM  = item.match(/url="([^"]+\.(jpg|jpeg|png|webp)[^"]*)"/) ||
                        item.match(/<media:content[^>]+url="([^"]+)"/);
          const image = imgM ? imgM[1] : null;

          if (!title || title.length < 10) continue;

          // Match against search terms — headline OR description must contain term
          const searchText = (title + ' ' + desc).toLowerCase();
          const matches = terms.every(term => searchText.includes(term));
          if (!matches) continue;

          const pubDate = pub ? new Date(pub) : new Date();
          if (isNaN(pubDate.getTime())) continue;
          // Only last 7 days
          if ((Date.now() - pubDate) > 7 * 24 * 60 * 60 * 1000) continue;

          // Get source name from feed URL
          const feedDomain = allFeeds[fi].replace(/https?:\/\/(www\.)?/, '').split('/')[0];
          const sourceMap = {
            'feeds.bbci.co.uk': 'BBC News', 'bbc.co.uk': 'BBC News',
            'theguardian.com': 'The Guardian',
            'rss.nytimes.com': 'New York Times',
            'rss.dw.com': 'Deutsche Welle',
            'feeds.npr.org': 'NPR',
            'timesofindia.indiatimes.com': 'Times of India',
            'indianexpress.com': 'Indian Express',
            'thehindu.com': 'The Hindu',
            'feeds.washingtonpost.com': 'Washington Post',
            'smh.com.au': 'Sydney Morning Herald',
            'straitstimes.com': 'Straits Times',
            'feeds.feedburner.com': 'NDTV',
            'thelocal.de': 'The Local',
            'abc.net.au': 'ABC Australia',
            'gulfnews.com': 'Gulf News',
            'japantimes.co.jp': 'Japan Times',
          };
          const sourceName = sourceMap[feedDomain] || feedDomain.split('.')[0];

          const t = inferTopic(title, desc);
          articles.push({
            id: `search-${fi}-${articles.length}`,
            headline: title,
            summary: /^<[a-z]/i.test(desc.trim()) ? '' : desc,
            source: sourceName,
            sourceUrl: link,
            image,
            publishedAt: pubDate.toISOString(),
            time: getRelativeTime(pubDate),
            topic: t.topic,
            topicLabel: t.label,
            country: country.toUpperCase(),
          });
        }
      }

      // Dedup + sort by recency
      const seen = new Set();
      const deduped = articles
        .filter(a => {
          const k = a.headline.slice(0, 60).toLowerCase().replace(/[^a-z0-9]/g, '');
          if (seen.has(k)) return false;
          seen.add(k); return true;
        })
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
        .slice(0, parseInt(max));

      return res.status(200).json({ success: true, articles: deduped, source: 'rss' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── ACTION: image ─────────────────────────────────────────────
  if (action === 'image') {
    const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
    const { topic = 'world', country = 'us' } = req.query;

    if (!UNSPLASH_KEY) return res.status(500).json({ error: 'Unsplash not configured' });

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const cacheKey = `image-${topic}-${country}`;

    try {
      const { data: cached } = await supabase
        .from('digest_cache').select('digest')
        .eq('cache_key', cacheKey)
        .gt('expires_at', new Date().toISOString())
        .single();
      if (cached?.digest?.imageUrl) {
        return res.status(200).json({ imageUrl: cached.digest.imageUrl });
      }
    } catch (e) {}

    try {
      const query = UNSPLASH_TOPICS[topic] || 'news world';
      const r = await fetch(
        `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape&client_id=${UNSPLASH_KEY}`
      );
      const data = await r.json();
      const imageUrl = data?.urls?.regular || data?.urls?.small || null;
      if (imageUrl) {
        try {
          await supabase.from('digest_cache').upsert({
            cache_key: cacheKey, digest: { imageUrl },
            fetched_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
          }, { onConflict: 'cache_key' });
        } catch (e) {}
      }
      return res.status(200).json({ imageUrl });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: `Unknown action: ${action}. Use: news | rss | search | image` });
};
