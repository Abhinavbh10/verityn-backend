// ============================================================
// FILE: api/image.js  (NEW FILE)
// PURPOSE: Fetches relevant images from Unsplash per topic/story
//          Cached in Supabase to avoid burning the 50/hour limit
// Upload to GitHub → api/image.js
// ============================================================

const { createClient } = require('@supabase/supabase-js');

// Topic → search query mapping
// Gives Unsplash the best search terms for each topic
const TOPIC_QUERIES = {
  world:    'global world news international',
  politics: 'government parliament politics',
  tech:     'technology innovation digital',
  markets:  'stock market finance economy',
  business: 'business corporate office',
  science:  'science research laboratory',
  climate:  'nature environment climate',
  sports:   'sports stadium athlete',
  general:  'news current events',
};

// Country → location context for more relevant images
const COUNTRY_CONTEXT = {
  in: 'india',
  us: 'america',
  gb: 'london britain',
  au: 'australia',
  sg: 'singapore',
  ae: 'dubai',
  de: 'germany',
  jp: 'japan',
};

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (request.method === 'OPTIONS') return response.status(200).end();

  const {
    topic   = 'world',
    country = 'us',
    keyword = '',      // optional: key word from headline for better relevance
  } = request.query;

  const UNSPLASH_KEY      = process.env.UNSPLASH_ACCESS_KEY;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!UNSPLASH_KEY) {
    return response.status(500).json({ error: 'UNSPLASH_ACCESS_KEY not configured.' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Cache key — per topic + country combination
  // We don't cache per-headline to save API calls
  const cacheKey = `img-${topic}-${country}`;

  // ── Check cache (images cached for 6 hours) ───────────────
  try {
    const { data: cached } = await supabase
      .from('digest_cache')
      .select('digest, fetched_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (cached && cached.digest?.urls) {
      return response.status(200).json({
        success:   true,
        fromCache: true,
        imageUrl:  cached.digest.urls.regular,
        thumbUrl:  cached.digest.urls.small,
        credit:    cached.digest.credit,
      });
    }
  } catch (e) { /* cache miss */ }

  // ── Fetch from Unsplash ───────────────────────────────────
  try {
    // Build search query — topic + optional country context
    const topicQuery   = TOPIC_QUERIES[topic] || TOPIC_QUERIES.general;
    const countryQuery = COUNTRY_CONTEXT[country] || '';

    // Use keyword from headline if available — more specific
    const searchQuery = keyword
      ? `${keyword} ${countryQuery}`.trim().slice(0, 50)
      : `${topicQuery} ${countryQuery}`.trim();

    const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(searchQuery)}&orientation=landscape&content_filter=high`;

    const res  = await fetch(url, {
      headers: {
        Authorization: `Client-ID ${UNSPLASH_KEY}`,
        'Accept-Version': 'v1',
      }
    });

    if (!res.ok) {
      // Unsplash returned error — try without country context
      const fallbackUrl = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(topicQuery)}&orientation=landscape&content_filter=high`;
      const fallbackRes = await fetch(fallbackUrl, {
        headers: { Authorization: `Client-ID ${UNSPLASH_KEY}`, 'Accept-Version': 'v1' }
      });

      if (!fallbackRes.ok) throw new Error('Unsplash API error');
      const fallbackData = await fallbackRes.json();
      return buildResponse(response, supabase, cacheKey, fallbackData);
    }

    const data = await res.json();
    return buildResponse(response, supabase, cacheKey, data);

  } catch (error) {
    console.error('Image fetch error:', error.message);
    return response.status(500).json({
      error:   'Failed to fetch image.',
      details: error.message,
    });
  }
};

async function buildResponse(response, supabase, cacheKey, data) {
  const result = {
    urls: {
      regular: data.urls?.regular,
      small:   data.urls?.small,
    },
    credit: {
      name:     data.user?.name,
      username: data.user?.username,
      link:     data.links?.html,
    },
  };

  // Cache for 6 hours
  await supabase.from('digest_cache').upsert({
    cache_key:  cacheKey,
    digest:     result,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: 'cache_key' }).catch(() => {});

  return response.status(200).json({
    success:   true,
    fromCache: false,
    imageUrl:  result.urls.regular,
    thumbUrl:  result.urls.small,
    credit:    result.credit,
  });
}
