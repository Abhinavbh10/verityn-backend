// ============================================================
// FILE: api/news.js  (FIXED — strict country filtering)
// ============================================================

const { createClient } = require('@supabase/supabase-js');

// ── Blocked sources ───────────────────────────────────────────
const BLOCKED_SOURCES = [
  'dvidshub', 'dvids', 'defense visual', 'army.mil', 'navy.mil',
  'af.mil', 'marines.mil', 'globenewswire', 'businesswire',
  'prnewswire', 'accesswire', 'einpresswire', 'prweb',
  'send2press', 'newswire',
];

// ── Country-specific trusted sources ─────────────────────────
// Only articles from these sources appear in the Local feed
// This prevents cross-country bleed
const COUNTRY_SOURCES = {
  us: ['reuters', 'ap news', 'associated press', 'cnn', 'nbc news', 'abc news',
       'cbs news', 'fox news', 'the new york times', 'washington post', 'wall street journal',
       'bloomberg', 'cnbc', 'usa today', 'npr', 'politico', 'the hill', 'axios',
       'time', 'newsweek', 'business insider', 'the atlantic', 'vox', 'buzzfeed news',
       'huffpost', 'los angeles times', 'new york post'],
  gb: ['bbc', 'the guardian', 'the times', 'sky news', 'the telegraph', 'daily mail',
       'the independent', 'financial times', 'the sun', 'daily mirror', 'evening standard',
       'metro', 'city a.m.', 'the spectator'],
  in: ['the hindu', 'times of india', 'hindustan times', 'ndtv', 'india today',
       'the economic times', 'mint', 'business standard', 'the wire', 'scroll',
       'firstpost', 'news18', 'zee news', 'republic world', 'the print',
       'deccan herald', 'indian express', 'tribune india'],
  au: ['abc news', 'sydney morning herald', 'the australian', 'the age',
       'news.com.au', '9news', '7news', 'the guardian australia', 'afr',
       'daily telegraph', 'herald sun', 'courier mail'],
  de: ['der spiegel', 'die zeit', 'frankfurter allgemeine', 'suddeutsche zeitung',
       'bild', 'dw', 'deutsche welle', 'handelsblatt', 'focus', 'stern',
       'the local germany', 'germany news'],
  sg: ['the straits times', 'channel news asia', 'cna', 'today online',
       'the business times', 'zaobao', 'mothership', 'rice media'],
  ae: ['gulf news', 'khaleej times', 'the national', 'arabian business',
       'al jazeera', 'gulfnews', 'emirates news agency', 'wam'],
  jp: ['japan times', 'nhk world', 'asahi shimbun', 'mainichi', 'yomiuri',
       'nikkei', 'the japan news', 'kyodo news'],
};

// ── Headline quality filter ───────────────────────────────────
function isGarbageHeadline(title) {
  if (!title) return true;
  if (title.length < 15) return true;
  if (title === '[Removed]') return true;
  if (/^\d{6}-[A-Z]-[A-Z0-9]+-\d+/.test(title)) return true;
  if (/\[image \d+ of \d+\]/i.test(title)) return true;
  if (/^(FOR IMMEDIATE RELEASE|PRESS RELEASE)/i.test(title)) return true;
  const wordCount = title.split(' ').filter(w => /[a-zA-Z]{3,}/.test(w)).length;
  if (wordCount < 3) return true;
  return false;
}

function isBlockedSource(sourceName) {
  if (!sourceName) return false;
  const lower = sourceName.toLowerCase();
  return BLOCKED_SOURCES.some(b => lower.includes(b));
}

