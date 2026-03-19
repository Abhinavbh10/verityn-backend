// ============================================================
// FILE: api/news.js  (UPGRADED — Fix 1, 3, 4)
// FIXES:
//   1. Multi-source: GNews + NewsAPI merged
//   3. Story deduplication — clusters same event
//   4. Velocity-aware cache TTL
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (request.method === 'OPTIONS') return response.status(200).end();

  const {
    country  = 'us',
    category = 'general',
    max      = 10,
    bypass   = 'false',  // bypass=true for breaking news
  } = request.query;

  const GNEWS_API_KEY     = process.env.GNEWS_API_KEY;
  const NEWSAPI_KEY       = process.env.NEWSAPI_KEY;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const cacheKey = `${country}-${category}`;

  // ── Check cache (unless bypass=true for breaking news) ────
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
          success:       true,
          fromCache:     true,
          cachedAt:      cached.fetched_at,
          velocityLevel: cached.velocity_level || 'low',
          country:       country.toUpperCase(),
          category,
          totalArticles: cached.articles.length,
          articles:      cached.articles,
        });
      }
    } catch (e) { /* cache miss */ }
  }

  // ── Fetch from multiple sources ───────────────────────────
  try {
    const allRaw = [];

    // Source 1 — GNews
    if (GNEWS_API_KEY) {
      try {
        const url  = `https://gnews.io/api/v4/top-headlines?category=${mapCategory(category, 'gnews')}&lang=en&country=${country}&max=10&apikey=${GNEWS_API_KEY}`;
        const res  = await fetch(url);
        const data = await res.json();
        if (data.articles) {
          allRaw.push(...data.articles.map(a => ({ ...a, _src: 'gnews' })));
        }
      } catch (e) { console.error('GNews fetch failed:', e.message); }
    }

    // Source 2 — NewsAPI (different publisher pool)
    if (NEWSAPI_KEY) {
      try {
        const newsapiCountry = mapCountryForNewsAPI(country);
        const url  = `https://newsapi.org/v2/top-headlines?country=${newsapiCountry}&category=${mapCategory(category, 'newsapi')}&pageSize=10&apiKey=${NEWSAPI_KEY}`;
        const res  = await fetch(url);
        const data = await res.json();
        if (data.articles) {
          allRaw.push(...data.articles
            .filter(a => a.title && a.title !== '[Removed]')
            .map(a => ({
              title:       a.title,
              description: a.description,
              url:         a.url,
              image:       a.urlToImage,
              publishedAt: a.publishedAt,
              source:      { name: a.source?.name },
              _src:        'newsapi',
            }))
          );
        }
      } catch (e) { console.error('NewsAPI fetch failed:', e.message); }
    }

    if (allRaw.length === 0) {
      return response.status(503).json({ error: 'No news sources available.' });
    }

    // ── Deduplicate — cluster same-event stories ──────────
    const deduplicated = deduplicateStories(allRaw);

    // ── Transform to Verityn format ───────────────────────
    const articles = deduplicated.slice(0, parseInt(max)).map((article, index) => {
      const vel = estimateVelocity(index, article._sourceCount || 1);
      return {
        id:          `${country}-${category}-${index}-${Date.now()}`,
        headline:    article.title,
        summary:     article.description || 'Tap to read the full story.',
        source:      article.source?.name || 'Unknown Source',
        sourceUrl:   article.url,
        image:       article.image || article.urlToImage,
        publishedAt: article.publishedAt,
        time:        getRelativeTime(article.publishedAt),
        topic:       mapCategoryToTopic(category),
        topicLabel:  capitalise(category === 'general' ? 'World' : category),
        breaking:    isBreaking(article.publishedAt),
        country:     country.toUpperCase(),
        velocity:    vel,
        // Multi-source info
        sourceCount: article._sourceCount || 1,
        allSources:  article._allSources  || [article.source?.name],
        bookmarked:  false,
      };
    });

    // ── Determine overall feed velocity ───────────────────
    const breakingCount  = articles.filter(a => a.breaking).length;
    const feedVelocity   = breakingCount >= 3 ? 'high' : breakingCount >= 1 ? 'med' : 'low';

    // ── Velocity-aware cache TTL (Fix 4) ──────────────────
    const ttlMinutes = feedVelocity === 'high' ? 5 : feedVelocity === 'med' ? 10 : 15;
    const expiresAt  = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

    // ── Save to cache ─────────────────────────────────────
    await supabase
      .from('news_cache')
      .upsert({
        cache_key:     cacheKey,
        articles,
        fetched_at:    new Date().toISOString(),
        expires_at:    expiresAt,
        velocity_level: feedVelocity,
      }, { onConflict: 'cache_key' });

    return response.status(200).json({
      success:       true,
      fromCache:     false,
      velocityLevel: feedVelocity,
      ttlMinutes,
      country:       country.toUpperCase(),
      category,
      totalArticles: articles.length,
      sourcesUsed:   [...new Set(allRaw.map(a => a._src))],
      articles,
    });

  } catch (error) {
    console.error('News fetch error:', error.message);
    return response.status(500).json({ error: 'Failed to fetch news.', details: error.message });
  }
};

