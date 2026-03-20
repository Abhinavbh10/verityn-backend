// ============================================================
// FILE: api/digest.js  (PERSONALISED)
// Accepts city, interests, country for personalised digest
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GNEWS_API_KEY     = process.env.GNEWS_API_KEY;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  // Accept both GET and POST
  const params = request.method === 'POST'
    ? request.body
    : request.query;

  const {
    country   = 'us',
    city      = '',
    interests = '',   // comma-separated: "tech,expat,finance"
  } = params;

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Cache key includes city + interests for personalisation
  const interestStr = Array.isArray(interests) ? interests.join(',') : interests;
  const cacheKey    = `digest-${country}-${city}-${interestStr}`.slice(0, 80);

  // Check cache (1 hour)
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
        country: country.toUpperCase(), city, interests: interestStr,
        digest: cached.digest,
      });
    }
  } catch (e) {}

  try {
    // Fetch headlines — general + city-specific if city provided
    const categories  = ['general', 'technology', 'business'];
    const allArticles = [];

    for (const cat of categories) {
      if (GNEWS_API_KEY) {
        try {
          // General country news
          const url  = `https://gnews.io/api/v4/top-headlines?category=${cat}&lang=en&country=${country}&max=3&apikey=${GNEWS_API_KEY}`;
          const res  = await fetch(url);
          const data = await res.json();
          if (data.articles) allArticles.push(...data.articles.slice(0, 2));
        } catch (e) {}
      }
    }

    // City-specific search if city provided
    if (city && GNEWS_API_KEY) {
      try {
        const cityUrl  = `https://gnews.io/api/v4/search?q=${encodeURIComponent(city)}&lang=en&max=5&apikey=${GNEWS_API_KEY}`;
        const cityRes  = await fetch(cityUrl);
        const cityData = await cityRes.json();
        if (cityData.articles) allArticles.push(...cityData.articles.slice(0, 3));
      } catch (e) {}
    }

    if (allArticles.length === 0) {
      return response.status(500).json({ error: 'No articles fetched.' });
    }

    // Deduplicate
    const seen    = new Set();
    const unique  = allArticles.filter(a => {
      const key = a.title?.slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const headlinesList = unique.slice(0, 10)
      .map((a, i) => `${i + 1}. [${a.source?.name}] ${a.title} — ${a.description || ''}`)
      .join('\n');

    // Build personalisation context
    const countryNames = {
      in: 'India', us: 'United States', gb: 'United Kingdom',
      au: 'Australia', sg: 'Singapore', ae: 'UAE', de: 'Germany', jp: 'Japan'
    };
    const countryName = countryNames[country] || country;

    const interestList = interestStr
      ? interestStr.split(',').map(i => i.trim()).join(', ')
      : 'general news';

    const personaContext = city
      ? `The reader is based in ${city}, ${countryName} and is interested in: ${interestList}.`
      : `The reader is based in ${countryName} and is interested in: ${interestList}.`;

    // Call Claude with personalised context
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
        system:     `You are Verityn's AI editor. ${personaContext} Tailor every story's "whyItMatters" to this specific person — mention local impact, city-specific implications, and their stated interests. Respond ONLY with a valid JSON array. No markdown, no backticks. Start with [ and end with ].`,
        messages: [{
          role:    'user',
          content: `Today's headlines:

${headlinesList}

Create a personalised digest of the 5 most relevant stories for this reader. For each return a JSON object with:
- headline: sharp rewritten headline
- topic: one of Politics, Economy, Tech, Climate, Finance, World, Science, Sports, Local
- narrative: 2-3 sentences on what happened
- trend: 6-8 word trend phrase
- whyItMatters: 2 sentences specifically relevant to someone in ${city || countryName} interested in ${interestList}
- velocity: "high" or "med"
- keyFact: one specific number, date, or statistic

Prioritise stories relevant to ${city || countryName} and the reader's interests (${interestList}).
Return ONLY the JSON array starting with [.`
        }]
      })
    });

    const claudeData = await claudeResponse.json();
    if (claudeData.error) {
      return response.status(500).json({ error: 'Claude error', details: claudeData.error });
    }

    const rawText = claudeData.content?.[0]?.text || '';

    // Robust parsing
    let digestItems = [];
    try { digestItems = JSON.parse(rawText); }
    catch (e1) {
      try {
        const stripped = rawText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
        digestItems = JSON.parse(stripped);
      } catch (e2) {
        try {
          const match = rawText.match(/\[[\s\S]*\]/);
          if (match) digestItems = JSON.parse(match[0]);
        } catch (e3) {
          return response.status(200).json({
            success: false, error: 'Parse failed',
            rawText: rawText.slice(0, 300), digest: [],
          });
        }
      }
    }

    if (!Array.isArray(digestItems)) digestItems = [];

    // Cache 1 hour
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
      city,
      interests:   interestStr,
      personalised: !!(city || interestStr),
      itemCount:   digestItems.length,
      digest:      digestItems,
    });

  } catch (error) {
    return response.status(500).json({ error: 'Digest failed.', details: error.message });
  }
};
