// ============================================================
// FILE: api/enrich.js  (NEW FILE)
// PURPOSE: Powers all Phase 1 AI intelligence features:
//   1. Personalised "Why it matters" (country + topic aware)
//   2. Bias detection (Balanced / Mixed / Divided)
//   3. AI Digest narrative
// Upload to GitHub → api/enrich.js
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') return response.status(200).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'POST only.' });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!ANTHROPIC_API_KEY) {
    return response.status(500).json({ error: 'ANTHROPIC_API_KEY not configured.' });
  }

  const {
    headline,
    summary,
    source,
    topic,
    country = 'in',   // user's country — personalises the response
    topics  = [],     // user's interest topics
  } = request.body;

  if (!headline) {
    return response.status(400).json({ error: 'headline is required.' });
  }

  // ── Cache key — unique per article + country ──────────────
  const cacheKey = `enrich-${Buffer.from(headline).toString('base64').slice(0, 40)}-${country}`;
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
        success: true,
        fromCache: true,
        ...cached.digest,
      });
    }
  } catch (e) {
    // Cache miss — continue to generate
  }

  // ── Country context for personalisation ──────────────────
  const countryContext = {
    in: 'India — consider impact on Indian economy, rupee, Indian markets, Indian citizens, regional geopolitics with Pakistan/China',
    us: 'United States — consider impact on US economy, dollar, Wall Street, American citizens, US foreign policy',
    gb: 'United Kingdom — consider impact on UK economy, pound, FTSE, British citizens, Brexit implications',
    au: 'Australia — consider impact on Australian economy, AUD, ASX, Australian citizens, Asia-Pacific relations',
    sg: 'Singapore — consider impact on Singapore economy, SGD, regional trade, Southeast Asian relations',
    ae: 'UAE — consider impact on Gulf economy, oil markets, regional stability, expat community',
    de: 'Germany — consider impact on German economy, Euro, DAX, European Union implications',
    jp: 'Japan — consider impact on Japanese economy, yen, Nikkei, Asian geopolitics',
  };

  const userContext = countryContext[country] || countryContext['us'];

  // ── Call Claude for all 3 features at once ────────────────
  try {
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: `You are Verityn's AI intelligence engine. You enrich news articles with personalised context.
You are deeply knowledgeable about global affairs, economics, and geopolitics.
You always personalise your analysis to the user's country context.
Respond ONLY with valid JSON. No preamble, no markdown, no text outside the JSON.`,
        messages: [{
          role: 'user',
          content: `Analyse this news article for a reader in ${userContext}.

ARTICLE:
Headline: ${headline}
Summary: ${summary || 'No summary available.'}
Source: ${source || 'Unknown'}
Topic: ${topic || 'General'}

Return a JSON object with exactly these 3 keys:

1. "whyItMatters": A personalised 3-4 sentence explanation of why this story matters specifically to someone in this country. Be concrete — mention specific local impacts, not generic statements. Start with the most direct impact.

2. "bias": One of exactly three values:
   - "Balanced" — story is covered similarly across political spectrum
   - "Mixed" — some variation in framing across outlets  
   - "Divided" — story is being framed very differently by different outlets

3. "biasNote": One short sentence (max 12 words) explaining the bias rating. Example: "Most outlets agree on facts but differ on implications."

Return ONLY the JSON object. Nothing else.`
        }]
      })
    });

    const claudeData = await claudeResponse.json();
    const rawText = claudeData.content?.[0]?.text || '{}';

    let enriched = {};
    try {
      enriched = JSON.parse(rawText);
    } catch (e) {
      enriched = {
        whyItMatters: 'This story has significant implications for global markets and international relations.',
        bias: 'Mixed',
        biasNote: 'Coverage varies across different news outlets.',
      };
    }

    // ── Cache the result for 2 hours ─────────────────────
    await supabase
      .from('digest_cache')
      .upsert({
        cache_key:  cacheKey,
        digest:     enriched,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'cache_key' });

    return response.status(200).json({
      success: true,
      fromCache: false,
      ...enriched,
    });

  } catch (error) {
    console.error('Enrich error:', error.message);
    return response.status(500).json({
      error: 'Failed to enrich article.',
      details: error.message,
    });
  }
};
