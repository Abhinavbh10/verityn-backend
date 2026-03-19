// ============================================================
// FILE: api/enrich.js  (UPGRADED — Fix 4)
// FIX: Velocity-aware cache TTL
//      High velocity = 30 min cache
//      Med velocity  = 1 hour cache
//      Low velocity  = 3 hour cache
//      Multi-source bias: fetches competing coverage before Claude
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') return response.status(200).end();
  if (request.method !== 'POST')   return response.status(405).json({ error: 'POST only.' });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GNEWS_API_KEY     = process.env.GNEWS_API_KEY;
  const NEWSAPI_KEY       = process.env.NEWSAPI_KEY;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  const {
    headline,
    summary,
    source,
    topic,
    country     = 'in',
    velocity    = 'low',  // passed from the article card
    sourceCount = 1,
  } = request.body;

  if (!headline) return response.status(400).json({ error: 'headline required.' });

  // ── Velocity-aware cache TTL (Fix 4) ──────────────────────
  const ttlMap = { high: 30, med: 60, low: 180 }; // minutes
  const ttl    = ttlMap[velocity] || 180;

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const cacheKey = `enrich-${Buffer.from(headline).toString('base64').slice(0, 40)}-${country}`;

  // ── Check cache ───────────────────────────────────────────
  try {
    const { data: cached } = await supabase
      .from('digest_cache')
      .select('digest, fetched_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (cached) {
      return response.status(200).json({ success: true, fromCache: true, ...cached.digest });
    }
  } catch (e) { /* cache miss */ }

  // ── Fetch competing coverage for bias detection ───────────
  // Fix: Real multi-source input makes bias detection accurate
  let competingCoverage = [];
  const searchQuery = encodeURIComponent(headline.split(' ').slice(0, 6).join(' '));

  try {
    // Search GNews for same story
    if (GNEWS_API_KEY) {
      const gnewsRes  = await fetch(`https://gnews.io/api/v4/search?q=${searchQuery}&lang=en&max=4&apikey=${GNEWS_API_KEY}`);
      const gnewsData = await gnewsRes.json();
      if (gnewsData.articles) {
        competingCoverage.push(...gnewsData.articles.slice(0, 3).map(a => ({
          source:    a.source?.name,
          headline:  a.title,
          summary:   a.description,
        })));
      }
    }

    // Search NewsAPI for same story
    if (NEWSAPI_KEY) {
      const newsapiRes  = await fetch(`https://newsapi.org/v2/everything?q=${searchQuery}&language=en&pageSize=4&sortBy=publishedAt&apiKey=${NEWSAPI_KEY}`);
      const newsapiData = await newsapiRes.json();
      if (newsapiData.articles) {
        competingCoverage.push(...newsapiData.articles
          .filter(a => a.title && a.title !== '[Removed]')
          .slice(0, 3)
          .map(a => ({
            source:   a.source?.name,
            headline: a.title,
            summary:  a.description,
          }))
        );
      }
    }
  } catch (e) {
    // Coverage fetch failed — continue with what we have
    console.error('Coverage fetch failed:', e.message);
  }

  // Deduplicate competing sources
  const uniqueSources = [...new Map(competingCoverage.map(c => [c.source, c])).values()];

  // ── Country context ───────────────────────────────────────
  const countryContext = {
    in: 'India — focus on: Indian rupee, RBI, BSE/NSE, Indian government, India-Pakistan/China relations, Indian states, Indian citizens',
    us: 'United States — focus on: USD, Federal Reserve, Wall Street, US Congress, American foreign policy, US states',
    gb: 'United Kingdom — focus on: GBP, Bank of England, FTSE, Westminster, NHS, Brexit implications',
    au: 'Australia — focus on: AUD, RBA, ASX, Australian government, Asia-Pacific trade, Australian states',
    sg: 'Singapore — focus on: SGD, MAS, STI, Singapore government, ASEAN trade, expat community',
    ae: 'UAE — focus on: AED, oil markets, Gulf Cooperation Council, Dubai/Abu Dhabi economy, regional stability',
    de: 'Germany — focus on: EUR, Bundesbank, DAX, German industry, EU policy, European economy',
    jp: 'Japan — focus on: JPY, Bank of Japan, Nikkei, Japanese government, Asia-Pacific relations',
  };
  const userContext = countryContext[country] || countryContext['us'];

  // ── Build coverage summary for Claude ─────────────────────
  const coverageSummary = uniqueSources.length > 0
    ? uniqueSources.map((c, i) => `${i + 1}. [${c.source}] "${c.headline}" — ${c.summary?.slice(0, 100) || ''}`).join('\n')
    : `Only source: [${source}] "${headline}"`;

  // ── Call Claude ───────────────────────────────────────────
  try {
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: `You are Verityn's AI intelligence engine. You enrich news for a specific country audience.
You have access to how multiple outlets are covering the same story — use this for accurate bias detection.
Respond ONLY with valid JSON. No preamble, no markdown.`,
        messages: [{
          role:    'user',
          content: `Analyse this story for a reader in ${userContext}.

PRIMARY ARTICLE:
Headline: ${headline}
Summary:  ${summary || 'No summary.'}
Source:   ${source || 'Unknown'}

HOW OTHER OUTLETS ARE COVERING IT:
${coverageSummary}

Number of sources covering this: ${uniqueSources.length || 1}

Return a JSON object with exactly 3 keys:

1. "whyItMatters": 3-4 sentences personalised for this country. Be specific — mention actual local institutions, markets, or implications. Do NOT be generic.

2. "bias": Based on the actual coverage above, return exactly one of:
   - "Balanced"  — all outlets frame it similarly
   - "Mixed"     — some variation in framing or emphasis
   - "Divided"   — outlets are framing this very differently

3. "biasNote": One sentence (max 12 words) explaining the bias rating based on what you actually see in the coverage above.

Return ONLY the JSON object.`
        }]
      })
    });

    const claudeData = await claudeResponse.json();
    const rawText    = claudeData.content?.[0]?.text || '{}';

    let enriched = {};
    try {
      enriched = JSON.parse(rawText);
    } catch (e) {
      enriched = {
        whyItMatters: 'This story has significant implications that are still developing.',
        bias:         'Mixed',
        biasNote:     'Coverage varies across different news outlets.',
      };
    }

    // ── Cache with velocity-aware TTL ─────────────────────
    await supabase
      .from('digest_cache')
      .upsert({
        cache_key:  cacheKey,
        digest:     enriched,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + ttl * 60 * 1000).toISOString(),
      }, { onConflict: 'cache_key' });

    return response.status(200).json({
      success:    true,
      fromCache:  false,
      cacheTTLMinutes: ttl,
      sourcesAnalysed: uniqueSources.length,
      ...enriched,
    });

  } catch (error) {
    console.error('Enrich error:', error.message);
    return response.status(500).json({ error: 'Failed to enrich.', details: error.message });
  }
};
