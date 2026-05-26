// ============================================================
// FILE: api/content.js
// REPLACES: news.js, rss.js, search.js, image.js
// ROUTE via: ?action=news | rss | search | citynews | image
//
// CHANGE (2026-04-28): RSS feeds whose country key ends in
// `_local` (e.g. `de_local`) bypass the English-only filter.
// They are intended to be translated downstream by newsletter.js.
// Without this bypass, German headlines containing 2+ common
// words (der/die/das/und/ist/...) were being dropped at line ~409
// before they ever reached the translator. Result: zero local
// German news in the daily newsletter.
//
// CHANGE (2026-05-07): Added `citynews` action. Returns city-specific
// articles from The Local DE city feeds (Berlin/Munich/Hamburg/Frankfurt).
// Folded in here instead of a separate api file due to Vercel Hobby
// plan's 12-function limit. Each article tagged sourceCity. Caches 1h.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, logError } = require('./_helpers');

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
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
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
    'https://news.google.com/rss?hl=en&gl=IN&ceid=IN:en',
    'https://indianexpress.com/feed/',
    'https://economictimes.indiatimes.com/rssfeedstopstories.cms',
    'https://www.thehindu.com/news/feeder/default.rss',
    'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
    'https://www.business-standard.com/rss/latest.rss',
    'https://www.financialexpress.com/feed/',
    'https://www.livemint.com/rss/news',
    'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
    'https://www.moneycontrol.com/rss/latestnews.xml',
    'https://yourstory.com/feed',
    'https://entrackr.com/feed/',
    'https://www.ndtv.com/rss/top-stories',
    'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml',
  ],
  us: [
    'https://news.google.com/rss?hl=en&gl=US&ceid=US:en',
    'https://feeds.npr.org/1001/rss.xml',
    'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    'https://feeds.washingtonpost.com/rss/national',
    'https://feeds.reuters.com/reuters/topNews',
    'https://feeds.apnews.com/rss/apf-topnews',
  ],
  gb: [
    'https://news.google.com/rss?hl=en&gl=GB&ceid=GB:en',
    'https://feeds.bbci.co.uk/news/rss.xml',
    'https://www.theguardian.com/world/rss',
    'https://feeds.reuters.com/reuters/UKTopNews',
    'https://feeds.skynews.com/feeds/rss/home.xml',
    'https://www.independent.co.uk/news/rss',
    'https://www.ft.com/rss/home',
  ],
  de: [
    'https://news.google.com/rss/search?q=Germany+OR+Berlin+OR+Bundestag+OR+Scholz&hl=en&gl=DE&ceid=DE:en',
    'https://news.google.com/rss/search?q=German+economy+OR+Deutsche+OR+Lufthansa+OR+ECB&hl=en&gl=DE&ceid=DE:en',
    'https://rss.dw.com/xml/rss-en-ger',
    'https://rss.dw.com/xml/rss-en-all',
    'https://rss.dw.com/xml/rss-en-bus',
    'https://rss.dw.com/xml/rss-en-eu',
    'https://www.thelocal.de/feed/',
    'https://www.spiegel.de/international/index.rss',
    'https://www.euronews.com/tag/germany/feed',
    'https://www.politico.eu/feed/',
  ],
  de_local: [
    'https://www.tagesschau.de/index~rss2.xml',
    'https://www.tagesspiegel.de/contentexport/feed/home',
    'https://www.tagesspiegel.de/contentexport/feed/berlin',
    'https://rss.sueddeutsche.de/rss/Topthemen',
    'https://www.faz.net/rss/aktuell/',
    'https://www.handelsblatt.com/contentexport/feed/top',
    'https://www.berliner-zeitung.de/feed.xml',
    'https://www.spiegel.de/schlagzeilen/index.rss',
    'https://www.zeit.de/index',
  ],
  au: [
    'https://www.abc.net.au/news/feed/51120/rss.xml',
    'https://www.smh.com.au/rss/feed.xml',
    'https://www.sbs.com.au/news/feed',
    'https://www.skynews.com.au/feed',
    'https://www.news.com.au/feed',
    'https://www.afr.com/rss/feed.xml',
  ],
  sg: [
    'https://www.straitstimes.com/news/singapore/rss.xml',
    'https://www.channelnewsasia.com/rssfeeds/8395884',
    'https://www.businesstimes.com.sg/rss/all-news',
    'https://www.channelnewsasia.com/rssfeeds/8395744',
  ],
  ae: [
    'https://gulfnews.com/rss',
    'https://www.thenationalnews.com/rss',
    'https://www.aljazeera.com/xml/rss/all.xml',
  ],
  jp: [
    'https://www.japantimes.co.jp/feed/',
    'https://www3.nhk.or.jp/rss/news/cat0.xml',
    'https://asia.nikkei.com/rss/feed/nar',
    'https://japannews.yomiuri.co.jp/feed/',
  ],
};

