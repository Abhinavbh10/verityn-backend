// ============================================================
// FILE: api/news.js  (UPDATED — with Supabase caching)
// Replace your existing api/news.js in GitHub with this
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (request.method === 'OPTIONS') return response.status(200).end();

  const { country = 'us', category = 'general', max = 10 } = request.query;

  const GNEWS_API_KEY    = process.env.GNEWS_API_KEY;
  const SUPABASE_URL     = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!GNEWS_API_KEY) {
    return response.status(500).json({ error: 'GNEWS_API_KEY not configured in Vercel.' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const cacheKey = `${country}-${category}`;

  // ── Step 1: Check Supabase cache ──────────────────────────
  try {
    const { data: cached } = await supabase
      .from('news_cache')
      .select('articles, fetched_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())  // only if not expired
      .single();

    if (cached) {
      // Cache hit — serve instantly, no GNews call needed
      return response.status(200).json({
        success: true,
        fromCache: true,
        cachedAt: cached.fetched_at,
        country: country.toUpperCase(),
        category,
        totalArticles: cached.articles.length,
        articles: cached.articles,
      });
    }
  } catch (e) {
    // Cache miss or Supabase error — continue to fetch fresh news
  }

  // ── Step 2: Fetch fresh news from GNews ───────────────────
  try {
    const gnewsUrl = `https://gnews.io/api/v4/top-headlines?category=${category}&lang=en&country=${country}&max=${max}&apikey=${GNEWS_API_KEY}`;
    const gnewsResponse = await fetch(gnewsUrl);
    const gnewsData = await gnewsResponse.json();

    if (!gnewsResponse.ok) {
      throw new Error(gnewsData.errors?.[0] || 'GNews API error');
    }

    // Transform articles to Verityn format
    const articles = gnewsData.articles.map((article, index) => ({
      id: `${country}-${category}-${index}-${Date.now()}`,
      headline: article.title,
      summary: article.description || 'Tap to read the full story.',
      source: article.source?.name || 'Unknown Source',
      sourceUrl: article.url,
      image: article.image,
      publishedAt: article.publishedAt,
      time: getRelativeTime(article.publishedAt),
      topic: mapCategoryToTopic(category),
      topicLabel: capitalise(category === 'general' ? 'World' : category),
      breaking: isBreaking(article.publishedAt),
      country: country.toUpperCase(),
      velocity: estimateVelocity(index),
      bookmarked: false,
    }));

    // ── Step 3: Save to Supabase cache ────────────────────
    await supabase
      .from('news_cache')
      .upsert({
        cache_key: cacheKey,
        articles: articles,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 mins
      }, { onConflict: 'cache_key' });

    return response.status(200).json({
      success: true,
      fromCache: false,
      country: country.toUpperCase(),
      category,
      totalArticles: articles.length,
      articles,
    });

  } catch (error) {
    console.error('News fetch error:', error.message);
    return response.status(500).json({
      error: 'Failed to fetch news.',
      details: error.message,
    });
  }
};

// ── Helpers ───────────────────────────────────────────────────

function getRelativeTime(dateString) {
  const diffMs   = Date.now() - new Date(dateString);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs  = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHrs / 24);
  if (diffMins < 1)  return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs < 24)  return `${diffHrs}h ago`;
  return `${diffDays}d ago`;
}

function mapCategoryToTopic(category) {
  const map = {
    general: 'world', technology: 'tech', business: 'business',
    sports: 'sports', science: 'science', health: 'science',
    entertainment: 'world',
  };
  return map[category] || 'world';
}

function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function isBreaking(dateString) {
  return (Date.now() - new Date(dateString)) / 60000 < 30;
}

function estimateVelocity(index) {
  if (index < 2) return { label: 'Top story', level: 'high' };
  if (index < 5) return { label: 'Trending',  level: 'med'  };
  return           { label: 'In the news', level: 'low'  };
}
