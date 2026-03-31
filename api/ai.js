// ============================================================
// FILE: api/ai.js
// REPLACES: digest.js, oneliner.js, briefing.js, enrich.js
// ROUTE via: ?action=digest | oneliner | briefing | enrich
// ============================================================

const { createClient } = require('@supabase/supabase-js');

function inferTopic(headline, description) {
  const text = ((headline || '') + ' ' + (description || '')).toLowerCase();
  if (/\btech\b|\bai\b|\bsoftware\b|\bdigital\b|\bcyber\b|\bstartup\b|\bgoogle\b|\bapple\b|\bmicrosoft\b|\bmeta\b|\bopenai\b/.test(text))
    return { topic: 'tech', label: 'Tech' };
  if (/\beconomy\b|\bmarket\b|\bbank\b|\binflation\b|\bfinance\b|\btrade\b|\bstock\b|\bgdp\b|\brupee\b|\beuro\b|\bdollar\b|\bfed\b|\brbi\b/.test(text))
    return { topic: 'finance', label: 'Finance' };
  if (/\belection\b|\bparliament\b|\bminister\b|\bgovernment\b|\bvote\b|\bpolicy\b|\bpolitical\b|\bpresident\b|\bcongress\b/.test(text))
    return { topic: 'politics', label: 'Politics' };
  if (/\bfootball\b|\bcricket\b|\bmatch\b|\bleague\b|\btournament\b|\bsport\b|\bolympic\b|\bipl\b|\bnba\b|\bnfl\b/.test(text))
    return { topic: 'sports', label: 'Sports' };
  if (/\bclimate\b|\benergy\b|\brenewable\b|\bemission\b|\benvironment\b|\bsolar\b|\bgreen\b/.test(text))
    return { topic: 'climate', label: 'Climate' };
  return { topic: 'world', label: 'World' };
}

const COUNTRY_NAMES = {
  in: 'India', us: 'United States', gb: 'United Kingdom',
  au: 'Australia', de: 'Germany', sg: 'Singapore',
  ae: 'UAE', jp: 'Japan',
};

async function callClaude(apiKey, system, userMsg, maxTokens = 1000) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.[0]?.text || '';
}

