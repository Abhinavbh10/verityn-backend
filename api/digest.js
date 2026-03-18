// ============================================================
// FILE: api/digest.js  (UPDATED — with Supabase caching)
// Replace your existing api/digest.js in GitHub with this
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') return response.status(200).end();

  const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
  const GNEWS_API_KEY      = process.env.GNEWS_API_KEY;
  const SUPABASE_URL       = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY  = process.env.SUPABASE_ANON_KEY;

  if (!ANTHROPIC_API_KEY || !GNEWS_API_KEY) {
    return response.status(500).json({ error: 'API keys not configured in Vercel.' });
  }

  const { country = 'us' } = request.query;
  const supabase  = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const cacheKey  = `digest-${country}`;

  // ── Step 1: Check digest cache (1 hour TTL) ───────────────
  try {
    const { data: cached } = await supabase
      .from('digest_cache')
      .select('digest, fetched_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (cached) {
      return response.status(200).json({
        success: true,
        fromCache: true,
        cachedAt: cached.fetched_at,
        country: country.toUpperCase(),
        digest: cached.digest,
      });
    }
  } catch (e) {
    // Cache miss — generate fresh digest
  }

  // ── Step 2: Fetch top headlines for digest ────────────────
  try {
    const categories = ['general', 'technology', 'business'];
    const allArticles = [];

    for (const cat of categories) {
      const url = `https://gnews.io/api/v4/top-headlines?category=${cat}&lang=en&country=${country}&max=4&apikey=${GNEWS_API_KEY}`;
      const res  = await fetch(url);
      const data = await res.json();
      if (data.articles) allArticles.push(...data.articles.slice(0, 3));
    }

    // ── Step 3: Generate AI digest with Claude ────────────
    const headlinesList = allArticles
      .map((a, i) => `${i + 1}. [${a.source?.name}] ${a.title} — ${a.description || ''}`)
      .join('\n');

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: `You are Verityn's AI editor. You create sharp, insightful news digests.
Your tone is that of a smart, well-informed journalist — clear, direct, never sensationalist.
Always respond with valid JSON only. No preamble, no markdown, no explanation outside the JSON.`,
        messages: [{
          role: 'user',
          content: `Here are today's top headlines:

${headlinesList}

Create a digest of the 5 most important stories. For each return:
- headline: A sharp rewritten headline (not copied from source)
- topic: One of: Politics, Economy, Tech, Climate, Business, World, Science, Sports
- narrative: 2-3 sentences explaining the story and why it matters now
- trend: 6-8 word phrase describing current direction of the story
- whyItMatters: One sentence on real-world impact for ordinary people
- velocity: "high" or "med"

Return ONLY a JSON array of 5 objects. No other text whatsoever.`
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

    // ── Step 4: Cache the digest for 1 hour ───────────────
    await supabase
      .from('digest_cache')
      .upsert({
        cache_key:  cacheKey,
        digest:     digestItems,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
      }, { onConflict: 'cache_key' });

    return response.status(200).json({
      success: true,
      fromCache: false,
      country: country.toUpperCase(),
      generatedAt: new Date().toISOString(),
      digest: digestItems,
    });

  } catch (error) {
    console.error('Digest error:', error.message);
    return response.status(500).json({
      error: 'Failed to generate digest.',
      details: error.message,
    });
  }
};
