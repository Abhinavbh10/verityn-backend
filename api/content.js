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
    'https://feeds.feedburner.com/ndtvnews-top-stories',
    'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms',
    'https://indianexpress.com/feed/',
  ],
  us: [
    'https://feeds.npr.org/1001/rss.xml',
    'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    'https://feeds.washingtonpost.com/rss/national',
  ],
  gb: [
    'https://feeds.bbci.co.uk/news/rss.xml',
    'https://www.theguardian.com/world/rss',
  ],
  de: [
    'https://rss.dw.com/xml/rss-en-ger',
    'https://www.thelocal.de/feed/',
  ],
  au: [
    'https://www.abc.net.au/news/feed/51120/rss.xml',
    'https://www.smh.com.au/rss/feed.xml',
  ],
  sg: [
    'https://www.straitstimes.com/news/singapore/rss.xml',
    'https://www.channelnewsasia.com/rssfeeds/8395884',
  ],
  ae: ['https://gulfnews.com/rss', 'https://www.thenationalnews.com/rss'],
  jp: ['https://www.japantimes.co.jp/feed/'],
  ca: ['https://www.theglobeandmail.com/arc/outboundfeeds/rss/'],
  fr: ['https://www.france24.com/en/rss'],
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

    try {
      const fetches = [];
      if (GNEWS_KEY) {
        fetches.push(
          fetch(`https://gnews.io/api/v4/top-headlines?category=${category}&lang=en&country=${country}&max=${max}&apikey=${GNEWS_KEY}`)
            .then(r => r.json()).catch(() => ({}))
        );
      }
      if (MEDIASTACK) {
        const sources = COUNTRY_SOURCES[country]?.join(',') || '';
        const url = sources
          ? `http://api.mediastack.com/v1/news?access_key=${MEDIASTACK}&sources=${sources}&languages=en&limit=5`
          : `http://api.mediastack.com/v1/news?access_key=${MEDIASTACK}&countries=${country}&languages=en&limit=5`;
        fetches.push(fetch(url).then(r => r.json()).catch(() => ({})));
      }

      const [gnewsData, mediastackData] = await Promise.all(fetches);
      const articles = [];

      if (gnewsData?.articles) {
        for (const a of gnewsData.articles) {
          const t = inferTopic(a.title, a.description);
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
      if (mediastackData?.data) {
        for (const a of mediastackData.data) {
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
          fetch(url, { headers: { 'User-Agent': 'Verityn/1.0' } })
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
          const description = cleanText((item.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1]);
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

  // ── ACTION: search ────────────────────────────────────────────
  if (action === 'search') {
    const GNEWS_KEY  = process.env.GNEWS_API_KEY;
    const MEDIASTACK = process.env.MEDIASTACK_KEY;
    const { q = '', country = 'us', max = '20' } = req.query;
    if (!q.trim()) return res.status(400).json({ error: 'Query required.' });

    try {
      const fetches = [];
      if (GNEWS_KEY) {
        fetches.push(
          fetch(`https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=en&max=${max}&apikey=${GNEWS_KEY}`)
            .then(r => r.json()).catch(() => ({}))
        );
      }
      if (MEDIASTACK) {
        fetches.push(
          fetch(`http://api.mediastack.com/v1/news?access_key=${MEDIASTACK}&keywords=${encodeURIComponent(q)}&languages=en&limit=10`)
            .then(r => r.json()).catch(() => ({}))
        );
      }
      const [gnews, ms] = await Promise.all(fetches);
      const articles = [];

      for (const a of (gnews?.articles || [])) {
        const t = inferTopic(a.title, a.description);
        articles.push({
          id: `search-${Math.random().toString(36).slice(2)}`,
          headline: cleanText(a.title), summary: cleanText(a.description || ''),
          source: a.source?.name || 'Unknown', sourceUrl: a.url,
          image: a.image || null, publishedAt: a.publishedAt,
          time: getRelativeTime(a.publishedAt),
          topic: t.topic, topicLabel: t.label,
        });
      }
      for (const a of (ms?.data || [])) {
        const t = inferTopic(a.title, a.description);
        articles.push({
          id: `search-ms-${Math.random().toString(36).slice(2)}`,
          headline: cleanText(a.title), summary: cleanText(a.description || ''),
          source: a.source || 'Unknown', sourceUrl: a.url,
          image: null, publishedAt: a.published_at,
          time: getRelativeTime(a.published_at),
          topic: t.topic, topicLabel: t.label,
        });
      }

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