// ── Story deduplication (Fix 3) ──────────────────────────────────
// Groups stories covering the same event using title similarity
function deduplicateStories(articles) {
  const clusters = [];
  const used     = new Set();

  for (let i = 0; i < articles.length; i++) {
    if (used.has(i)) continue;
    const cluster = [articles[i]];
    const wordsA  = getKeyWords(articles[i].title);

    for (let j = i + 1; j < articles.length; j++) {
      if (used.has(j)) continue;
      const wordsB    = getKeyWords(articles[j].title);
      const overlap   = wordsA.filter(w => wordsB.includes(w)).length;
      const similarity = overlap / Math.min(wordsA.length, wordsB.length);

      // If titles share >50% of meaningful words — same story
      if (similarity > 0.5) {
        cluster.push(articles[j]);
        used.add(j);
      }
    }

    used.add(i);

    // Pick the best article from the cluster
    // Prefer: most sources covering it, most recent, longest description
    const best = cluster.sort((a, b) => {
      const dateA = new Date(a.publishedAt || 0);
      const dateB = new Date(b.publishedAt || 0);
      return dateB - dateA; // most recent first
    })[0];

    // Attach multi-source metadata
    best._sourceCount = cluster.length;
    best._allSources  = [...new Set(cluster.map(a => a.source?.name).filter(Boolean))];

    clusters.push(best);
  }

  // Sort by: breaking first, then recency
  return clusters.sort((a, b) => {
    if (isBreaking(a.publishedAt) && !isBreaking(b.publishedAt)) return -1;
    if (!isBreaking(a.publishedAt) && isBreaking(b.publishedAt)) return 1;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });
}

// Extract meaningful keywords from a title (ignore stop words)
function getKeyWords(title) {
  if (!title) return [];
  const stopWords = new Set(['the','a','an','in','on','at','to','for','of','and','or','but','is','are','was','were','be','been','has','have','had','will','would','could','should','may','might','this','that','with','from','by','as','it','its','not','no','new','says','said','after','before','over','into','about','up','out','than','more','also','their','they','he','she','we','i','you','who','what','when','where','how','why','after','during','per','amid']);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
}

// ── Helpers ───────────────────────────────────────────────────────

function getRelativeTime(dateString) {
  const diffMs   = Date.now() - new Date(dateString);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs  = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHrs / 24);
  if (diffMins < 1)  return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs  < 24) return `${diffHrs}h ago`;
  return `${diffDays}d ago`;
}

function mapCategoryToTopic(category) {
  const map = { general: 'world', technology: 'tech', business: 'business', sports: 'sports', science: 'science', health: 'science', entertainment: 'world' };
  return map[category] || 'world';
}

function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function isBreaking(dateString) {
  return (Date.now() - new Date(dateString)) / 60000 < 30;
}

// Velocity — top articles + multi-source coverage = higher velocity
function estimateVelocity(index, sourceCount) {
  if (sourceCount >= 3 || index === 0) return { label: '🔥 Top story', level: 'high' };
  if (sourceCount >= 2 || index  < 4) return { label: '↑ Trending',  level: 'med'  };
  return { label: 'In the news', level: 'low' };
}

// GNews and NewsAPI use different category names
function mapCategory(category, source) {
  if (source === 'gnews') {
    const map = { general: 'general', technology: 'technology', business: 'business', sports: 'sports', science: 'science', health: 'health', entertainment: 'entertainment' };
    return map[category] || 'general';
  }
  if (source === 'newsapi') {
    const map = { general: 'general', technology: 'technology', business: 'business', sports: 'sports', science: 'science', health: 'health', entertainment: 'entertainment' };
    return map[category] || 'general';
  }
  return category;
}

// NewsAPI uses different country codes for some countries
function mapCountryForNewsAPI(country) {
  const map = { in: 'in', us: 'us', gb: 'gb', au: 'au', sg: 'sg', ae: 'ae', de: 'de', jp: 'jp' };
  return map[country] || 'us';
}