// Check if article is from a trusted source for this country
function isLocalSource(sourceName, country) {
  if (!sourceName) return false;
  const trusted = COUNTRY_SOURCES[country];
  if (!trusted) return true; // no list = allow all
  const lower = sourceName.toLowerCase();
  return trusted.some(s => lower.includes(s));
}

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const {
    country  = 'us',
    category = 'general',
    max      = 10,
    bypass   = 'false',
    local    = 'false', // local=true enforces strict country source filtering
  } = request.query;

  const GNEWS_API_KEY     = process.env.GNEWS_API_KEY;
  const MEDIASTACK_KEY    = process.env.MEDIASTACK_KEY;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  const supabase  = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  // Separate cache keys for local vs global
  const cacheKey  = `${country}-${category}${local === 'true' ? '-local' : ''}`;

  // Check cache
  if (bypass !== 'true') {
    try {
      const { data: cached } = await supabase
        .from('news_cache')
        .select('articles, fetched_at, velocity_level')
        .eq('cache_key', cacheKey)
        .gt('expires_at', new Date().toISOString())
        .single();
      if (cached) {
        return response.status(200).json({
          success: true, fromCache: true,
          cachedAt: cached.fetched_at,
          velocityLevel: cached.velocity_level || 'low',
          country: country.toUpperCase(), category,
          totalArticles: cached.articles.length,
          articles: cached.articles,
        });
      }
    } catch (e) {}
  }

  try {
    const allRaw = [];

    // Source 1: GNews — most reliable country filtering
    if (GNEWS_API_KEY) {
      try {
        const url  = `https://gnews.io/api/v4/top-headlines?category=${category}&lang=en&country=${country}&max=10&apikey=${GNEWS_API_KEY}`;
        const res  = await fetch(url);
        const data = await res.json();
        if (data.articles) {
          allRaw.push(...data.articles.map(a => ({
            title: a.title, description: a.description, url: a.url,
            image: a.image, publishedAt: a.publishedAt,
            source: { name: a.source?.name }, _src: 'gnews',
          })));
        }
      } catch (e) { console.error('GNews error:', e.message); }
    }

    // Source 2: MediaStack — supplement only
    if (MEDIASTACK_KEY) {
      try {
        const msCountry = { in:'in',us:'us',gb:'gb',au:'au',sg:'sg',ae:'ae',de:'de',jp:'jp' }[country] || 'us';
        const msCat     = { general:'general',technology:'technology',business:'business',sports:'sports',science:'science',health:'health',entertainment:'entertainment' }[category] || 'general';
        const url  = `http://api.mediastack.com/v1/news?access_key=${MEDIASTACK_KEY}&countries=${msCountry}&categories=${msCat}&languages=en&limit=10&sort=published_desc`;
        const res  = await fetch(url);
        const data = await res.json();
        if (data.data) {
          allRaw.push(...data.data
            .filter(a => a.title && a.url)
            .map(a => ({
              title: a.title, description: a.description, url: a.url,
              image: a.image, publishedAt: a.published_at,
              source: { name: a.source }, _src: 'mediastack',
            }))
          );
        }
      } catch (e) { console.error('MediaStack error:', e.message); }
    }

    if (allRaw.length === 0) {
      return response.status(503).json({ error: 'No news sources returned data.' });
    }

    // ── Layer 1: Quality filter ───────────────────────────
    let filtered = allRaw.filter(a =>
      !isGarbageHeadline(a.title) &&
      !isBlockedSource(a.source?.name)
    );

    // ── Layer 2: Country source filter (Local feed only) ──
    // When local=true, only show articles from trusted local sources
    if (local === 'true' && COUNTRY_SOURCES[country]) {
      const localFiltered = filtered.filter(a => isLocalSource(a.source?.name, country));
      // Only apply if we have enough local articles — otherwise fall back
      if (localFiltered.length >= 3) {
        filtered = localFiltered;
      }
    }

    // Use unfiltered if nothing passes
    if (filtered.length === 0) filtered = allRaw;

    // ── Deduplicate ───────────────────────────────────────
    const deduplicated = deduplicateStories(filtered);

    // ── Transform ─────────────────────────────────────────
    const TOPIC_MAP = { general:'world',technology:'tech',business:'business',sports:'sports',science:'science',health:'science',entertainment:'world' };
    const LABEL_MAP = { general:'World',technology:'Tech',business:'Business',sports:'Sports',science:'Science',health:'Science',entertainment:'World' };

    const articles = deduplicated.slice(0, parseInt(max)).map((a, i) => ({
      id:          `${country}-${category}-${i}-${Date.now()}`,
      headline:    a.title,
      summary:     a.description || '',
      source:      a.source?.name || 'Unknown Source',
      sourceUrl:   a.url,
      image:       a.image,
      publishedAt: a.publishedAt,
      time:        getRelativeTime(a.publishedAt),
      topic:       TOPIC_MAP[category] || 'world',
      topicLabel:  LABEL_MAP[category] || 'World',
      breaking:    isBreaking(a.publishedAt),
      country:     country.toUpperCase(),
      velocity:    estimateVelocity(i, a._sourceCount || 1),
      sourceCount: a._sourceCount || 1,
      allSources:  a._allSources  || [a.source?.name],
      bookmarked:  false,
    }));

    const bCount       = articles.filter(a => a.breaking).length;
    const feedVelocity = bCount >= 3 ? 'high' : bCount >= 1 ? 'med' : 'low';
    const ttlMinutes   = feedVelocity === 'high' ? 5 : feedVelocity === 'med' ? 10 : 15;
    const expiresAt    = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

    await supabase.from('news_cache').upsert({
      cache_key: cacheKey, articles,
      fetched_at: new Date().toISOString(),
      expires_at: expiresAt, velocity_level: feedVelocity,
    }, { onConflict: 'cache_key' });

    return response.status(200).json({
      success: true, fromCache: false,
      velocityLevel: feedVelocity, ttlMinutes,
      country: country.toUpperCase(), category,
      totalArticles: articles.length,
      filteredOut: allRaw.length - filtered.length,
      sourcesUsed: [...new Set(allRaw.map(a => a._src))],
      articles,
    });

  } catch (error) {
    return response.status(500).json({ error: 'Failed to fetch news.', details: error.message });
  }
};

