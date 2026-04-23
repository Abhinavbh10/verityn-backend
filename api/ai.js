// ============================================================
// FILE: api/ai.js
// ACTIONS: digest | oneliner | briefing | rank | aisearch
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, logError } = require('./_helpers');

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
  const VERCEL_URL    = process.env.VERCEL_URL || 'https://verityn-backend-ten.vercel.app';
  const supabase      = createClient(SUPABASE_URL, SUPABASE_KEY);

  const params = req.method === 'POST' ? req.body : req.query;
  const action = req.query.action || params.action || 'digest';
  const sessionId = req.query.sessionId || params.sessionId || 'anonymous';

  // ── ACTION: oneliner ─────────────────────────────────────────
  if (action === 'oneliner') {
    const rl = await checkRateLimit(supabase, sessionId, 'oneliner');
    if (!rl.allowed) return res.status(429).json({ error: 'Rate limit exceeded.', resetAt: rl.resetAt });
    const { articles = [], countries = ['us'], interests = [], ts } = params;
    const skipCache    = !!ts;
    const top4         = (Array.isArray(articles) ? articles : []).slice(0, 4);
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

    if (!skipCache) {
      try {
        const { data: cached } = await supabase.from('digest_cache').select('digest')
          .eq('cache_key', cacheKey).gt('expires_at', new Date().toISOString()).single();
        if (cached?.digest && !Array.isArray(cached.digest) && Object.keys(cached.digest).length > 0) {
          return res.status(200).json({ success: true, fromCache: true, onelinerMap: cached.digest });
        }
      } catch (e) {}
    }

    const locationStr   = countriesArr.map(c => COUNTRY_NAMES[c] || c.toUpperCase()).join(', ');
    const interestLabel = interestsArr.length ? interestsArr.join(', ') : 'general news';
    const headlinesList = top4.map((a, i) => `${i + 1}. ${a.headline} (${a.source || 'Unknown'})`).join('\n');

    const systemPrompt = `You write sharp intelligence briefs for professionals following ${locationStr}, interested in ${interestLabel}.

For each headline write EXACTLY 50-60 words across 3 sentences:
Sentence 1: The specific fact — what happened, with a number, name, or concrete detail.
Sentence 2: Why it matters to someone in ${locationStr} interested in ${interestLabel}.
Sentence 3: One forward-looking signal — what to watch or expect next.

Rules:
- Count words carefully. 50 minimum, 60 maximum. No exceptions.
- Never use vague phrases like "significant", "notable", "worth noting".
- Always use specific names, numbers, places.

Return ONLY a JSON object: {"1": "50-60 word summary...", "2": "50-60 word summary..."}
No markdown, no explanation.`;

    try {
      const raw   = await callClaude(ANTHROPIC_KEY, systemPrompt, `Headlines:\n${headlinesList}`, 600);
      const clean = raw.replace(/```json|```/g, '').trim();
      const map   = {};
      try {
        Object.assign(map, JSON.parse(clean));
      } catch {
        const m = clean.match(/{[\s\S]*}/);
        if (m) try { Object.assign(map, JSON.parse(m[0])); } catch {}
      }
      if (Object.keys(map).length > 0) {
        try {
          await supabase.from('digest_cache').upsert({
            cache_key:  cacheKey,
            digest:     map,
            fetched_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          }, { onConflict: 'cache_key' });
        } catch (e) {}
        return res.status(200).json({ success: true, fromCache: false, onelinerMap: map });
      }
      return res.status(200).json({ success: false, onelinerMap: {} });
    } catch (e) {
      await logError(supabase, { endpoint: 'ai', action: 'oneliner', error: e, sessionId });
      return res.status(500).json({ error: 'Oneliner failed: ' + e.message });
    }
  }

  // ── ACTION: briefing ─────────────────────────────────────────
  if (action === 'briefing') {
    const rl = await checkRateLimit(supabase, sessionId, 'briefing');
    if (!rl.allowed) return res.status(429).json({ error: 'Rate limit exceeded.', resetAt: rl.resetAt });

    const { articles = [], countries = ['us'], interests = [], location, profession, ts } = params;
    const skipCache    = !!ts;
    const pool         = (Array.isArray(articles) ? articles : []).slice(0, 40);
    const countriesArr = Array.isArray(countries) ? countries : [countries];
    const interestsArr = Array.isArray(interests) ? interests : (interests ? interests.split(',') : []);
    if (pool.length === 0) return res.status(400).json({ error: 'No articles.' });

    const locationStr  = location
      ? (COUNTRY_NAMES[location] || location)
      : countriesArr.map(c => COUNTRY_NAMES[c] || c.toUpperCase()).join(', ');
    const interestStr  = interestsArr.length ? interestsArr.join(', ') : 'world news';
    const professionStr = profession || null;

    function hashStr(s) {
      let h = 0;
      for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h = h & h; }
      return Math.abs(h).toString(36);
    }
    const cacheKey = `briefing-${countriesArr.sort().join('-')}-${hashStr(pool.slice(0,20).map(a=>a.headline).join('|'))}`.slice(0, 100);

    if (!skipCache) {
      try {
        const { data: cached } = await supabase.from('digest_cache').select('digest')
          .eq('cache_key', cacheKey).gt('expires_at', new Date().toISOString()).single();
        if (cached?.digest?.stories?.length >= 7) {
          return res.status(200).json({ success: true, fromCache: true, ...cached.digest });
        }
      } catch (e) {}
    }

    // Tag each article's relevance to help Claude make better selections
    const COUNTRY_KEYWORDS = {
      de: 'germany german berlin frankfurt dax bundesbank scholz merz',
      in: 'india indian delhi mumbai rbi sensex nifty rupee modi',
      us: 'america american united states washington fed nasdaq trump',
      gb: 'britain british uk england london ftse sterling pound',
      au: 'australia australian sydney melbourne asx reserve bank',
      sg: 'singapore singaporean mas',
      ae: 'uae dubai abu dhabi emirates gulf',
      jp: 'japan japanese tokyo nikkei yen',
    };
    const GLOBAL_KEYWORDS = /\bwar\b|\bnuclear\b|\bsanctions\b|\bnato\b|\bopec\b|\bg7\b|\bg20\b|\bun\b|\bclimate summit\b|\bglobal\b|\bworld\b/i;
    const userKeywords = countriesArr.flatMap(c => (COUNTRY_KEYWORDS[c] || '').split(' ')).filter(Boolean);

    const headlinesList = pool.map((a, i) => {
      const text = ((a.headline || '') + ' ' + (a.summary || '')).toLowerCase();
      const matchesUser = userKeywords.some(kw => kw.length > 2 && text.includes(kw));
      const isGlobal = GLOBAL_KEYWORDS.test(text);
      const tag = matchesUser ? 'RELEVANT' : isGlobal ? 'GLOBAL' : 'CHECK_RELEVANCE';
      return `${i + 1}. [${tag}] ${a.headline} | ${a.source || 'Unknown'} | ${a.image ? 'HAS_IMAGE' : 'NO_IMAGE'}`;
    }).join('\n');

    const system = `You are a news editor creating a personalised intelligence briefing. \
You write as a knowledgeable friend explaining events to a fellow professional — not as a journalist writing for publication. \
Use plain, direct English. No wire service language. No passive voice. No definitive predictions. \
When describing professional or financial impact, use likelihood language: "analysts expect", "this typically leads to", "watch for", "historically this has meant". \
Never state future outcomes as certain facts. Never give financial, legal, or medical advice. \
Always attribute specific numbers to their source.`;
    const prompt = `You are editing a personal briefing for a professional living in ${locationStr}, interested in ${interestStr}${professionStr ? `, working in ${professionStr}` : ''}.

RELEVANCE RULES — follow these strictly:
1. At least 4 of the 7 stories MUST directly involve or meaningfully affect ${locationStr}. "Meaningfully affect" means the story changes costs, policy, markets, regulations, or daily life there — not just that it happened on the same planet.
2. The remaining 2-3 stories may be global, BUT each must have a clear, specific connection to ${interestStr} or to the professional context of someone in ${locationStr}. Explain this connection in the why-line.
3. NEVER include stories primarily about countries or regions the user does not follow, UNLESS the story has direct, concrete impact on ${locationStr} (e.g. a US Fed rate decision affects global markets — that's fine. Nigerian banking regulation does NOT affect someone in ${locationStr} — reject it).
4. NEVER include celebrity news, sports scores, lifestyle, recipes, entertainment, or health trivia unless the user's interests explicitly include those topics.

Select exactly 7 stories. All 7 carry equal weight — no lead story, no tiers, no hierarchy.
DIVERSITY RULE: The 7 stories MUST cover at least 3 different topic areas. Never pick 4+ stories on the same topic.
SOURCE DIVERSITY: Never pick more than 2 stories from the same news source. If 5 articles are from Politico, pick at most 2 — find the rest from other sources.
STRONGLY PREFER articles marked HAS_IMAGE — the app displays each story with a full-bleed photo. Only pick a NO_IMAGE article if it is significantly more important than all HAS_IMAGE alternatives.

Each article is tagged: [RELEVANT] = directly about the user's location/interests. [GLOBAL] = major world event. [CHECK_RELEVANCE] = may not be relevant — only pick if you can write a strong, specific why-line connecting it to ${locationStr}. When in doubt, skip CHECK_RELEVANCE articles.

Articles are pre-ranked by semantic relevance — article 1 is most relevant. Trust this ranking but apply the relevance rules above.

For each story write a "why" — EXACTLY 2 sentences, 25-35 words total:
Sentence 1: The specific impact on someone living in ${locationStr}${professionStr ? ` working in ${professionStr}` : ''}. Use a number, timeframe, or concrete consequence. NEVER restate what the headline already says.
Sentence 2: What to watch or do — a forward-looking signal, date, or decision point.
Never give financial, legal, or investment advice. Never predict outcomes. Attribute specific claims.

Also write a "mood" sentence (under 20 words) summarising today's news tone. Calm, intelligent, no clichés.

Respond ONLY with valid JSON — no markdown, no explanation:
{
  "mood": "one sentence summarising today",
  "stories": [
    {"index": 1, "why": "2-sentence why-line here"},
    {"index": 3, "why": "2-sentence why-line here"},
    {"index": 5, "why": "2-sentence why-line here"},
    {"index": 7, "why": "2-sentence why-line here"},
    {"index": 9, "why": "2-sentence why-line here"},
    {"index": 11, "why": "2-sentence why-line here"},
    {"index": 12, "why": "2-sentence why-line here"}
  ]
}

Articles:
${headlinesList}`;

    try {
      const raw  = await callClaude(ANTHROPIC_KEY, system, prompt, 800);
      const parsed = parseJSON(raw);
      if (!parsed?.stories || parsed.stories.length < 7) {
        await logError(supabase, { endpoint: 'ai', action: 'briefing', error: 'Insufficient stories returned', context: { storiesCount: parsed?.stories?.length }, sessionId });
        return res.status(500).json({ error: 'Briefing generation failed — insufficient stories.' });
      }
      const briefingStories = parsed.stories
        .filter(s => s.index >= 1 && s.index <= pool.length && s.why)
        .map(s => ({
          ...pool[s.index - 1],
          why:  s.why,
        }))
        .filter(s => s && s.headline);

      // ── #9: Content diversity check ─────────────────────────────
      const topicSet = new Set();
      for (const s of briefingStories) {
        const t = ((s.headline || '') + ' ' + (s.summary || '')).toLowerCase();
        if (/\btech\b|\bai\b|\bsoftware\b|\bchip\b|\bgoogle\b|\bapple\b|\bmicrosoft\b|\bnvidia\b|\bopenai\b/.test(t)) topicSet.add('tech');
        else if (/\bmarket\b|\bbank\b|\binflation\b|\bfed\b|\brbi\b|\becb\b|\bgdp\b|\btrade\b|\btariff\b|\bstock\b|\boil\b/.test(t)) topicSet.add('finance');
        else if (/\belection\b|\bminister\b|\bparliament\b|\bgovernment\b|\bvote\b|\bpolicy\b|\bsenate\b|\bcongress\b/.test(t)) topicSet.add('politics');
        else if (/\bclimate\b|\benergy\b|\bsolar\b|\bemission\b|\brenewable\b/.test(t)) topicSet.add('climate');
        else if (/\bsport\b|\bcricket\b|\bfootball\b|\bnba\b|\bnfl\b|\bolympic\b/.test(t)) topicSet.add('sports');
        else topicSet.add('world');
      }
      if (topicSet.size < 3) {
        console.warn('[DIVERSITY WARNING]', JSON.stringify({
          uniqueTopics: topicSet.size,
          topics: [...topicSet],
          headlines: briefingStories.map(s => s.headline?.slice(0, 40)),
        }));
        await logError(supabase, {
          endpoint: 'ai', action: 'briefing-diversity',
          error: `Only ${topicSet.size} unique topics in briefing`,
          context: { topics: [...topicSet] }, sessionId,
        });
      }

      // ── Relevance check — are stories actually about the user's countries? ──
      const userKws = countriesArr.flatMap(c => (COUNTRY_KEYWORDS[c] || '').split(' ')).filter(k => k.length > 2);
      let relevantCount = 0;
      for (const s of briefingStories) {
        const txt = ((s.headline || '') + ' ' + (s.summary || '') + ' ' + (s.why || '')).toLowerCase();
        if (userKws.some(kw => txt.includes(kw))) relevantCount++;
      }
      if (relevantCount < 4) {
        console.warn('[RELEVANCE WARNING]', JSON.stringify({
          userCountries: countriesArr, relevantCount,
          headlines: briefingStories.map(s => s.headline?.slice(0, 50)),
        }));
        await logError(supabase, {
          endpoint: 'ai', action: 'briefing-relevance',
          error: `Only ${relevantCount}/7 stories relevant to ${countriesArr.join(',')}`,
          context: { countries: countriesArr, relevantCount }, sessionId,
        });
      }

      // ── B9: Why-line production monitoring ──────────────────────
      const whyMonitor = {
        ts: new Date().toISOString(),
        location: locationStr,
        profession: professionStr || 'none',
        storiesReturned: briefingStories.length,
        storiesMissingWhy: briefingStories.filter(s => !s.why).length,
        whyWordCounts: briefingStories.map(s => ({
          headline: (s.headline || '').slice(0, 50),
          hasImage: !!s.image,
          words: s.why ? s.why.split(/\s+/).length : 0,
          hasLocationAngle: s.why ? /daily life|living|commute|housing|cost|local|policy/i.test(s.why) : false,
          hasProfessionAngle: professionStr
            ? new RegExp(professionStr, 'i').test(s.why || '')
              || /analyst|professional|investor|sector|industry|market/i.test(s.why || '')
            : true,
        })),
      };
      const outOfRange = whyMonitor.whyWordCounts.filter(w => w.words > 0 && (w.words < 45 || w.words > 70));
      const missingAngles = whyMonitor.whyWordCounts.filter(w => w.words > 0 && (!w.hasLocationAngle || !w.hasProfessionAngle));
      const missingImages = briefingStories.filter(s => !s.image).length;
      if (briefingStories.length < 7 || outOfRange.length > 0 || missingAngles.length > 0 || missingImages > 0) {
        console.warn('[B9 WHY-LINE MONITOR]', JSON.stringify({
          ...whyMonitor,
          issues: {
            insufficientStories: briefingStories.length < 7,
            storiesMissingImages: missingImages,
            outOfWordRange: outOfRange.map(w => `${w.headline}... (${w.words}w)`),
            missingAngles: missingAngles.map(w => `${w.headline}... (loc:${w.hasLocationAngle},prof:${w.hasProfessionAngle})`),
          },
        }));
      }

      const result = { mood: parsed.mood, stories: briefingStories };
      try {
        await supabase.from('digest_cache').upsert({
          cache_key:  cacheKey, digest: result,
          fetched_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'cache_key' });
      } catch (e) {}
      return res.status(200).json({ success: true, fromCache: false, ...result });
    } catch (e) {
      await logError(supabase, { endpoint: 'ai', action: 'briefing', error: e, context: { poolSize: pool.length }, sessionId });
      return res.status(500).json({ error: 'Briefing generation failed: ' + e.message });
    }
  }

  // ── ACTION: rank ─────────────────────────────────────────────
  if (action === 'rank') {
    const rl = await checkRateLimit(supabase, sessionId, 'rank');
    if (!rl.allowed) return res.status(429).json({ error: 'Rate limit exceeded.', resetAt: rl.resetAt });

    const { articles = [], countries = ['us'], interests = [], location, profession } = params;
    const countriesArr = Array.isArray(countries) ? countries : [countries];
    const interestsArr = Array.isArray(interests) ? interests : (interests ? interests.split(',') : []);
    const pool = (Array.isArray(articles) ? articles : []).slice(0, 60);
    if (pool.length === 0) return res.status(200).json({ success: true, articles: [] });

    const NOISE_PATTERNS = /taylor swift|kardashian|celebrity|red carpet|oscars|emmys|grammys|iheartradio|nfl draft|nba trade|cricket score|match preview|recipe|horoscope|zodiac|best buy|sale deal|movie review|box office|reality tv|news bulletin|midday update|morning update|evening update|daily digest|weekly roundup|newsletter|podcast episode/i;
    const userWantsSports = interestsArr.includes('sports');
    const filtered = pool.filter(a => {
      if (!a.headline || a.headline.length < 15) return false;
      if (NOISE_PATTERNS.test(a.headline)) return false;
      if (!userWantsSports && /\b(nba|nfl|ipl|premier league|cricket|football score|match result|tournament bracket)\b/i.test(a.headline)) return false;
      return true;
    });
    const candidates = filtered.length >= 10 ? filtered : pool.slice(0, 30);

    const COUNTRY_TERMS = {
      de: ['germany','german','berlin','frankfurt','munich','hamburg','bundesbank','bundestag','bundesrat','scholz','merz','dax','volkswagen','siemens','bayer','deutsche bank','bundesliga'],
      in: ['india','indian','delhi','mumbai','bangalore','chennai','kolkata','hyderabad','pune','rbi','sensex','nifty','bse','nse','rupee','inr','modi','bjp','congress','tata','infosys','reliance','adani','wipro','hcl','ola','zomato','sebi','niti'],
      us: ['america','american','united states','washington','federal reserve','fed','nasdaq','dow jones','trump','senate','congress','pentagon'],
      gb: ['britain','british','uk','england','london','bank of england','ftse','sterling','pound','sunak','labour','tory','parliament'],
      au: ['australia','australian','sydney','melbourne','reserve bank','asx','albanese'],
      sg: ['singapore','singaporean','mas','changi'],
      ae: ['uae','dubai','abu dhabi','emirates','gulf','dirham','adnoc'],
      jp: ['japan','japanese','tokyo','bank of japan','nikkei','yen','softbank','toyota'],
    };
    const COUNTRY_CONTEXT = {
      de: 'Germany German economy DAX Bundesbank Berlin Frankfurt European Union ECB euro Scholz CDU SPD Bundestag energy Energiewende BMW Volkswagen Siemens SAP Mittelstand manufacturing export housing',
      in: 'India Indian economy Sensex Nifty NSE BSE RBI rupee rupee Mumbai Delhi Bangalore Hyderabad startup fintech IT services pharmaceutical manufacturing SEBI budget fiscal',
      us: 'United States America economy Federal Reserve Wall Street markets',
      gb: 'United Kingdom Britain England economy Bank of England FTSE London sterling pound City finance treasury gilts mortgage housing NHS Parliament Westminster Chancellor inflation CPI',
      au: 'Australia economy ASX RBA Reserve Bank Sydney Melbourne Brisbane Perth iron ore mining resources housing property inflation CPI superannuation budget immigration',
      sg: 'Singapore economy MAS Southeast Asia SGD DBS OCBC UOB fintech banking housing HDB CPF GST trade port technology hub wealth management ASEAN',
      ae: 'UAE Dubai Abu Dhabi economy Gulf Middle East',
      jp: 'Japan economy Bank of Japan Tokyo Osaka yen Nikkei Sony Toyota Honda Softbank semiconductor automotive manufacturing aging deflation BOJ LDP Kishida',
    };
    const INTEREST_CONTEXT = {
      finance:  'finance economy markets stocks bonds inflation interest rates banking investment GDP trade',
      tech:     'technology artificial intelligence software digital innovation startups semiconductor chips cybersecurity',
      politics: 'politics government elections parliament policy legislation foreign affairs diplomacy',
      sports:   'sports football cricket tennis athletics competition tournament championship',
      climate:  'climate change energy renewable sustainability emissions environment carbon green',
      world:    'global international world affairs geopolitics conflict humanitarian',
    };

    const userCountryTerms = countriesArr.flatMap(c => COUNTRY_TERMS[c] || [c.toLowerCase()]);
    const PROFESSION_CONTEXT = {
      finance:  'investment banking financial markets portfolio management trading economics',
      tech:     'software engineering product management AI machine learning startups venture capital',
      business: 'strategy consulting management operations supply chain business development',
      law:      'legal regulation compliance policy government contracts litigation',
      medicine: 'healthcare clinical research public health pharmaceutical medical technology',
      media:    'journalism publishing broadcasting content creative advertising marketing',
      academia: 'research university science publishing data analysis evidence policy',
      other:    'professional career industry work',
    };

    const profileText = [
      ...countriesArr.map(c => COUNTRY_CONTEXT[c] || c),
      ...interestsArr.map(i => INTEREST_CONTEXT[i] || i),
      profession ? (PROFESSION_CONTEXT[profession] || profession) : '',
    ].filter(Boolean).join('. ');

    if (!OPENAI_KEY) {
      const INTEREST_TERMS = {
        finance: 'finance economy market bank inflation stock gdp trade rupee dollar euro fed rbi',
        tech: 'technology ai software digital cyber startup chip semiconductor',
        politics: 'politics election parliament government minister president policy',
        sports: 'sports football cricket match league tournament',
        climate: 'climate energy renewable emission environment solar green',
        world: 'world global international',
      };
      const profileTerms = [
        ...countriesArr.map(c => COUNTRY_CONTEXT[c] || c),
        ...interestsArr.map(i => INTEREST_TERMS[i] || i),
      ].join(' ').toLowerCase();

      const scored = candidates.map(a => {
        const text = ((a.headline || '') + ' ' + (a.summary || '')).toLowerCase();
        let score = 0;
        profileTerms.split(' ').forEach(term => { if (term.length > 2 && text.includes(term)) score++; });
        const hoursOld = (Date.now() - new Date(a.publishedAt)) / 3600000;
        score += Math.max(0, 5 - hoursOld * 0.2);
        return { ...a, relevanceScore: score };
      }).sort((a, b) => b.relevanceScore - a.relevanceScore);
      return res.status(200).json({ success: true, articles: scored.slice(0, 12), method: 'rule-based' });
    }

    const textsToEmbed = [
      profileText,
      ...candidates.map(a => `${a.headline}. ${(a.summary || '').slice(0, 200)}`),
    ];

    try {
      const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: textsToEmbed }),
      });
      const embedData = await embedRes.json();
      if (embedData.error) throw new Error(embedData.error.message);

      const embeddings = embedData.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
      const profileEmbedding = embeddings[0];
      const articleEmbeddings = embeddings.slice(1);

      function cosineSimilarity(a, b) {
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; magA += a[i]*a[i]; magB += b[i]*b[i]; }
        return dot / (Math.sqrt(magA) * Math.sqrt(magB));
      }

      // Build a set of "foreign" country terms — countries NOT in the user's profile
      const ALL_COUNTRY_CODES = Object.keys(COUNTRY_TERMS);
      const foreignTerms = ALL_COUNTRY_CODES
        .filter(c => !countriesArr.includes(c))
        .flatMap(c => COUNTRY_TERMS[c] || []);

      const scored = candidates.map((a, i) => {
        const similarity = cosineSimilarity(profileEmbedding, articleEmbeddings[i]);
        const hoursOld   = (Date.now() - new Date(a.publishedAt)) / 3600000;
        const recency    = Math.max(0, 1 - hoursOld / 48);
        const articleText = ((a.headline || '') + ' ' + (a.summary || '')).toLowerCase();

        // Country relevance: how many user-country terms appear
        const countryMentions = userCountryTerms.filter(term => articleText.includes(term)).length;
        const countryBonus = Math.min(0.35, countryMentions * 0.10);

        // Foreign penalty: article is primarily about a country the user doesn't follow
        const foreignMentions = foreignTerms.filter(term => term.length > 3 && articleText.includes(term)).length;
        const foreignPenalty = (foreignMentions >= 2 && countryMentions === 0) ? -0.20 : 0;

        // Global significance override: major geopolitical terms get a pass even if "foreign"
        const isGlobalSignificance = /\bwar\b|\bnuclear\b|\bsanctions\b|\bglobal recession\b|\bpandemic\b|\bclimate summit\b|\bun general assembly\b|\bg7\b|\bg20\b|\bnato\b|\bopec\b/i.test(articleText);
        const globalOverride = (foreignPenalty < 0 && isGlobalSignificance) ? 0.10 : 0;

        const score = (similarity * 0.50) + (recency * 0.15) + countryBonus + foreignPenalty + globalOverride;
        return { ...a, relevanceScore: Math.round(score * 100) / 100 };
      }).sort((a, b) => b.relevanceScore - a.relevanceScore);

      return res.status(200).json({ success: true, articles: scored.slice(0, 12), method: 'embedding' });
    } catch (e) {
      const scored = candidates.map(a => {
        const text = ((a.headline||'')+(a.summary||'')).toLowerCase();
        const score = countriesArr.filter(c => text.includes(c)).length + interestsArr.filter(i => text.includes(i)).length;
        return { ...a, relevanceScore: score };
      }).sort((a, b) => b.relevanceScore - a.relevanceScore);
      return res.status(200).json({ success: true, articles: scored.slice(0, 12), method: 'fallback', error: e.message });
    }
  }

  // ── ACTION: aisearch ─────────────────────────────────────────
  if (action === 'aisearch') {
    const rl = await checkRateLimit(supabase, sessionId, 'aisearch');
    if (!rl.allowed) return res.status(429).json({ error: 'Rate limit exceeded.', resetAt: rl.resetAt });

    const { query = '', countries = ['us'], interests = [] } = params;
    if (!query.trim()) return res.status(400).json({ error: 'query required' });

    const countriesArr = Array.isArray(countries) ? countries : [countries];
    const locationStr  = countriesArr.map(c => COUNTRY_NAMES[c] || c.toUpperCase()).join(', ');

    let articles = [];
    try {
      const fetches = [
        ...countriesArr.map(c =>
          fetch(`${VERCEL_URL}/api/content?action=search&q=${encodeURIComponent(query)}&country=${c}&max=8`)
            .then(r => r.json()).then(d => d.articles || []).catch(() => [])
        ),
      ];
      if (GNEWS_KEY) {
        fetches.push(
          fetch(`https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&max=10&apikey=${GNEWS_KEY}`)
            .then(r => r.json())
            .then(d => (d.articles || []).map(a => ({
              headline: a.title, summary: a.description,
              source: a.source?.name, sourceUrl: a.url, publishedAt: a.publishedAt,
            }))).catch(() => [])
        );
      }
      const all = (await Promise.all(fetches)).flat();
      const seen = new Set();
      articles = all.filter(a => {
        const k = (a.headline || '').slice(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
      }).slice(0, 15);
    } catch (e) {}

    if (articles.length === 0) {
      return res.status(200).json({ success: true, synthesis: null, articles: [], query });
    }

    const articlesList = articles.map((a, i) =>
      `${i + 1}. ${a.headline} (${a.source || 'Unknown'})`
    ).join('\n');

    const system = `You are a personal intelligence analyst for someone following ${locationStr}. Synthesise news into clear, balanced answers. Be specific. No fluff.`;
    const prompt = `User query: "${query}"

Articles found:
${articlesList}

Write a synthesis of 80-120 words that directly answers the query, draws on multiple sources, notes conflicting perspectives if present, and ends with one forward-looking sentence.

Respond ONLY with JSON:
{"synthesis":"your answer here","sourceIndices":[1,3,5],"confidence":"high|medium|low"}`;

    try {
      const raw    = await callClaude(ANTHROPIC_KEY, system, prompt, 400);
      const parsed = parseJSON(raw);
      const sourced = parsed?.sourceIndices
        ? parsed.sourceIndices.map(i => articles[i - 1]).filter(Boolean)
        : articles.slice(0, 5);
      return res.status(200).json({
        success: true, query,
        synthesis:  parsed?.synthesis  || null,
        confidence: parsed?.confidence || 'medium',
        articles:   sourced,
        allArticles: articles,
      });
    } catch (e) {
      return res.status(200).json({ success: true, query, synthesis: null, articles, error: e.message });
    }
  }

  // ── ACTION: digest ───────────────────────────────────────────
  if (action === 'digest') {
    const rl = await checkRateLimit(supabase, sessionId, 'digest');
    if (!rl.allowed) return res.status(429).json({ error: 'Rate limit exceeded.', resetAt: rl.resetAt });

    const { countries = ['us'], interests = [], topic, headline, source } = params;
    const countriesArr = Array.isArray(countries) ? countries : [countries];
    const interestsArr = Array.isArray(interests) ? interests : (interests ? interests.split(',') : []);
    const locationStr  = countriesArr.map(c => COUNTRY_NAMES[c] || c.toUpperCase()).join(', ');
    const interestStr  = interestsArr.length ? interestsArr.join(', ') : 'world news';

    const isTopicDive = !!(topic || headline);
    const searchQuery = topic || headline || `top news ${locationStr}`;

    let articles = [];
    try {
      const fetches = [
        ...countriesArr.map(c =>
          fetch(`${VERCEL_URL}/api/content?action=search&q=${encodeURIComponent(searchQuery)}&country=${c}&max=8`)
            .then(r => r.json()).then(d => d.articles || []).catch(() => [])
        ),
      ];
      if (GNEWS_KEY) {
        fetches.push(
          fetch(`https://gnews.io/api/v4/search?q=${encodeURIComponent(searchQuery)}&lang=en&max=10&apikey=${GNEWS_KEY}`)
            .then(r => r.json())
            .then(d => (d.articles || []).map(a => ({
              headline: a.title, summary: a.description,
              source: a.source?.name, sourceUrl: a.url,
              publishedAt: a.publishedAt, time: a.publishedAt,
            }))).catch(() => [])
        );
      }
      const all = (await Promise.all(fetches)).flat();
      const seen = new Set();
      articles = all.filter(a => {
        const k = (a.headline || '').slice(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
      }).slice(0, 12);
    } catch (e) {}

    const articlesList = articles.length > 0
      ? articles.map((a, i) => `${i+1}. ${a.headline} (${a.source || 'Unknown'})`).join('\n')
      : 'No specific articles found — use your general knowledge.';

    const system = isTopicDive
      ? `You are an intelligence analyst writing a deep-dive report on a specific story for someone following ${locationStr} interested in ${interestStr}.`
      : `You are a morning intelligence briefing editor for someone following ${locationStr} interested in ${interestStr}.`;

    const prompt = isTopicDive
      ? `Write a deep-dive intelligence report on this story: "${headline || topic}"
${source ? `Source: ${source}` : ''}

Related articles found:
${articlesList}

Structure your report as JSON:
{
  "title": "clean topic title (5 words max)",
  "briefLine": "one sentence: what is happening right now (under 25 words)",
  "background": "2-3 sentences: how did we get here? key context",
  "whatHappened": "2-3 sentences: the specific recent development",
  "whyItMatters": "2-3 sentences: why this matters to someone in ${locationStr} interested in ${interestStr}",
  "watchFor": "2-3 sentences: what to watch in the next 48-72 hours",
  "perspectives": [
    {"side": "label", "view": "one sentence view"},
    {"side": "label", "view": "one sentence view"}
  ],
  "sourceCount": ${articles.length},
  "generatedAt": "${new Date().toISOString()}"
}`
      : `Write a morning intelligence briefing for someone following ${locationStr} interested in ${interestStr}.

Articles available:
${articlesList}

Structure as JSON:
{
  "title": "Morning Intelligence Brief",
  "briefLine": "one editorial sentence capturing the overall mood of today's news (under 25 words)",
  "stories": [
    {
      "headline": "clean headline",
      "whyItMatters": "exactly 50-60 words — specific fact, why it matters to this user, what to watch",
      "source": "source name",
      "tier": 1
    }
  ],
  "countryLabels": "${locationStr}",
  "generatedAt": "${new Date().toISOString()}"
}
Include 5 stories. tier 1 = lead, tier 2 = also today, tier 3 = worth knowing.`;

    try {
      const raw    = await callClaude(ANTHROPIC_KEY, system, prompt, 1000);
      const parsed = parseJSON(raw);
      if (!parsed) {
        await logError(supabase, { endpoint: 'ai', action: 'digest', error: 'Invalid JSON from Claude', context: { headline: headline?.slice(0, 50) }, sessionId });
        return res.status(500).json({ error: 'Report generation failed — invalid JSON.' });
      }

      return res.status(200).json({
        success: true,
        isTopicDive,
        ...parsed,
      });
    } catch (e) {
      await logError(supabase, { endpoint: 'ai', action: 'digest', error: e, sessionId });
      return res.status(500).json({ error: 'Report generation failed: ' + e.message });
    }
  }

  return res.status(400).json({ error: `Unknown action: ${action}. Use: oneliner | briefing | rank | aisearch` });
};