function parseJSON(raw) {
  try { return JSON.parse(raw); } catch {}
  try { return JSON.parse(raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()); } catch {}
  try { const m = raw.match(/[\[{][\s\S]*[\]}]/); if (m) return JSON.parse(m[0]); } catch {}
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const OPENAI_KEY    = process.env.OPENAI_API_KEY;
  const GNEWS_KEY     = process.env.GNEWS_API_KEY;
  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY;
  const supabase      = createClient(SUPABASE_URL, SUPABASE_KEY);

  const params  = req.method === 'POST' ? req.body : req.query;
  const action  = req.query.action || params.action || 'digest';

  // ── ACTION: oneliner ─────────────────────────────────────────
  if (action === 'oneliner') {
    const { articles = [], countries = ['us'], interests = [], ts } = params;
    const skipCache = !!ts; // skip cache on explicit refresh calls
    const top4 = (Array.isArray(articles) ? articles : []).slice(0, 4);
    if (!top4.length) return res.status(400).json({ error: 'No articles.' });

    const countriesArr = Array.isArray(countries) ? countries : [countries];
    const interestsArr = Array.isArray(interests) ? interests : (interests ? interests.split(',') : []);

    function hashStr(s) {
      let h = 0;
      for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h = h & h; }
      return Math.abs(h).toString(36);
    }
    const headlineHash = hashStr(top4.map(a => a.headline).join('|'));
    const cacheKey     = `oneliner-${countriesArr.sort().join('-')}-${headlineHash}`.slice(0, 100);

    try {
      const { data: cached } = await supabase.from('digest_cache').select('digest')
        .eq('cache_key', cacheKey).gt('expires_at', new Date().toISOString()).single();
      if (cached?.digest && !Array.isArray(cached.digest) && Object.keys(cached.digest).length > 0) {
        return res.status(200).json({ success: true, fromCache: true, onelinerMap: cached.digest });
      }
    } catch (e) {}

    const locationStr   = countriesArr.map(c => COUNTRY_NAMES[c] || c.toUpperCase()).join(', ');
    const interestLabel = interestsArr.length ? interestsArr.join(', ') : 'general news';
    const headlinesList = top4.map((a, i) => `${i + 1}. ${a.headline} (${a.source || 'Unknown'})`).join('\n');

    try {
      const raw = await callClaude(
        ANTHROPIC_KEY,
        `You write sharp AI briefs for news-savvy professionals following ${locationStr}, interested in ${interestLabel}.
For each headline write 2-3 sentences answering: "What does this mean for me and what should I watch next?"
Rules:
- Sentence 1: The immediate consequence or impact — specific number, name, or action
- Sentence 2: Why it matters to someone in ${locationStr} interested in ${interestLabel}
- Sentence 3 (optional): What to watch for next — upcoming decision, date, or risk
- NEVER restate or paraphrase the headline
- Never use: "this means", "experts say", "according to", "it is worth noting"
- Each brief: 30-50 words maximum
- Respond ONLY with a JSON array of exactly 4 strings starting with [`,
        `Headlines:\n${headlinesList}\n\nReturn JSON array of 4 briefs (30-50 words each). Start with [`
        , 1500
      );

      let oneliners = parseJSON(raw);
      if (!Array.isArray(oneliners)) oneliners = top4.map(() => '');
      while (oneliners.length < 4) oneliners.push('');
      oneliners = oneliners.slice(0, 4).map(s => String(s || ''));

      const onelinerMap = {};
      top4.forEach((a, i) => {
        const key = (a.headline || '').slice(0, 60).toLowerCase().replace(/[^a-z0-9]/g, '');
        onelinerMap[key] = oneliners[i];
      });

      try {
        await supabase.from('digest_cache').upsert({
          cache_key: cacheKey, digest: onelinerMap,
          fetched_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'cache_key' });
      } catch (e) {}

      return res.status(200).json({ success: true, fromCache: false, headlineHash, onelinerMap });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── ACTION: digest ────────────────────────────────────────────
  if (action === 'digest') {
    const { countries = 'us', interests = '' } = params;
    const countriesList = Array.isArray(countries)
      ? countries : countries.split(',').map(c => c.trim()).filter(Boolean);
    const interestsList = interests
      ? interests.split(',').map(i => i.trim()).filter(Boolean) : [];

    const today    = new Date().toISOString().slice(0, 10);
    const cacheKey = `digest-${countriesList.sort().join('-')}-${interestsList.sort().join('-')}-${today}`.slice(0, 100);

    try {
      const { data: cached } = await supabase.from('digest_cache').select('digest')
        .eq('cache_key', cacheKey).gt('expires_at', new Date().toISOString()).single();
      if (cached?.digest?.stories?.length > 0) {
        return res.status(200).json({ success: true, fromCache: true, ...cached.digest });
      }
    } catch (e) {}

    try {
      const allRaw = [];
      const interestCatMap = { finance:'business', tech:'technology', sports:'sports', climate:'science' };
      const fetches = [];
      for (const country of countriesList) {
        fetches.push(
          fetch(`https://gnews.io/api/v4/top-headlines?category=general&lang=en&country=${country}&max=8&apikey=${GNEWS_KEY}`)
            .then(r => r.json()).then(d => (d.articles || []).map(a => ({ ...a, _country: country }))).catch(() => [])
        );
        for (const interest of interestsList.slice(0, 2)) {
          const cat = interestCatMap[interest];
          if (cat) {
            fetches.push(
              fetch(`https://gnews.io/api/v4/top-headlines?category=${cat}&lang=en&country=${country}&max=5&apikey=${GNEWS_KEY}`)
                .then(r => r.json()).then(d => (d.articles || []).map(a => ({ ...a, _country: country }))).catch(() => [])
            );
          }
        }
      }
      const results = await Promise.all(fetches);
      allRaw.push(...results.flat());

      const seen = new Set();
      const unique = allRaw.filter(a => {
        const k = a.title?.slice(0, 50).toLowerCase().replace(/[^a-z]/g, '');
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
      });

      const countryLabels  = countriesList.map(c => COUNTRY_NAMES[c] || c).join(', ');
      const interestLabels = interestsList.length ? interestsList.join(', ') : 'general news';
      const headlinesList  = unique.slice(0, 30).map((a, i) =>
        `${i + 1}. [${COUNTRY_NAMES[a._country] || a._country}] [${a.source?.name || 'Unknown'}] ${a.title}${a.description ? ` — ${a.description.slice(0, 100)}` : ''}`
      ).join('\n');

      const raw = await callClaude(
        ANTHROPIC_KEY,
        `You are Verityn's intelligence editor. The reader follows news from ${countryLabels} and is interested in ${interestLabels}.
Pick the 10 most significant stories. For each:
- headline: sharp rewritten headline
- topic: one of world/tech/finance/politics/sports/climate
- topicLabel: World/Tech/Finance/Politics/Sports/Climate
- source: publication name
- country: country code
- narrative: 2-3 sentences what happened
- whyItMatters: 2 sentences specific to someone following ${countryLabels} interested in ${interestLabels}
- keyFact: one specific number, date, or name
- bias: Left/Centre-Left/Centre/Centre-Right/Right/Unknown
- velocity: high/med/low
Respond ONLY with valid JSON array starting with [`,
        `Headlines from ${countryLabels}:\n\n${headlinesList}\n\nReturn JSON array of 10 stories. Start with [`
        , 4000
      );

      let stories = parseJSON(raw);
      if (!Array.isArray(stories)) stories = [];
      stories = stories.slice(0, 10).map(s => ({
        ...s,
        ...(!s.topic ? inferTopic(s.headline, s.narrative) : {}),
      }));

      // Brief sentence
      const topHeadlines = stories.slice(0, 5).map(s => s.headline).join('; ');
      const briefLine = await callClaude(
        ANTHROPIC_KEY,
        `One sentence. Editorial voice. Mood of today's news for someone following ${countryLabels}. No clichés. Under 25 words.`,
        `Top stories: ${topHeadlines}\n\nWrite the one sentence morning brief.`,
        80
      );

      const digestData = {
        briefLine: briefLine.trim(),
        stories, countries: countriesList, interests: interestsList,
        countryLabels, generatedAt: new Date().toISOString(),
      };

      const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
      try {
        await supabase.from('digest_cache').upsert({
          cache_key: cacheKey, digest: digestData,
          fetched_at: new Date().toISOString(),
          expires_at: endOfDay.toISOString(),
        }, { onConflict: 'cache_key' });
      } catch (e) {}

      return res.status(200).json({ success: true, fromCache: false, ...digestData });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── ACTION: enrich ────────────────────────────────────────────
  if (action === 'enrich') {
    const { headline = '', summary = '', source = '' } = params;
    if (!headline) return res.status(400).json({ error: 'headline required' });
    try {
      const raw = await callClaude(
        ANTHROPIC_KEY,
        'You provide sharp, intelligent news analysis. Respond only with valid JSON.',
        `Analyse this article:\nHeadline: "${headline}"\nSummary: "${summary}"\nSource: ${source}\n\nReturn JSON: { "whyItMatters": "2 sentences", "bias": "Left/Centre/Right/Unknown", "keyFact": "one specific stat or name", "aiSummary": "3 sentence summary" }`,
        400
      );
      const analysis = parseJSON(raw);
      if (!analysis) throw new Error('Parse failed');
      return res.status(200).json({ success: true, ...analysis });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }


  // ── ACTION: briefing ─────────────────────────────────────────
  // Selects 7 stories from pool + writes personalised why-lines
  if (action === 'briefing') {
    const { articles = [], countries = ['us'], interests = [], ts } = params;
    const skipCache = !!ts; // skip cache on explicit refresh calls
    const pool         = (Array.isArray(articles) ? articles : []).slice(0, 40);
    const countriesArr = Array.isArray(countries) ? countries : [countries];
    const interestsArr = Array.isArray(interests) ? interests : (interests ? interests.split(',') : []);

    if (pool.length === 0) return res.status(400).json({ error: 'No articles.' });

    const locationStr  = countriesArr.map(c => COUNTRY_NAMES[c] || c.toUpperCase()).join(', ');
    const interestStr  = interestsArr.length ? interestsArr.join(', ') : 'world news';

    // Cache key based on top 20 headlines
    function hashStr(s) {
      let h = 0;
      for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h = h & h; }
      return Math.abs(h).toString(36);
    }
    const cacheKey = `briefing-${countriesArr.sort().join('-')}-${hashStr(pool.slice(0,20).map(a=>a.headline).join('|'))}`.slice(0, 100);

    // Check cache — skip if this is a fresh refresh request
    if (!skipCache) {
      try {
        const { data: cached } = await supabase.from('digest_cache').select('digest')
          .eq('cache_key', cacheKey).gt('expires_at', new Date().toISOString()).single();
        if (cached?.digest?.stories?.length >= 7) {
          return res.status(200).json({ success: true, fromCache: true, ...cached.digest });
        }
      } catch (e) {}
    }

    const headlinesList = pool.map((a, i) =>
      `${i + 1}. ${a.headline} | ${a.source || 'Unknown'} | ${a.country || 'WORLD'} | ${a.topic || 'world'}`
    ).join('\n');

    const prompt = `You are the editor of a personal intelligence briefing for a professional who follows ${locationStr} and is interested in ${interestStr}.

The articles below have already been ranked by semantic relevance using embeddings. Article 1 is most relevant. Trust this ranking.

Select exactly 7. Assign tiers:
- tier 1: single most important story today (1 story only)
- tier 2: stories directly affecting their countries or interests (2-3 stories)
- tier 3: stories every informed person should know (remaining to reach 7)

For each write a why line: one conversational sentence under 20 words, concrete, specific numbers/names where possible.

Also write a mood sentence under 20 words summarising today's news tone. Calm, intelligent, no clichés.

Respond ONLY with valid JSON:
{"mood":"string","stories":[{"index":number,"tier":1,"why":"string"}]}

Articles:
${headlinesList}`;

    try {
      const raw = await callClaude(ANTHROPIC_KEY, 'You are a news editor creating a personalised intelligence briefing.', prompt, 600);
      const clean = raw.replace(/\`\`\`json|\`\`\`/g, '').trim();
      const parsed = JSON.parse(clean);

      if (!parsed.stories || parsed.stories.length < 7) {
        return res.status(500).json({ error: 'Briefing generation failed — insufficient stories.' });
      }

      // Map back to full article objects
      const briefingStories = parsed.stories.map(s => ({
        ...pool[s.index - 1],
        tier: s.tier,
        why:  s.why,
      })).filter(s => s.headline);

      const result = { mood: parsed.mood, stories: briefingStories };

      // Cache for 3 hours
      try {
        await supabase.from('digest_cache').upsert({
          cache_key:  cacheKey,
          digest:     result,
          fetched_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'cache_key' });
      } catch (e) {}

      return res.status(200).json({ success: true, fromCache: false, ...result });
    } catch (e) {
      return res.status(500).json({ error: 'Briefing generation failed: ' + e.message });
    }
  }


  // ── ACTION: rank ─────────────────────────────────────────────
  // Layer 1: rule-based filter
  // Layer 2: OpenAI embeddings for semantic relevance scoring
  // Returns articles sorted by relevance to user profile
  if (action === 'rank') {
    const { articles = [], countries = ['us'], interests = [] } = params;
    const countriesArr = Array.isArray(countries) ? countries : [countries];
    const interestsArr = Array.isArray(interests) ? interests : (interests ? interests.split(',') : []);
    const pool = (Array.isArray(articles) ? articles : []).slice(0, 60);

    if (pool.length === 0) return res.status(200).json({ success: true, articles: [] });

    // ── Layer 1: Rule-based filter ──────────────────────────────
    const NOISE_PATTERNS = /taylor swift|kardashian|celebrity|red carpet|oscars|emmys|grammys|iheartradio|nfl draft|nba trade|cricket score|match preview|recipe|horoscope|zodiac|best buy|sale deal|review.*car|suv reveal|movie review|box office|reality tv|news bulletin|midday update|morning update|evening update|daily digest|weekly roundup|newsletter|podcast episode/i;
    const userWantsSports = interestsArr.includes('sports');

    const filtered = pool.filter(a => {
      if (!a.headline || a.headline.length < 15) return false;
      if (NOISE_PATTERNS.test(a.headline)) return false;
      if (!userWantsSports && /\b(nba|nfl|ipl|premier league|cricket|football score|match result|tournament bracket)\b/i.test(a.headline)) return false;
      return true;
    });

    const candidates = filtered.length >= 10 ? filtered : pool.slice(0, 30);

    // ── Layer 2: Semantic embedding ranking ─────────────────────
    if (!OPENAI_KEY) {
      // Fallback: rule-based scoring without embeddings
      const COUNTRY_NAMES_FULL = {
        de: 'germany german', in: 'india indian', us: 'america american united states',
        gb: 'britain british uk england', au: 'australia australian',
        sg: 'singapore', ae: 'uae dubai emirates', jp: 'japan japanese',
      };
      const INTEREST_TERMS = {
        finance:   'finance economy market bank inflation stock gdp trade rupee dollar euro fed rbi',
        tech:      'technology ai software digital cyber startup chip semiconductor',
        politics:  'politics election parliament government minister president policy',
        sports:    'sports football cricket match league tournament',
        climate:   'climate energy renewable emission environment solar green',
        world:     'world global international',
      };
      const profileTerms = [
        ...countriesArr.map(c => COUNTRY_NAMES_FULL[c] || c),
        ...interestsArr.map(i => INTEREST_TERMS[i] || i),
      ].join(' ').toLowerCase();

      const scored = candidates.map(a => {
        const text = ((a.headline || '') + ' ' + (a.summary || '')).toLowerCase();
        let score = 0;
        profileTerms.split(' ').forEach(term => {
          if (term.length > 2 && text.includes(term)) score += 1;
        });
        const hoursOld = (Date.now() - new Date(a.publishedAt)) / 3600000;
        score += Math.max(0, 5 - hoursOld * 0.2);
        return { ...a, relevanceScore: score };
      }).sort((a, b) => b.relevanceScore - a.relevanceScore);

      return res.status(200).json({ success: true, articles: scored.slice(0, 12), method: 'rule-based' });
    }

    // Build rich user profile text for embedding
    const COUNTRY_CONTEXT = {
      de: 'Germany German economy DAX Bundesbank Berlin Frankfurt European Union',
      in: 'India Indian economy Sensex Nifty RBI rupee Mumbai Delhi Bangalore',
      us: 'United States America economy Federal Reserve Wall Street markets',
      gb: 'United Kingdom Britain England economy Bank of England FTSE London',
      au: 'Australia economy ASX Reserve Bank Sydney Melbourne',
      sg: 'Singapore economy MAS Straits Times Southeast Asia',
      ae: 'UAE Dubai Abu Dhabi economy Gulf Middle East',
      jp: 'Japan economy Bank of Japan Nikkei Tokyo yen',
    };
    const INTEREST_CONTEXT = {
      finance:   'finance economy markets stocks bonds inflation interest rates banking investment GDP trade',
      tech:      'technology artificial intelligence software digital innovation startups semiconductor chips cybersecurity',
      politics:  'politics government elections parliament policy legislation foreign affairs diplomacy',
      sports:    'sports football cricket tennis athletics competition tournament championship',
      climate:   'climate change energy renewable sustainability emissions environment carbon green',
      world:     'global international world affairs geopolitics conflict humanitarian',
    };

    const profileText = [
      ...countriesArr.map(c => COUNTRY_CONTEXT[c] || c),
      ...interestsArr.map(i => INTEREST_CONTEXT[i] || i),
    ].join('. ');

    // Build texts to embed: profile first, then each article
    const textsToEmbed = [
      profileText,
      ...candidates.map(a => `${a.headline}. ${(a.summary || '').slice(0, 200)}`),
    ];

    try {
      const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: textsToEmbed,
        }),
      });

      const embedData = await embedRes.json();
      if (embedData.error) throw new Error(embedData.error.message);

      const embeddings = embedData.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
      const profileEmbedding = embeddings[0];
      const articleEmbeddings = embeddings.slice(1);

      // Cosine similarity
      function cosineSimilarity(a, b) {
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < a.length; i++) {
          dot  += a[i] * b[i];
          magA += a[i] * a[i];
          magB += b[i] * b[i];
        }
        return dot / (Math.sqrt(magA) * Math.sqrt(magB));
      }


    // Country-specific terms for content-based relevance bonus
    const COUNTRY_TERMS = {
      de: ['germany','german','berlin','frankfurt','munich','hamburg','bundesbank','bundestag','bundesrat','scholz','merz','dax','volkswagen','siemens','bayer','deutsche bank','eurobond','bundesliga'],
      in: ['india','indian','delhi','mumbai','bangalore','chennai','kolkata','rbi','sensex','nifty','rupee','modi','bjp','congress','tata','infosys','reliance','adani'],
      us: ['america','american','united states','washington','new york','california','federal reserve','fed','nasdaq','dow jones','s&p','biden','trump','senate','congress','pentagon'],
      gb: ['britain','british','uk','england','london','edinburgh','bank of england','ftse','sterling','pound','sunak','labour','tory','brexit','parliament','downing street'],
      au: ['australia','australian','sydney','melbourne','brisbane','reserve bank','asx','albanese','canberra'],
      sg: ['singapore','singaporean','mas','straits times','lee','jurong','changi'],
      ae: ['uae','dubai','abu dhabi','emirates','gulf','dirham','adnoc','aramco'],
      jp: ['japan','japanese','tokyo','osaka','bank of japan','nikkei','yen','kishida','softbank','toyota','sony'],
    };

    // Build country terms for user's selected countries
    const userCountryTerms = countriesArr.flatMap(c => COUNTRY_TERMS[c] || [c.toLowerCase()]);

      // Score = semantic similarity + recency bonus + country content bonus
      const scored = candidates.map((a, i) => {
        const similarity = cosineSimilarity(profileEmbedding, articleEmbeddings[i]);
        const hoursOld   = (Date.now() - new Date(a.publishedAt)) / 3600000;
        const recency    = Math.max(0, 1 - hoursOld / 48);

        // Country content bonus — does headline/summary mention user's country?
        const articleText = ((a.headline || '') + ' ' + (a.summary || '')).toLowerCase();
        const countryMentions = userCountryTerms.filter(term => articleText.includes(term)).length;
        const countryBonus = Math.min(0.25, countryMentions * 0.08); // max +0.25 boost

        // Final score: semantic relevance + recency + country mention
        const score = (similarity * 0.65) + (recency * 0.15) + countryBonus;
        return { ...a, relevanceScore: Math.round(score * 100) / 100 };
      }).sort((a, b) => b.relevanceScore - a.relevanceScore);

      return res.status(200).json({
        success:  true,
        articles: scored.slice(0, 12),
        method:   'embedding',
        profile:  profileText.slice(0, 100),
      });

    } catch (e) {
      // Embedding failed — fall back to rule-based
      const scored = candidates.map(a => {
        const text = ((a.headline || '') + ' ' + (a.summary || '')).toLowerCase();
        const score = countriesArr.filter(c => text.includes(c)).length +
                      interestsArr.filter(i => text.includes(i)).length;
        return { ...a, relevanceScore: score };
      }).sort((a, b) => b.relevanceScore - a.relevanceScore);
      return res.status(200).json({ success: true, articles: scored.slice(0, 12), method: 'fallback', error: e.message });
    }
  }

  return res.status(400).json({ error: `Unknown action: ${action}. Use: digest | oneliner | enrich | briefing | rank` });
};
