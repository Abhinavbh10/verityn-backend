// ============================================================
// FILE: api/digest.js  (UPGRADED — Fix 5)
// FIX: Fetches full article text for top 3 stories
//      Claude now reasons from real content, not just headlines
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (request.method === 'OPTIONS') return response.status(200).end();

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GNEWS_API_KEY     = process.env.GNEWS_API_KEY;
  const NEWSAPI_KEY       = process.env.NEWSAPI_KEY;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  const { country = 'us' } = request.query;
  const supabase   = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const cacheKey   = `digest-${country}`;

  // ── Check cache (1 hour TTL) ──────────────────────────────
  try {
    const { data: cached } = await supabase
      .from('digest_cache')
      .select('digest, fetched_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (cached) {
      return response.status(200).json({
        success:   true,
        fromCache: true,
        cachedAt:  cached.fetched_at,
        country:   country.toUpperCase(),
        digest:    cached.digest,
      });
    }
  } catch (e) { /* cache miss */ }

  try {
    // ── Fetch top headlines from multiple sources ─────────
    const categories   = ['general', 'technology', 'business'];
    const allArticles  = [];

    for (const cat of categories) {
      // GNews
      if (GNEWS_API_KEY) {
        try {
          const url  = `https://gnews.io/api/v4/top-headlines?category=${cat}&lang=en&country=${country}&max=3&apikey=${GNEWS_API_KEY}`;
          const res  = await fetch(url);
          const data = await res.json();
          if (data.articles) allArticles.push(...data.articles.slice(0, 2));
        } catch (e) {}
      }
      // NewsAPI
      if (NEWSAPI_KEY) {
        try {
          const url  = `https://newsapi.org/v2/top-headlines?country=${country}&category=${cat}&pageSize=3&apiKey=${NEWSAPI_KEY}`;
          const res  = await fetch(url);
          const data = await res.json();
          if (data.articles) {
            allArticles.push(...data.articles
              .filter(a => a.title && a.title !== '[Removed]')
              .slice(0, 2)
              .map(a => ({
                title:       a.title,
                description: a.description,
                url:         a.url,
                publishedAt: a.publishedAt,
                source:      { name: a.source?.name },
              }))
            );
          }
        } catch (e) {}
      }
    }

    // Deduplicate headlines
    const seen       = new Set();
    const uniqueArticles = allArticles.filter(a => {
      const key = a.title?.slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // ── Fix 5: Fetch full article text for top 3 stories ─
    const enrichedArticles = await Promise.all(
      uniqueArticles.slice(0, 8).map(async (article, i) => {
        // Only fetch full content for top 3 — saves time and bandwidth
        if (i < 3 && article.url) {
          try {
            const res  = await fetch(article.url, {
              headers: { 'User-Agent': 'Verityn News Bot 1.0' },
              signal: AbortSignal.timeout(4000), // 4 second timeout
            });
            const html = await res.text();

            // Extract readable text from HTML — basic extraction
            // Removes scripts, styles, tags and gets main content
            const text = html
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 3000); // First 3000 chars is usually the article body

            return { ...article, fullText: text, hasFullText: true };
          } catch (e) {
            // Fetch failed — use description as fallback
            return { ...article, fullText: article.description || '', hasFullText: false };
          }
        }
        return { ...article, fullText: article.description || '', hasFullText: false };
      })
    );

    // ── Build content for Claude ───────────────────────────
    const articleContent = enrichedArticles.map((a, i) => {
      const content = a.hasFullText && a.fullText?.length > 200
        ? `FULL ARTICLE TEXT:\n${a.fullText}`
        : `SUMMARY: ${a.description || 'No description available.'}`;

      return `--- STORY ${i + 1} ---
Source: ${a.source?.name || 'Unknown'}
Headline: ${a.title}
${content}
URL: ${a.url || ''}`;
    }).join('\n\n');

    // Country context
    const countryNames = { in: 'India', us: 'United States', gb: 'United Kingdom', au: 'Australia', sg: 'Singapore', ae: 'UAE', de: 'Germany', jp: 'Japan' };
    const countryName  = countryNames[country] || 'the world';

    // ── Generate AI digest with richer context ─────────────
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 2500,
        system: `You are Verityn's senior AI editor for ${countryName}. 
You have access to full article text for the top stories — use it to write deeply informed, accurate narratives.
Your tone is that of a world-class journalist — sharp, clear, authoritative but never sensationalist.
Personalise all analysis for readers in ${countryName}.
Respond ONLY with a valid JSON array. No preamble, no markdown, no text outside the JSON.`,
        messages: [{
          role:    'user',
          content: `Here are today's top stories with full article content where available:

${articleContent}

Create a digest of the 5 most important stories. For each return:
- headline: Sharp rewritten headline that captures the key development
- topic: One of: Politics, Economy, Tech, Climate, Business, World, Science, Sports
- narrative: 3-4 sentences. What happened, why now, what's the context. Use full article text where available — be specific, not generic.
- trend: 6-8 word phrase describing current direction
- whyItMatters: 2 sentences on real-world impact specifically for ${countryName} readers
- velocity: "high" or "med"
- keyFact: One specific, concrete fact from the article (a number, date, name, or statistic)

Return ONLY a JSON array of 5 objects. Nothing else.`
        }]
      })
    });

    const claudeData = await claudeResponse.json();
    const rawText    = claudeData.content?.[0]?.text || '[]';

    let digestItems = [];
    try {
      digestItems = JSON.parse(rawText);
    } catch (e) {
      digestItems = [];
    }

    // ── Cache for 1 hour ──────────────────────────────────
    await supabase
      .from('digest_cache')
      .upsert({
        cache_key:  cacheKey,
        digest:     digestItems,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'cache_key' });

    return response.status(200).json({
      success:        true,
      fromCache:      false,
      country:        country.toUpperCase(),
      generatedAt:    new Date().toISOString(),
      articlesWithFullText: enrichedArticles.filter(a => a.hasFullText).length,
      digest:         digestItems,
    });

  } catch (error) {
    console.error('Digest error:', error.message);
    return response.status(500).json({ error: 'Failed to generate digest.', details: error.message });
  }
};
