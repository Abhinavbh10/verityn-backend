// ============================================================
// FILE: api/image.js
// PURPOSE: Fetches relevant images from Unsplash per topic/story
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const TOPIC_QUERIES = {
  world:    'world news international',
  politics: 'government politics',
  tech:     'technology digital innovation',
  markets:  'stock market finance',
  business: 'business corporate',
  science:  'science research',
  climate:  'nature environment',
  sports:   'sports athlete',
  general:  'news',
};

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (request.method === 'OPTIONS') return response.status(200).end();

  const { topic = 'world', country = 'us', keyword = '' } = request.query;

  const UNSPLASH_KEY      = process.env.UNSPLASH_ACCESS_KEY;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!UNSPLASH_KEY) {
    return response.status(500).json({
      error: 'UNSPLASH_ACCESS_KEY not found.',
      availableKeys: Object.keys(process.env).filter(k => !k.includes('SECRET') && !k.includes('KEY')),
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const cacheKey = `img-${topic}-${country}`;

  // Check cache
  try {
    const { data: cached } = await supabase
      .from('digest_cache')
      .select('digest, fetched_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();
    if (cached && cached.digest?.urls) {
      return response.status(200).json({
        success: true, fromCache: true,
        imageUrl: cached.digest.urls.regular,
        thumbUrl: cached.digest.urls.small,
        credit:   cached.digest.credit,
      });
    }
  } catch (e) {}

  const topicQuery  = TOPIC_QUERIES[topic] || 'news';
  const searchQuery = keyword ? keyword.slice(0, 40) : topicQuery;
  const unsplashUrl = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(searchQuery)}&orientation=landscape&content_filter=high`;

  try {
    const res          = await fetch(unsplashUrl, {
      headers: {
        'Authorization': `Client-ID ${UNSPLASH_KEY}`,
        'Accept-Version': 'v1',
      },
    });
    const responseText = await res.text();

    if (!res.ok) {
      return response.status(200).json({
        error:          'Unsplash error',
        unsplashStatus: res.status,
        unsplashBody:   responseText.slice(0, 300),
        keyPreview:     UNSPLASH_KEY.slice(0, 8) + '...',
        query:          searchQuery,
      });
    }

    const data   = JSON.parse(responseText);
    const result = {
      urls:   { regular: data.urls?.regular, small: data.urls?.small },
      credit: { name: data.user?.name, username: data.user?.username, link: data.links?.html },
    };

    await supabase.from('digest_cache').upsert({
      cache_key:  cacheKey,
      digest:     result,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: 'cache_key' }).catch(() => {});

    return response.status(200).json({
      success: true, fromCache: false,
      imageUrl: result.urls.regular,
      thumbUrl: result.urls.small,
      credit:   result.credit,
    });

  } catch (error) {
    return response.status(500).json({
      error: 'Fetch failed', details: error.message,
      keyExists: !!UNSPLASH_KEY, keyLength: UNSPLASH_KEY?.length,
    });
  }
};