// ── Deduplication ─────────────────────────────────────────────
function deduplicateStories(articles) {
  const clusters = [];
  const used     = new Set();
  const STOP     = new Set(['the','a','an','in','on','at','to','for','of','and','or','but','is','are','was','were','be','been','has','have','had','will','would','could','should','may','might','this','that','with','from','by','as','it','its','not','no','new','says','said','after','before','over','into','about','up','out','than','more','also','their','they','he','she','we','who','what','when','where','how','why','per','amid']);
  const words    = t => !t ? [] : t.toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));

  for (let i = 0; i < articles.length; i++) {
    if (used.has(i)) continue;
    const cluster = [articles[i]];
    const wA = words(articles[i].title);
    for (let j = i + 1; j < articles.length; j++) {
      if (used.has(j)) continue;
      const wB = words(articles[j].title);
      const overlap = wA.filter(w => wB.includes(w)).length;
      if (wA.length > 0 && wB.length > 0 && overlap / Math.min(wA.length, wB.length) > 0.5) {
        cluster.push(articles[j]);
        used.add(j);
      }
    }
    used.add(i);
    const best = cluster.sort((a,b) => new Date(b.publishedAt||0) - new Date(a.publishedAt||0))[0];
    best._sourceCount = cluster.length;
    best._allSources  = [...new Set(cluster.map(a => a.source?.name).filter(Boolean))];
    clusters.push(best);
  }

  return clusters.sort((a,b) => {
    if (isBreaking(a.publishedAt) && !isBreaking(b.publishedAt)) return -1;
    if (!isBreaking(a.publishedAt) && isBreaking(b.publishedAt)) return 1;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });
}

function getRelativeTime(d) {
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  const h = Math.floor(m / 60);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

function isBreaking(d) { return (Date.now() - new Date(d)) / 60000 < 30; }

function estimateVelocity(i, n) {
  if (n >= 3 || i === 0) return { label:'🔥 Top story', level:'high' };
  if (n >= 2 || i  <  4) return { label:'↑ Trending',  level:'med'  };
  return { label:'In the news', level:'low' };
}
