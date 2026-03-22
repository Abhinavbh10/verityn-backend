// ============================================================
// FILE: api/digest.js  (REBUILT)
// PURPOSE: Multi-country AI digest — 10 stories
//          Fetches from ALL user countries, Claude picks best 10
//          Each story: narrative, why it matters, key fact, bias
// ============================================================

const { createClient } = require('@supabase/supabase-js');

// Same content-based topic inference as rss.js and news.js
function inferTopic(headline, description) {
  const text = ((headline || '') + ' ' + (description || '')).toLowerCase();
  if (/\btech\b|\bai\b|\bsoftware\b|\bdigital\b|\bcyber\b|\bstartup\b|\binternet\b|\bsilicon\b|\bgoogle\b|\bapple\b|\bmicrosoft\b|\bmeta\b|\bopenai\b/.test(text))
    return { topic: 'tech',     label: 'Tech'     };
  if (/\beconomy\b|\bmarket\b|\bbank\b|\binflation\b|\bfinance\b|\btrade\b|\bstock\b|\bgdp\b|\brupee\b|\beuro\b|\bdollar\b|\bsensex\b|\bnifty\b|\bdax\b|\binvestment\b|\bfed\b|\brbi\b/.test(text))
    return { topic: 'finance',  label: 'Finance'  };
  if (/\belection\b|\bparliament\b|\bminister\b|\bgovernment\b|\bvote\b|\bpolicy\b|\bparty\b|\bpolitical\b|\bpresident\b|\bcongress\b|\bsenate\b/.test(text))
    return { topic: 'politics', label: 'Politics' };
  if (/\bfootball\b|\bcricket\b|\bmatch\b|\bleague\b|\btournament\b|\bplayer\b|\bteam\b|\bgoal\b|\bsport\b|\bolympic\b|\bipl\b|\bnba\b|\bnfl\b|\bfifa\b/.test(text))
    return { topic: 'sports',   label: 'Sports'   };
  if (/\bclimate\b|\benergy\b|\brenewable\b|\bemission\b|\benvironment\b|\bsolar\b|\bgreen\b|\bcarbon\b|\bweather\b/.test(text))
    return { topic: 'climate',  label: 'Climate'  };
  return { topic: 'world', label: 'World' };
}

