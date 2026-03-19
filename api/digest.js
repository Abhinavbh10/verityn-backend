// ============================================================
// FILE: api/digest.js  (FIXED — better Claude response parsing)
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GNEWS_API_KEY     = process.env.GNEWS_API_KEY;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  const { country = 'us' } = request.query;
  const supabase  = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const cacheKey  = `digest-${country}`;

  // Check cache (1 hour TTL)
  try {
    const { data: cached } = await supabase
      .from('digest_cache')
      .select('digest, fetched_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();
    if (cached && cached.digest && cached.digest.length > 0) {
      return response.status(200).json({
        success: true, fromCache: true,
        cachedAt: cached.fetched_at,
        country: country.toUpperCase(),
        digest: cached.digest,
      });
    }
  } catch (e) { /* cache miss */ }

  try {
    // Fetch top headlines
    const categories  = ['general', 'technology', 'business'];
    const allArticles = [];

    for (const cat of categories) {
      if (GNEWS_API_KEY) {
        try {
          const url  = `https://gnews.io/api/v4/top-headlines?category=${cat}&lang=en&country=${country}&max=4&apikey=${GNEWS_API_KEY}`;
          const res  = await fetch(url);
          const data = await res.json();
          if (data.articles) allArticles.push(...data.articles.slice(0, 3));
        } catch (e) {}
      }
    }

    if (allArticles.length === 0) {
      return response.status(500).json({ error: 'No articles fetched from news API.' });
    }

    // Deduplicate
    const seen           = new Set();
    const uniqueArticles = allArticles.filter(a => {
      const key = a.title?.slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Build headlines list for Claude
    const headlinesList = uniqueArticles
      .slice(0, 8)
      .map((a, i) => `${i + 1}. [${a.source?.name || 'Unknown'}] ${a.title} — ${a.description || ''}`)
      .join('\n');

    const countryNames = {
      in: 'India', us: 'United States', gb: 'United Kingdom',
      au: 'Australia', sg: 'Singapore', ae: 'UAE', de: 'Germany', jp: 'Japan'
    };
    const countryName = countryNames[country] || 'the world';

    // Call Claude
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system:     `You are Verityn's AI editor for ${countryName}. Respond ONLY with a valid JSON array. No markdown, no backticks, no explanation. Just the raw JSON array starting with [ and ending with ].`,
        messages: [{
          role:    'user',
          content: `Today's headlines for ${countryName}:

${headlinesList}

Create a digest of the 5 most important stories. Return a JSON array of 5 objects, each with:
- headline: sharp rewritten headline
- topic: one of Politics, Economy, Tech, Climate, Business, World, Science, Sports
- narrative: 2-3 sentences on what happened and why it matters
- trend: 6-8 word phrase on current direction
- whyItMatters: 1-2 sentences on impact for ${countryName} readers
- velocity: "high" or "med"
- keyFact: one specific number, date, or statistic from the story

Return ONLY the JSON array. Start your response with [ and end with ].`
        }]
      })
    });

    const claudeData = await claudeResponse.json();

    if (claudeData.error) {
      return response.status(500).json({
        error:   'Claude API error',
        details: claudeData.error,
      });
    }

    const rawText = claudeData.content?.[0]?.text || '';

    // ── Robust JSON parsing ────────────────────────────────
    let digestItems = [];
    try {
      // Try 1: direct parse
      digestItems = JSON.parse(rawText);
    } catch (e1) {
      try {
        // Try 2: strip markdown code blocks
        const stripped = rawText
          .replace(/```json\s*/gi, '')
          .replace(/```\s*/gi, '')
          .trim();
        digestItems = JSON.parse(stripped);
      } catch (e2) {
        try {
          // Try 3: extract array with regex
          const match = rawText.match(/\[[\s\S]*\]/);
          if (match) digestItems = JSON.parse(match[0]);
        } catch (e3) {
          // All parsing failed — return debug info
          return response.status(200).json({
            success: false,
            error:   'Failed to parse Claude response',
            rawText: rawText.slice(0, 500),
            digest:  [],
          });
        }
      }
    }

    // Validate digestItems is an array
    if (!Array.isArray(digestItems)) {
      return response.status(200).json({
        success: false,
        error:   'Claude returned non-array response',
        rawText: rawText.slice(0, 500),
        digest:  [],
      });
    }

    // Cache for 1 hour
    await supabase.from('digest_cache').upsert({
      cache_key:  cacheKey,
      digest:     digestItems,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }, { onConflict: 'cache_key' });

    return response.status(200).json({
      success:     true,
      fromCache:   false,
      country:     country.toUpperCase(),
      generatedAt: new Date().toISOString(),
      itemCount:   digestItems.length,
      digest:      digestItems,
    });

  } catch (error) {
    return response.status(500).json({
      error:   'Failed to generate digest.',
      details: error.message,
    });
  }
};