const BAD_SOURCES = ['news', 'unknown', 'feedburner', ''];

// ── Non-Latin / CJK script detection ──
const NON_LATIN_SCRIPT = /[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

const GERMAN_MARKER = /\b(der|die|das|und|ist|für|mit|nicht|auch|sich|sind|wurde|werden|einen|einer|eines|schon|zwischen|während|beschlüsse|koalition|wirtschaft|regierung)\b/i;
const FRENCH_MARKER = /\b(les|des|une|est|sont|pour|dans|avec|cette|par|sur|aux|qui|ont|ses|mais|leur|selon|après|avant|lors|entre|plus|vers|peut|fait|été|très|tous|dont|sans|comme|depuis|nous|vous|aussi|deux|sous|encore|autre|même|chez|boucler|négociations|budgétaires|présidentielle|française)\b/i;
const SPANISH_MARKER = /\b(los|las|una|del|por|con|para|más|pero|como|está|son|han|fue|desde|entre|sobre|todo|esta|ese|otro|puede|tiene|también|según|después|durante)\b/i;
const ITALIAN_MARKER = /\b(gli|dei|della|delle|sono|una|per|con|che|dal|nel|alla|sulla|anche|dopo|questo|quella|stato|essere|hanno|quale|tutti|ogni|molto|ancora|sempre|fra|tra)\b/i;
const DUTCH_MARKER = /\b(het|een|van|voor|met|niet|ook|zijn|worden|naar|maar|heeft|werd|deze|meer|nog|aan|over|bij|uit|hun|tegen|alle|moet|kan|zou|veel|geen|wel|dan|alleen)\b/i;

function isEnglishHeadline(title) {
  if (!title) return false;
  if (NON_LATIN_SCRIPT.test(title)) return false;
  const germanHits = (title.match(new RegExp(GERMAN_MARKER.source, 'gi')) || []).length;
  if (germanHits >= 2) return false;
  const frenchHits = (title.match(new RegExp(FRENCH_MARKER.source, 'gi')) || []).length;
  if (frenchHits >= 2) return false;
  const spanishHits = (title.match(new RegExp(SPANISH_MARKER.source, 'gi')) || []).length;
  if (spanishHits >= 2) return false;
  const italianHits = (title.match(new RegExp(ITALIAN_MARKER.source, 'gi')) || []).length;
  if (italianHits >= 2) return false;
  const dutchHits = (title.match(new RegExp(DUTCH_MARKER.source, 'gi')) || []).length;
  if (dutchHits >= 2) return false;
  return true;
}

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

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const supabase     = createClient(SUPABASE_URL, SUPABASE_KEY);
  const sessionId    = req.query.sessionId || req.body?.sessionId || 'anonymous';

  const action = req.query.action || 'news';

  // ── ACTION: news ──────────────────────────────────────────────
  if (action === 'news') {
    const rl = await checkRateLimit(supabase, sessionId, 'gnews');
    if (!rl.allowed) return res.status(429).json({ error: 'Rate limit exceeded. Try again later.', resetAt: rl.resetAt });

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

      if (GNEWS_KEY) {
        fetches.push(
          fetch(`https://gnews.io/api/v4/top-headlines?category=${category}&lang=en&country=${country}&max=${max}&apikey=${GNEWS_KEY}`)
            .then(r => r.json()).then(d => ({ src: 'gnews', data: d })).catch(() => ({ src: 'gnews', data: {} }))
        );
      }

      if (MEDIASTACK) {
        const sources = COUNTRY_SOURCES[country]?.join(',') || '';
        const msUrl = sources
          ? `http://api.mediastack.com/v1/news?access_key=${MEDIASTACK}&sources=${sources}&languages=en&limit=8`
          : `http://api.mediastack.com/v1/news?access_key=${MEDIASTACK}&countries=${country}&languages=en&limit=8`;
        fetches.push(fetch(msUrl).then(r => r.json()).then(d => ({ src: 'ms', data: d })).catch(() => ({ src: 'ms', data: {} })));
      }

      const NYT_COUNTRIES = ['us', 'gb', 'au', 'in'];
      if (NYT_KEY && NYT_COUNTRIES.includes(country)) {
        const nytSection = category === 'technology' ? 'technology' : category === 'business' ? 'business' : category === 'science' ? 'science' : category === 'sports' ? 'sports' : 'world';
        fetches.push(
          fetch(`https://api.nytimes.com/svc/topstories/v2/${nytSection}.json?api-key=${NYT_KEY}`)
            .then(r => r.json()).then(d => ({ src: 'nyt', data: d })).catch(() => ({ src: 'nyt', data: {} }))
        );
      }

      const GUARDIAN_COUNTRIES = ['gb', 'us', 'au', 'in'];
      if (GUARDIAN_KEY && GUARDIAN_COUNTRIES.includes(country)) {
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
            const skipPatterns = /taylor swift|kardashian|celebrity|red carpet|nfl draft|nba trade|iheartradio|oscars|emmys|grammys|recipe|horoscope|zodiac|best buy|sale deal|review.*car|suv reveal/i;
            if (skipPatterns.test(a.title)) continue;
            if (!isEnglishHeadline(a.title)) continue;
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
            if (!isEnglishHeadline(a.title)) continue;
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
              country: 'WORLD', sourceCount: 1,
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
              country: 'WORLD', sourceCount: 1,
            });
          }
        }
      }
      const seen = new Set();
      const deduped = articles.filter(a => {
        const k = a.headline?.slice(0, 50).toLowerCase().replace(/[^a-z]/g, '');
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
      });

      return res.status(200).json({ success: true, articles: deduped });
    } catch (e) {
      await logError(supabase, { endpoint: "content", action: "news", error: e, sessionId });
      return res.status(500).json({ error: e.message });
    }
  }

  // ── ACTION: rss ───────────────────────────────────────────────
  if (action === 'rss') {
    const rl = await checkRateLimit(supabase, sessionId, 'rss');
    if (!rl.allowed) return res.status(429).json({ error: 'Rate limit exceeded.', resetAt: rl.resetAt });

    const { country = 'us', max = '15' } = req.query;

    // City-local feed resolution. Previously `{city}_local` codes (berlin_local,
    // frankfurt_local, bonn_local) weren't COUNTRY_FEEDS keys and fell back to
    // US feeds. Now they resolve to city-specific German feeds (translated
    // downstream by the app's translate step). Bonn uses General-Anzeiger.
    const CITY_LOCAL_FEEDS = {
      berlin_local: [
        'https://www.tagesspiegel.de/contentexport/feed/berlin',
        'https://www.berliner-zeitung.de/feed.xml',
        'https://www.tagesschau.de/index~rss2.xml',
      ],
      frankfurt_local: [
        'https://www.faz.net/rss/aktuell/rhein-main/',
        'https://www.tagesschau.de/index~rss2.xml',
      ],
      bonn_local: [
        'https://ga.de/feed.rss',
        'https://www.tagesschau.de/index~rss2.xml',
      ],
    };
    const feeds = CITY_LOCAL_FEEDS[country] || COUNTRY_FEEDS[country] || COUNTRY_FEEDS['us'];

    const isLocalLanguageFeed = /_local$/.test(country);

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
            signal: AbortSignal.timeout(12000),
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
          const rawEncoded   = (item.match(/<content:encoded>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/) || [])[1] || '';
          const rawDesc_     = (item.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || '';
          const rawBest      = rawEncoded.length > rawDesc_.length ? rawEncoded : rawDesc_;
          const cleanedDesc_ = cleanText(rawBest);
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
          if (!isLocalLanguageFeed && !isEnglishHeadline(title)) continue;
          const pub = pubDate ? new Date(pubDate) : new Date();
          if (isNaN(pub.getTime())) continue;
          const ageHours = (Date.now() - pub) / 3600000;
          if (ageHours > 72) continue;
          const t = inferTopic(title, description);
          articles.push({
            id: `rss-${country}-${fi}-${Math.random().toString(36).slice(2,10)}-${Date.now()}`,
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
      await logError(supabase, { endpoint: "content", action: "rss", error: e, sessionId });
      return res.status(500).json({ error: e.message });
    }
  }

  // ── ACTION: search — RSS-based, no quota consumed ────────────
  if (action === 'search') {
    const { q = '', country = 'us', max = '30' } = req.query;
    if (!q.trim()) return res.status(400).json({ error: 'Query required.' });

    const terms = q.toLowerCase().trim().split(/\s+/).filter(t => t.length > 2);
    if (!terms.length) return res.status(400).json({ error: 'Query too short.' });

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
      const feedResults = await Promise.all(
        allFeeds.map(url =>
          fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
              'Accept': 'application/rss+xml, application/xml, text/xml, */*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Cache-Control': 'no-cache',
            },
            signal: AbortSignal.timeout(12000),
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
          if (!isEnglishHeadline(title)) continue;

          const searchText = (title + ' ' + desc).toLowerCase();
          const matches = terms.every(term => searchText.includes(term));
          if (!matches) continue;

          const pubDate = pub ? new Date(pub) : new Date();
          if (isNaN(pubDate.getTime())) continue;
          if ((Date.now() - pubDate) > 7 * 24 * 60 * 60 * 1000) continue;

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
      await logError(supabase, { endpoint: "content", action: "search", error: e, sessionId });
      return res.status(500).json({ error: e.message });
    }
  }

  // ── ACTION: citynews ───────────────────────────────────────
  // Returns city-specific articles from The Local DE city feeds.
  // Each article tagged sourceCity. Caches 1h in digest_cache.
  // Folded into content.js due to Vercel Hobby plan 12-function limit.
  if (action === 'citynews') {
    const CITY_FEEDS = {
      berlin: 'https://feeds.thelocal.com/rss/de/berlin',
      munich: 'https://feeds.thelocal.com/rss/de/munich',
      hamburg: 'https://feeds.thelocal.com/rss/de/hamburg',
      frankfurt: 'https://feeds.thelocal.com/rss/de/frankfurt',
    };
    const SOURCE_NAMES = {
      berlin: 'The Local Berlin',
      munich: 'The Local Munich',
      hamburg: 'The Local Hamburg',
      frankfurt: 'The Local Frankfurt',
    };

    const cityKey = String(req.query.city || '').toLowerCase().trim();
    const maxN = Math.min(25, Math.max(1, parseInt(req.query.max) || 15));
    const feedUrl = CITY_FEEDS[cityKey];

    if (!feedUrl) {
      return res.status(200).json({
        success: true, articles: [],
        reason: cityKey ? 'no_feed_for_city' : 'no_city_provided',
      });
    }

    const cacheKey = `citynews-${cityKey}`;

    // Try cache first (1h TTL)
    try {
      const { data: cached } = await supabase
        .from('digest_cache')
        .select('digest')
        .eq('cache_key', cacheKey)
        .gt('expires_at', new Date().toISOString())
        .single();
      if (cached?.digest?.articles?.length) {
        return res.status(200).json({
          success: true, fromCache: true,
          articles: cached.digest.articles.slice(0, maxN),
        });
      }
    } catch (e) {}

    // Fetch fresh
    try {
      const r = await fetch(feedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        return res.status(200).json({ success: true, articles: [], reason: `feed_${r.status}` });
      }
      const xml = await r.text();
      const items = xml.match(/<item[^>]*>[\s\S]*?<\/item>/g) || [];
      const sourceName = SOURCE_NAMES[cityKey] || 'The Local';

      const articles = items.slice(0, 25).map((item, i) => {
        const title = cleanText((item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]);
        const desc = cleanText((item.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1]);
        const link = ((item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
        const pubDate = (item.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/) || [])[1] || '';
        const imgMatch = item.match(/url="([^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i) ||
                         item.match(/<media:content[^>]+url="([^"]+)"/i);
        const image = imgMatch ? imgMatch[1] : null;
        let publishedAt;
        try { publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(); }
        catch (e) { publishedAt = new Date().toISOString(); }
        return {
          id: `city-${cityKey}-${Date.now()}-${i}`,
          headline: title,
          summary: desc.slice(0, 300),
          source: sourceName,
          sourceUrl: link,
          image,
          publishedAt,
          time: getRelativeTime(publishedAt),
          country: 'DE',
          sourceCity: cityKey,
          isLocal: true,
          topic: 'world',
          topicLabel: 'Germany',
        };
      }).filter(a => a.headline && a.headline.length > 10);

      // Cache 1h
      try {
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await supabase.from('digest_cache').upsert({
          cache_key: cacheKey,
          digest: { articles },
          fetched_at: new Date().toISOString(),
          expires_at: expiresAt,
        }, { onConflict: 'cache_key' });
      } catch (e) {}

      return res.status(200).json({
        success: true, fromCache: false,
        articles: articles.slice(0, maxN),
      });
    } catch (e) {
      await logError(supabase, { endpoint: "content", action: "citynews", error: e, sessionId });
      return res.status(200).json({ success: true, articles: [], error: e.message });
    }
  }

  // ── ACTION: topicnews ──────────────────────────────────────
  // English, expat-focused Germany news matched to the user's topics, last 7
  // days. Powers the Topics tab. High-precision: Germany-relevance gate +
  // word-boundary keyword matching + relevance scoring.
  //
  // USAGE: /api/content?action=topicnews&topics=transport,housing,visa&city=berlin
  if (action === 'topicnews') {
    // ── High-precision keyword sets ──
    // Single words are matched with WORD BOUNDARIES (so "strike" won't fire on
    // "strikes in Iran" unless it's a standalone word — and we drop bare generic
    // words entirely). Multi-word phrases use substring (already specific).
    // German terms are kept untranslated — they're high-signal and rarely
    // produce false positives.
    // 5 broad buckets (consolidated May 2026). Each unions its former
    // sub-topics so a single chip pulls plenty of stories from the same pool.
    const TOPIC_KEYWORDS = {
      // daily = old daily + culture + fashion + healthcare
      daily: ['cost of living','life in germany','new to germany','moving to germany','living in germany','expat life','price rise','prices rise','consumer prices','public holiday','weather warning','heat wave','heatwave','expat','expats','ausländer','auslaender','integration','feiertag','aldi','lidl','rewe','edeka','supermarket','art exhibition','film festival','christmas market','food scene','museum island','berlin film','museum','ausstellung','berlinale','oktoberfest','weihnachtsmarkt','theater','konzert','gallery','festival','fashion week','fashion industry','fashion','mode','health insurance','public health','private insurance','health system','krankenkasse','krankenversicherung','aok','barmer','arzt','ärzte','aerzte','hausarzt','krankenhaus','apotheke','rezept','krankschreibung','pflege','gesundheit','hospital','doctor'],
      // money = old work + energy
      money: ['minimum wage','parental leave','collective bargaining','trade union','labor market','labour market','job market','short-time work','wage talks','pay rise','wage rise','cost of living','gehalt','tarif','tarifvertrag','mindestlohn','kurzarbeit','arbeitsamt','arbeitsagentur','arbeitslos','kündigung','kuendigung','elterngeld','bürgergeld','buergergeld','verdi','ig metall','gewerkschaft','gas price','electricity price','power price','energy price','heat pump','climate target','climate goal','renewable energy','energy transition','heizungsgesetz','energiewende','wärmepumpe','waermepumpe','strompreis','gaspreis','klimaziel','atomkraft','windkraft','solar power'],
      // visa = old visa + bureaucracy
      visa: ['residence permit','blue card','work permit','opportunity card','skilled worker','work visa','student visa','family reunification','visa','visas','aufenthaltstitel','aufenthalt','einbürgerung','einbuergerung','naturalization','naturalisation','citizenship','staatsbürgerschaft','staatsbuergerschaft','ausländerbehörde','auslaenderbehoerde','immigration','chancenkarte','niederlassung','fachkräfte','fachkraefte','residency','tax return','tax declaration','residence registration','anmeldung','ummeldung','abmeldung','finanzamt','steuererklärung','steuererklaerung','bürgeramt','buergeramt','elster','bürokratie','buerokratie','rundfunkbeitrag','gez','termin'],
      // living = old housing + transport
      living: ['rent cap','rent control','rent rise','rents rise','rent increase','rental market','rental contract','housing shortage','housing market','housing crisis','housing chaos','real estate','property market','serviced apartment','first month housing','mietpreisbremse','nebenkosten','wohnungssuche','mietvertrag','kaution','schufa','immobilien','miete','mieten','mieter','vermieter','wohnung','wohnungen','landlord','tenant','rent','rents','rental','wbs','deutsche bahn','s-bahn','u-bahn','rail strike','train strike','transport strike','warning strike','rail network','public transport','air travel','flight cancel','flight delay','aviation','bvg','autobahn','lufthansa','flixbus','streik','warnstreik','bahnstreik','deutschlandticket','49-euro ticket','mvg','rmv','hvv','bahn','flughafen','hauptbahnhof'],
      // politics = old politics
      politics: ['german government','german election','german politics','coalition government','bundestag','bundesrat','bundesregierung','cdu','csu','spd','fdp','grüne','gruene','afd','merz','scholz','habeck','lindner','weidel','koalition','bundeswehr','kanzler','chancellor merz','minister','parliament'],
    };

    // Germany-relevance gate — same spirit as cron.js. Expat-core sources
    // (The Local, IamExpat) auto-pass; everything else must mention a Germany signal.
    const STRONG_GERMANY = /\b(germany|german|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|düsseldorf|duesseldorf|leipzig|dresden|bremen|hannover|nuremberg|nürnberg|bundestag|bundesrat|bundesregierung|bundesbank|bundesliga|bundeswehr|cdu|csu|spd|fdp|grüne|gruene|afd|merz|scholz|habeck|lindner|deutsche bahn|lufthansa|volkswagen|mercedes|siemens|dax|krankenkasse|bürgergeld|mietpreisbremse|heizungsgesetz|bvg|s-bahn|u-bahn|autobahn|anmeldung|finanzamt|aufenthalt|einbürgerung|elterngeld)\b/i;

    const requestedTopics = String(req.query.topics || '').toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
    const cityKey = String(req.query.city || '').toLowerCase().trim();

    if (requestedTopics.length === 0) {
      return res.status(200).json({ success: true, articles: [], reason: 'no_topics' });
    }

    // English expat-focused Germany feeds ONLY. No DW-EU, no DW-business,
    // no Politico — those carry global news that pollutes relevancy.
    const EXPAT_CORE = new Set(['The Local', 'IamExpat']);
    const TOPIC_FEEDS = [
      { url: 'https://www.thelocal.de/feed/', name: 'The Local' },
      { url: 'https://feeds.thelocal.com/rss/de', name: 'The Local' },
      { url: 'https://feeds.thelocal.com/rss/de/politics', name: 'The Local' },
      { url: 'https://feeds.thelocal.com/rss/de/money', name: 'The Local' },
      { url: 'https://feeds.thelocal.com/rss/de/news', name: 'The Local' },
      { url: 'https://www.iamexpat.de/rss/news-germany', name: 'IamExpat' },
      { url: 'https://www.iamexpat.de/rss/expat-news', name: 'IamExpat' },
      { url: 'https://www.iamexpat.de/rss/lifestyle-news', name: 'IamExpat' },
      { url: 'https://rss.dw.com/xml/rss-en-ger', name: 'Deutsche Welle' },
    ];
    const CITY_TOPIC_FEEDS = {
      berlin: { url: 'https://feeds.thelocal.com/rss/de/berlin', name: 'The Local' },
      frankfurt: { url: 'https://feeds.thelocal.com/rss/de/frankfurt', name: 'The Local' },
      munich: { url: 'https://feeds.thelocal.com/rss/de/munich', name: 'The Local' },
      hamburg: { url: 'https://feeds.thelocal.com/rss/de/hamburg', name: 'The Local' },
    };
    const feeds = [...TOPIC_FEEDS];
    if (cityKey && CITY_TOPIC_FEEDS[cityKey]) feeds.push(CITY_TOPIC_FEEDS[cityKey]);

    const poolCacheKey = `topicnews-pool-v4-${cityKey || 'none'}`;
    let pool = null;

    try {
      const { data: cached } = await supabase
        .from('digest_cache').select('digest')
        .eq('cache_key', poolCacheKey)
        .gt('expires_at', new Date().toISOString())
        .single();
      if (cached?.digest?.articles?.length) pool = cached.digest.articles;
    } catch (e) {}

    if (!pool) {
      try {
        const results = await Promise.all(
          feeds.map(f =>
            fetch(f.url, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
              signal: AbortSignal.timeout(10000),
            }).then(r => r.text()).catch(() => '')
          )
        );
        pool = [];
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        for (let fi = 0; fi < results.length; fi++) {
          const xml = results[fi];
          if (!xml) continue;
          const feed = feeds[fi];
          const items = xml.match(/<item[\s\S]*?<\/item>/g) || [];
          for (const item of items) {
            const title = cleanText((item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]);
            const rawDesc = (item.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || '';
            const desc = cleanText(rawDesc);
            const link = ((item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
            const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
            const imgMatch = item.match(/url="([^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i) ||
                             item.match(/<media:content[^>]+url="([^"]+)"/i) ||
                             item.match(/<enclosure[^>]+url="([^"]+)"/i) ||
                             item.match(/<media:thumbnail[^>]+url="([^"]+)"/i);
            const image = imgMatch ? imgMatch[1] : null;
            if (!title || title.length < 12) continue;
            if (/<[a-z]/i.test(title)) continue;
            if (!isEnglishHeadline(title)) continue;

            // Skip multi-topic roundups / live blogs — they mention many topics
            // in passing and always cause keyword mismatches.
            // DW live blogs have "/live-" in the URL; DW daily roundups start
            // with "Germany news:" or "Germany updates:".
            if (/\/live-/i.test(link)) continue;
            if (/^germany (news|updates|headlines)\s*:/i.test(title)) continue;
            if (/^(the week|this week) in germany/i.test(title)) continue;

            const pub = pubDate ? new Date(pubDate) : new Date();
            if (isNaN(pub.getTime()) || pub.getTime() < sevenDaysAgo) continue;

            const isExpatCore = EXPAT_CORE.has(feed.name);
            const isCityFeed = cityKey && CITY_TOPIC_FEEDS[cityKey] && feed.url === CITY_TOPIC_FEEDS[cityKey].url;

            // Germany-relevance gate: expat-core sources auto-pass; others must
            // mention a Germany signal in headline or summary.
            if (!isExpatCore) {
              const text = (title + ' ' + desc);
              if (!STRONG_GERMANY.test(text)) continue;
            }

            pool.push({
              id: `topic-${fi}-${Math.random().toString(36).slice(2, 9)}`,
              headline: title,
              summary: /^<[a-z]/i.test(desc.trim()) ? '' : desc.slice(0, 300),
              source: feed.name,
              sourceUrl: link,
              image,
              publishedAt: pub.toISOString(),
              time: getRelativeTime(pub),
              country: 'DE',
              sourceCity: isCityFeed ? cityKey : 'nationwide',
              _expatCore: isExpatCore,
              _cityLocal: !!isCityFeed,
            });
          }
        }
        const seen = new Set();
        pool = pool.filter(a => {
          const k = a.headline.slice(0, 60).toLowerCase().replace(/[^a-z0-9]/g, '');
          if (seen.has(k)) return false;
          seen.add(k); return true;
        });
        try {
          await supabase.from('digest_cache').upsert({
            cache_key: poolCacheKey,
            digest: { articles: pool },
            fetched_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          }, { onConflict: 'cache_key' });
        } catch (e) {}
      } catch (e) {
        await logError(supabase, { endpoint: 'content', action: 'topicnews', error: e, sessionId });
        return res.status(200).json({ success: true, articles: [], error: e.message });
      }
    }

    // ── Keyword matcher: phrases use substring, single words use word-boundary ──
    function matchTopic(text, topic) {
      const kws = TOPIC_KEYWORDS[topic] || [topic];
      for (const kw of kws) {
        if (kw.includes(' ') || kw.includes('-')) {
          if (text.includes(kw)) return true;
        } else {
          // word boundary for single tokens (handles ä/ö/ü)
          const re = new RegExp(`(^|[^a-zäöüß])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-zäöüß]|$)`, 'i');
          if (re.test(text)) return true;
        }
      }
      return false;
    }

    // Match + score every pooled article against requested topics.
    const matched = [];
    for (const a of pool) {
      const headline = (' ' + (a.headline || '') + ' ').toLowerCase();
      const summary = (' ' + (a.summary || '') + ' ').toLowerCase();
      const matchedTopics = [];
      let score = 0;
      for (const topic of requestedTopics) {
        const inHeadline = matchTopic(headline, topic);
        const inSummary = matchTopic(summary, topic);
        if (inHeadline || inSummary) {
          matchedTopics.push(topic);
          score += inHeadline ? 3 : 1; // headline match is much stronger
        }
      }
      if (matchedTopics.length > 0) {
        // Source quality + locality boosts
        if (a._expatCore) score += 2;
        if (a._cityLocal) score += 1;
        if (a.image) score += 0.5; // prefer stories with art, mild boost
        const { _expatCore, _cityLocal, ...clean } = a;
        matched.push({ ...clean, matchedTopics, _score: score });
      }
    }

    // Sort by score desc, then recency desc
    matched.sort((a, b) => (b._score - a._score) || (new Date(b.publishedAt) - new Date(a.publishedAt)));

    // Strip internal score before returning
    const out = matched.map(({ _score, ...rest }) => rest);

    const topicCounts = {};
    for (const t of requestedTopics) topicCounts[t] = 0;
    for (const a of out) {
      for (const t of a.matchedTopics) topicCounts[t] = (topicCounts[t] || 0) + 1;
    }

    return res.status(200).json({
      success: true,
      articles: out,
      topicCounts,
      poolSize: pool.length,
    });
  }

  // ── ACTION: image ─────────────────────────────────────────────
  if (action === 'image') {
    const rl = await checkRateLimit(supabase, sessionId, 'image');
    if (!rl.allowed) return res.status(429).json({ error: 'Rate limit exceeded.', resetAt: rl.resetAt });

    const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;
    const { topic = 'world', country = 'us' } = req.query;

    if (!UNSPLASH_KEY) return res.status(500).json({ error: 'Unsplash not configured' });

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


  // ── ACTION: article — REMOVED (L5 compliance) ────────────────
  if (action === 'article') {
    return res.status(410).json({ error: 'Article extraction removed. Use publisher URL directly.' });
  }

  return res.status(400).json({ error: `Unknown action: ${action}. Use: news | rss | search | citynews | topicnews | image` });
};
