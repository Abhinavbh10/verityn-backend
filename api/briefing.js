// ============================================================
// FILE: api/briefing.js  (NEW FILE)
// PURPOSE: Generates a personalised morning briefing
//          Called by cron at 6am, cached per country per day
// Upload to GitHub → api/briefing.js
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') return response.status(200).end();

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const GNEWS_API_KEY     = process.env.GNEWS_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const supabase          = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { country = 'in' } = request.query;

  // Cache key — one briefing per country per day
  const today    = new Date().toISOString().slice(0, 10);
  const cacheKey = `briefing-${country}-${today}`;

  // ── Check cache first ─────────────────────────────────────
  try {
    const { data: cached } = await supabase
      .from('digest_cache')
      .select('digest, fetched_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (cached) {
      return response.status(200).json({
        success:    true,
        fromCache:  true,
        country:    country.toUpperCase(),
        date:       today,
        briefing:   cached.digest,
      });
    }
  } catch (e) { /* cache miss */ }

  // ── Fetch today's top headlines ───────────────────────────
  try {
    const categories   = ['general', 'technology', 'business'];
    const allArticles  = [];

    for (const cat of categories) {
      const url  = `https://gnews.io/api/v4/top-headlines?category=${cat}&lang=en&country=${country}&max=3&apikey=${GNEWS_API_KEY}`;
      const res  = await fetch(url);
      const data = await res.json();
      if (data.articles) allArticles.push(...data.articles.slice(0, 2));
    }

    const headlines = allArticles
      .map((a, i) => `${i + 1}. ${a.title} (${a.source?.name})`)
      .join('\n');

    // Country context for personalisation
    const countryNames = { in: 'India', us: 'United States', gb: 'United Kingdom', au: 'Australia', sg: 'Singapore', ae: 'UAE', de: 'Germany', jp: 'Japan' };
    const countryName  = countryNames[country] || 'the world';

    // ── Generate briefing with Claude ─────────────────────
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: `You are Verityn's morning briefing writer. You write like a smart, warm friend who reads all the news so you don't have to. 
Your briefing is spoken-word style — direct, human, never robotic. 
You always personalise for the reader's country.
Respond ONLY with valid JSON. No preamble, no markdown.`,
        messages: [{
          role:    'user',
          content: `Today's headlines for ${countryName}:
${headlines}

Write a morning briefing for a reader in ${countryName}. Return JSON with exactly these fields:

{
  "greeting": "Good morning greeting with the day and date, warm and personal",
  "openingLine": "One punchy sentence summarising the mood of today's news",
  "stories": [
    {
      "emoji": "relevant emoji",
      "headline": "sharp rewritten headline",
      "oneLiner": "one sentence of context — what happened and why it matters locally"
    }
  ],
  "closingLine": "One warm, forward-looking closing sentence about what to watch today",
  "readTime": "X min read"
}

Include 4-5 stories. Keep each oneLiner under 20 words. Make it feel like a smart friend briefing you over coffee.`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const raw        = claudeData.content?.[0]?.text || '{}';

    let briefing = {};
    try { briefing = JSON.parse(raw); } catch (e) {
      briefing = {
        greeting:    'Good morning',
        openingLine: 'Here\'s what\'s happening in the world today.',
        stories:     allArticles.slice(0, 4).map(a => ({
          emoji:    '📰',
          headline: a.title,
          oneLiner: a.description?.slice(0, 100) || '',
        })),
        closingLine: 'Stay informed. Have a great day.',
        readTime:    '2 min read',
      };
    }

    // Cache until end of day
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 0);

    await supabase.from('digest_cache').upsert({
      cache_key:  cacheKey,
      digest:     briefing,
      fetched_at: new Date().toISOString(),
      expires_at: endOfDay.toISOString(),
    }, { onConflict: 'cache_key' });

    return response.status(200).json({
      success:   true,
      fromCache: false,
      country:   country.toUpperCase(),
      date:      today,
      briefing,
    });

  } catch (error) {
    console.error('Briefing error:', error.message);
    return response.status(500).json({ error: 'Failed to generate briefing.', details: error.message });
  }
};
