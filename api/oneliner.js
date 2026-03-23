// ============================================================
// FILE: api/oneliner.js
// PURPOSE: Generates AI one-liners for top 4 leading stories
//          Returns a map keyed by normalised headline
//          Cache is content-aware — only regenerates when
//          top stories actually change
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const COUNTRY_NAMES = {
  in: 'India', us: 'United States', gb: 'United Kingdom',
  de: 'Germany', au: 'Australia', sg: 'Singapore',
  ae: 'UAE', jp: 'Japan',
};

function hashHeadlines(articles) {
  const str = articles.map(a => a.headline).join('|');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function normaliseKey(headline) {
  return (headline || '').slice(0, 60).toLowerCase().replace(/[^a-z0-9]/g, '');
}

module.exports = async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const ANTHROPIC_KEY     = process.env.ANTHROPIC_API_KEY;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const supabase          = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { articles = [], countries = ['us'], interests = [] } = request.body || {};

  const countriesArr  = Array.isArray(countries) ? countries : [countries];
  const interestsArr  = Array.isArray(interests) ? interests : (interests ? interests.split(',') : []);
  const top4          = articles.slice(0, 4);

  if (!top4.length) {
    return response.status(400).json({ error: 'No articles provided.' });
  }

  // Cache key based on headline content — not time
  const headlineHash = hashHeadlines(top4);
  const countryStr   = countriesArr.sort().join('-');
  const cacheKey     = `oneliner-${countryStr}-${headlineHash}`.slice(0, 100);

  // Check cache
  try {
    const { data: cached } = await supabase
      .from('digest_cache')
      .select('digest, fetched_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();
    if (
      cached?.digest &&
      !Array.isArray(cached.digest) &&
      typeof cached.digest === 'object' &&
      Object.keys(cached.digest).length > 0
    ) {
      return response.status(200).json({
        success: true, fromCache: true,
        onelinerMap: cached.digest,
      });
    }
  } catch (e) {}

  // Build location context
  const locationStr    = countriesArr.map(c => COUNTRY_NAMES[c] || c.toUpperCase()).join(', ');
  const interestLabel  = interestsArr.length ? interestsArr.join(', ') : 'general news';
  const headlinesList  = top4.map((a, i) => `${i + 1}. ${a.headline} (${a.source || 'Unknown'})`).join('\n');

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: `You write one-line news context for busy professionals following ${locationStr}, interested in ${interestLabel}.

Rules:
- NEVER restate or paraphrase the headline
- Write WHY it matters to someone following ${locationStr} RIGHT NOW
- Be specific: a number, deadline, direct impact, or action to take
- Maximum 12 words
- No fluff, no "this means", no "experts say"
- Respond ONLY with a JSON array of exactly 4 strings
- No markdown, no backticks, no explanation — just the array starting with [`,
        messages: [{
          role:    'user',
          content: `Headlines:\n${headlinesList}\n\nReturn a JSON array of exactly 4 one-liners. Start with [`,
        }],
      }),
    });

    const claudeData = await claudeRes.json();
    if (claudeData.error) throw new Error(claudeData.error.message);

    const rawText = claudeData.content?.[0]?.text || '[]';

    let oneliners = [];
    try { oneliners = JSON.parse(rawText); }
    catch {
      try {
        const match = rawText.match(/\[[\s\S]*\]/);
        if (match) oneliners = JSON.parse(match[0]);
      } catch { oneliners = top4.map(() => ''); }
    }

    while (oneliners.length < 4) oneliners.push('');
    oneliners = oneliners.slice(0, 4).map(s => String(s || ''));

    // Build map keyed by normalised headline
    const onelinerMap = {};
    top4.forEach((article, i) => {
      const key = normaliseKey(article.headline);
      onelinerMap[key] = oneliners[i];
    });

    // Cache for 6 hours max (or until headlines change via content-aware key)
    try {
      await supabase.from('digest_cache').upsert({
        cache_key:  cacheKey,
        digest:     onelinerMap,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'cache_key' });
    } catch (e) {}

    return response.status(200).json({
      success:     true,
      fromCache:   false,
      headlineHash,
      onelinerMap,
    });

  } catch (error) {
    return response.status(500).json({
      error:   'One-liner generation failed.',
      details: error.message,
    });
  }
};
