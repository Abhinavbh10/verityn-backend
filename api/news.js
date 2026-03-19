// ============================================================
// FILE: api/news.js  (UPGRADED — with quality filtering)
// SOURCES: GNews + MediaStack
// FIXES: Filters garbage headlines, blocks low-quality sources
// ============================================================

const { createClient } = require('@supabase/supabase-js');

// ── Blocked sources — not real news publishers ────────────────
const BLOCKED_SOURCES = [
  'dvidshub', 'dvids', 'defense visual', 'army.mil', 'navy.mil',
  'af.mil', 'marines.mil', 'globenewswire', 'businesswire',
  'prnewswire', 'accesswire', 'einpresswire', 'prweb',
  'send2press', 'newswire',
];

// ── Headline quality filters ──────────────────────────────────
function isGarbageHeadline(title) {
  if (!title) return true;
  if (title.length < 15) return true;           // too short
  if (title === '[Removed]') return true;

  // Matches military image codes like "260313-A-ZN169-1002"
  if (/^\d{6}-[A-Z]-[A-Z0-9]+-\d+/.test(title)) return true;

  // Matches "[Image X of Y]" pattern
  if (/\[image \d+ of \d+\]/i.test(title)) return true;

  // Matches press release patterns
  if (/^(FOR IMMEDIATE RELEASE|PRESS RELEASE)/i.test(title)) return true;

  // Mostly numbers/codes — not a real headline
  const wordCount = title.split(' ').filter(w => /[a-zA-Z]{3,}/.test(w)).length;
  if (wordCount < 3) return true;

  return false;
}

function isBlockedSource(sourceName) {
  if (!sourceName) return false;
  const lower = sourceName.toLowerCase();
  return BLOCKED_SOURCES.some(blocked => lower.includes(blocked));
}

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const { country = 'us', category = 'general', max = 10, bypass = 'false' } = request.query;

  const GNEWS_API_KEY     = process.env.GNEWS_API_KEY;
  const MEDIASTACK_KEY    = process.env.MEDIASTACK_KEY;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const cacheKey = `${country}-${category}`;

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
          success: true, fromCache: true, cachedAt: cached.fetched_at,
          velocityLevel: cached.velocity_level || 'low',
          country: country.toUpperCase(), category,
          totalArticles: cached.articles.length, articles: cached.articles,
        });
      }
    } catch (e) {}
  }

  try {
    const allRaw = [];

    // Source 1: GNews
    if (GNEWS_API_KEY) {
      try {
        const url = `https://gnews.io/api/v4/top-headlines?category=${category}&lang=en&country=${country}&max=10&apikey=${GNEWS_API_KEY}`;
        const res = await fetch(url);
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

    // Source 2: MediaStack
    if (MEDIASTACK_KEY) {
      try {
        const msCountry = { in:'in',us:'us',gb:'gb',au:'au',sg:'sg',ae:'ae',de:'de',jp:'jp' }[country] || 'us';
        const msCat = { general:'general',technology:'technology',business:'business',sports:'sports',science:'science',health:'health',entertainment:'entertainment' }[category] || 'general';
        const url = `http://api.mediastack.com/v1/news?access_key=${MEDIASTACK_KEY}&countries=${msCountry}&categories=${msCat}&languages=en&limit=10&sort=published_desc`;
        const res = await fetch(url);
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

    // ── Quality filter — remove garbage before deduplication ──
    const filtered = allRaw.filter(a =>
      !isGarbageHeadline(a.title) &&
      !isBlockedSource(a.source?.name)
    );

    // ── Deduplicate same-event stories ────────────────────────
    const deduplicated = deduplicateStories(filtered.length > 0 ? filtered : allRaw);

    // ── Transform to Verityn format ───────────────────────────
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

    // Feed velocity + TTL
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
    console.error('News error:', error.message);
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
