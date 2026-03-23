// ============================================================
// FILE: api/oneliner.js  (NEW)
// PURPOSE: Generates AI one-liners for top 4 leading stories
//          Cache key = hash of headlines — only regenerates
//          when the actual top stories change
// ============================================================

const { createClient } = require('@supabase/supabase-js');

// Simple hash of concatenated headlines
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
  const primaryCountry = Array.isArray(countries) ? countries[0] : 'us';

  if (!articles.length) {
    return response.status(400).json({ error: 'No articles provided.' });
  }

  // Take top 4 only
  const top4 = articles.slice(0, 4);

  // Cache key based on content — not time
  // Only regenerates when the actual headlines change
  const headlineHash = hashHeadlines(top4);
  const countryStr  = Array.isArray(countries) ? countries.join('-') : countries;
  const cacheKey    = `oneliner-${countryStr}-${headlineHash}`.slice(0, 100);

  // Check cache
  try {
    const { data: cached } = await supabase
      .from('digest_cache')
      .select('digest, fetched_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();
    if (cached?.digest && !Array.isArray(cached.digest) && typeof cached.digest === 'object' && Object.keys(cached.digest).length > 0) {
      return response.status(200).json({
        success: true, fromCache: true,
        onelinerMap: cached.digest,
      });
    }
  } catch (e) {}

  // Build location context
  // countryNames already defined above
  const _unused = { in:'India', us:'United States', gb:'UK', de:'Germany', au:'Australia', sg:'Singapore', ae:'UAE', jp:'Japan' };
  const locationStr  = (Array.isArray(countries) ? countries : [countries]).map(c => countryNames[c] || c).join(', ');
  // countryNames already defined above
  const _unused = {
    in: 'India', us: 'United States', gb: 'United Kingdom',
    au: 'Australia', de: 'Germany', sg: 'Singapore',
    ae: 'UAE', jp: 'Japan',
  };
  const countryName = countryNames[country] || country;
  const locationFull = city ? `${city}, ${countryName}` : countryName;

  // Numbered headlines for Claude
  const headlinesList = top4
    .map((a, i) => `${i + 1}. ${a.headline} (${a.source})`)
    .join('\n');

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
        system: `You write one-line news context for busy professionals in ${locationFull}.

Rules — follow every one strictly:
- NEVER restate or paraphrase the headline
- Write WHY it matters to someone living in ${locationFull} RIGHT NOW
- Be specific: name a number, a deadline, a direct impact, or an action to take
- Maximum 12 words per one-liner
- No fluff, no "this means that", no "experts say"
- Personal and direct — write as if texting a smart friend
- Respond ONLY with a JSON array of 4 strings, one per headline
- No markdown, no backticks, no preamble — just the array`,
        messages: [{
          role:    'user',
          content: `Headlines for someone in ${locationFull}:\n${headlinesList}\n\nReturn a JSON array of 4 one-liners, one per headline. Start with [`,
        }],
      }),
    });

    const claudeData = await claudeRes.json();
    if (claudeData.error) throw new Error(claudeData.error.message);

    const rawText = claudeData.content?.[0]?.text || '[]';

    // Parse robustly
    let oneliners = [];
    try { oneliners = JSON.parse(rawText); }
    catch {
      try {
        const match = rawText.match(/\[[\s\S]*\]/);
        if (match) oneliners = JSON.parse(match[0]);
      } catch { oneliners = top4.map(() => ''); }
    }

    // Build a map: normalised headline → oneliner
    // This way the frontend matches by headline, not position
    const onelinerMap = {};
    top4.forEach((article, i) => {
      const key = article.headline.slice(0, 60).toLowerCase().replace(/[^a-z0-9]/g, '');
      onelinerMap[key] = String(oneliners[i] || '');
    });

    // Cache until headlines change — 6 hour max TTL as safety net
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
      countries,
      headlineHash,
      onelinerMap,
    });

  } catch (error) {
    return response.status(500).json({ error: 'One-liner generation failed.', details: error.message });
  }
};