const COUNTRY_NAMES = {
  in: 'India', us: 'United States', gb: 'United Kingdom',
  au: 'Australia', de: 'Germany', sg: 'Singapore',
  ae: 'UAE', jp: 'Japan',
};

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const ANTHROPIC_KEY     = process.env.ANTHROPIC_API_KEY;
  const GNEWS_KEY         = process.env.GNEWS_API_KEY;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const supabase          = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Accept both GET and POST
  const params = request.method === 'POST' ? request.body : request.query;

  const {
    countries  = 'us',      // comma-separated: "in,de,us"
    interests  = '',        // comma-separated: "finance,tech"
  } = params;

  const countriesList = Array.isArray(countries)
    ? countries
    : countries.split(',').map(c => c.trim()).filter(Boolean);

  const interestsList = interests
    ? interests.split(',').map(i => i.trim()).filter(Boolean)
    : [];

  // Cache key — daily, unique per country+interest combination
  const today    = new Date().toISOString().slice(0, 10);
  const cacheKey = `digest-${countriesList.sort().join('-')}-${interestsList.sort().join('-')}-${today}`.slice(0, 100);

  // Check cache
  try {
    const { data: cached } = await supabase
      .from('digest_cache')
      .select('digest, fetched_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();
    if (cached?.digest?.stories?.length > 0) {
      return response.status(200).json({
        success: true, fromCache: true,
        ...cached.digest,
      });
    }
  } catch (e) {}

  try {
    // ── Fetch headlines from ALL selected countries ───────────
    const allRaw = [];

    const fetchPromises = [];
    for (const country of countriesList) {
      // General headlines per country
      fetchPromises.push(
        fetch(`https://gnews.io/api/v4/top-headlines?category=general&lang=en&country=${country}&max=8&apikey=${GNEWS_KEY}`)
          .then(r => r.json())
          .then(d => (d.articles || []).map(a => ({ ...a, _country: country })))
          .catch(() => [])
      );
      // Interest-specific per country
      const interestCatMap = {
        finance: 'business', tech: 'technology', sports: 'sports',
        climate: 'science', politics: 'general',
      };
      for (const interest of interestsList.slice(0, 2)) {
        const cat = interestCatMap[interest];
        if (cat && cat !== 'general') {
          fetchPromises.push(
            fetch(`https://gnews.io/api/v4/top-headlines?category=${cat}&lang=en&country=${country}&max=5&apikey=${GNEWS_KEY}`)
              .then(r => r.json())
              .then(d => (d.articles || []).map(a => ({ ...a, _country: country })))
              .catch(() => [])
          );
        }
      }
    }

    const results = await Promise.all(fetchPromises);
    allRaw.push(...results.flat());

    if (allRaw.length === 0) {
      return response.status(500).json({ error: 'No articles fetched.' });
    }

    // Deduplicate
    const seen   = new Set();
    const unique = allRaw.filter(a => {
      const k = a.title?.slice(0, 50).toLowerCase().replace(/[^a-z]/g, '');
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Build numbered list for Claude — include country context
    const headlinesList = unique.slice(0, 30).map((a, i) =>
      `${i + 1}. [${COUNTRY_NAMES[a._country] || a._country}] [${a.source?.name || 'Unknown'}] ${a.title}${a.description ? ` — ${a.description.slice(0, 100)}` : ''}`
    ).join('\n');

    // Build location + interest context for Claude
    const countryLabels  = countriesList.map(c => COUNTRY_NAMES[c] || c).join(', ');
    const interestLabels = interestsList.length ? interestsList.join(', ') : 'general news';

    // ── Single Claude call — picks 10, writes full analysis ──
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: `You are Verityn's intelligence editor. The reader follows news from ${countryLabels} and is interested in ${interestLabels}.

Your job: pick the 10 most significant stories from the headlines provided and write sharp, intelligent analysis for each.

Rules:
- Prioritise stories relevant to ${countryLabels} and ${interestLabels}
- "whyItMatters" must be specific to someone following ${countryLabels} — mention cross-country implications where relevant
- "bias" is one word: Left / Centre-Left / Centre / Centre-Right / Right / Unknown
- "keyFact" is one specific number, date, name, or statistic from the story
- "narrative" is 2-3 sentences max — what happened and immediate context
- Never pad, never waffle, never use "importantly" or "notably"
- Respond ONLY with valid JSON array. No markdown. No backticks. Start with [`,

        messages: [{
          role:    'user',
          content: `Today's headlines from ${countryLabels}:\n\n${headlinesList}\n\nPick the 10 most significant. Return a JSON array where each item has:\n- headline: sharp rewritten headline (not a copy of original)\n- topic: one of world/tech/finance/politics/sports/climate\n- topicLabel: one of World/Tech/Finance/Politics/Sports/Climate\n- source: publication name\n- country: country code (in/us/gb/de/au/sg/ae/jp)\n- narrative: 2-3 sentences on what happened\n- whyItMatters: 2 sentences specific to someone following ${countryLabels} interested in ${interestLabels}\n- keyFact: one specific number, date, or name\n- bias: Left/Centre-Left/Centre/Centre-Right/Right/Unknown\n- velocity: high/med/low\n\nStart with [`,
        }],
      }),
    });

    const claudeData = await claudeRes.json();
    if (claudeData.error) throw new Error(claudeData.error.message);

    const rawText = claudeData.content?.[0]?.text || '[]';

    // Robust JSON parsing
    let stories = [];
    try { stories = JSON.parse(rawText); }
    catch {
      try {
        const stripped = rawText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
        stories = JSON.parse(stripped);
      } catch {
        try {
          const match = rawText.match(/\[[\s\S]*\]/);
          if (match) stories = JSON.parse(match[0]);
        } catch {
          return response.status(200).json({ success: false, error: 'Parse failed', stories: [] });
        }
      }
    }

    if (!Array.isArray(stories)) stories = [];

    // Ensure max 10 and apply content-based topic as safety check
    stories = stories.slice(0, 10).map(s => {
      const inferred = inferTopic(s.headline, s.narrative);
      return {
        ...s,
        topic:      s.topic      || inferred.topic,
        topicLabel: s.topicLabel || inferred.label,
      };
    });

    // Build morning brief sentence from the stories
    const topHeadlines = stories.slice(0, 5).map(s => s.headline).join('; ');
    const briefRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 80,
        system:     `One sentence. Editorial voice. Captures the mood of today's news for someone following ${countryLabels}. No clichés. Under 25 words. No quotes.`,
        messages:   [{ role: 'user', content: `Top stories today: ${topHeadlines}\n\nWrite the one sentence morning brief.` }],
      }),
    });

    const briefData  = await briefRes.json();
    const briefLine  = briefData.content?.[0]?.text?.trim() || '';

    const digestData = {
      briefLine,
      stories,
      countries:  countriesList,
      interests:  interestsList,
      countryLabels,
      generatedAt: new Date().toISOString(),
    };

    // Cache until end of day
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    try {
      await supabase.from('digest_cache').upsert({
        cache_key:  cacheKey,
        digest:     digestData,
        fetched_at: new Date().toISOString(),
        expires_at: endOfDay.toISOString(),
      }, { onConflict: 'cache_key' });
    } catch (e) {}

    return response.status(200).json({ success: true, fromCache: false, ...digestData });

  } catch (error) {
    return response.status(500).json({ error: 'Digest failed.', details: error.message });
  }
};
