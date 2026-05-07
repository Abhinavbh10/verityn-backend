// ============================================================
// FILE: api/ai.js
// ACTIONS: digest | oneliner | briefing | rank | aisearch
// ============================================================
// Germany-only since v1.0.2. All country abstractions removed.
// Audience hardcoded to "English speaker living in Germany".
// Why-line voice: 70% practical service journalism + 30% intelligent context.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, logError } = require('./_helpers');

// Audience constant — used in every prompt. Avoids ambiguity.
const AUDIENCE = "English speaker living in Germany";
const LOCATION_LABEL = "Germany";

function inferTopic(headline, description) {
  const text = ((headline || '') + ' ' + (description || '')).toLowerCase();
  // Germany-life topic taxonomy. Mirrors the frontend TOPICS in theme.js.
  if (/\bvisa\b|\baufenthalt|\bblue card\b|\bniederlassung|\beinbürger|\bnaturali|\basyl|\bmigration|\bauslander|\bausländer/.test(text))
    return { topic: 'visa', label: 'Visa & Bureaucracy' };
  if (/\bmiete\b|\bhousing\b|\bmietpreisbremse\b|\brent\b|\bnebenkosten\b|\bgaspreis\b|\bstrom\b|\bgroceries|\bsupermarkt/.test(text))
    return { topic: 'housing', label: 'Housing & Cost' };
  if (/\bbvg\b|\bs-?bahn\b|\bdeutsche bahn\b|\blufthansa\b|\bryanair\b|\bflixbus\b|\bautobahn\b|\bstreik\b|\bstrike\b|\bverdi\b|\bgdl\b|\bführerschein\b|\bdriver|\bdeutschlandticket\b/.test(text))
    return { topic: 'transport', label: 'Transport' };
  if (/\bkrankenkasse\b|\bkrankenversich|\bgesundheit\b|\bhealth\b|\barzt\b|\bdoctor\b|\bkrankenhaus\b|\bhospital\b|\bapotheke\b|\bpharmacy\b|\blauterbach\b/.test(text))
    return { topic: 'health', label: 'Healthcare' };
  if (/\bmindestlohn\b|\bbürgergeld\b|\barbeitslos\b|\bunemploy|\bkurzarbeit\b|\btarif|\bdax\b|\bbundesbank\b|\binflation\b|\brezession\b|\brecession\b|\brente\b|\bpension\b|\bvolkswagen\b|\bbmw\b|\bmercedes\b|\bsiemens\b|\bsap\b/.test(text))
    return { topic: 'work', label: 'Work & Economy' };
  if (/\bheizungsgesetz\b|\bwärmepumpe\b|\bheat pump\b|\benergiewende\b|\brenewable\b|\bsolar\b|\bwind\b|\bkohle\b|\bcoal\b|\batom\b|\bnuclear\b|\bklima\b|\bclimate\b|\bemission\b/.test(text))
    return { topic: 'climate', label: 'Climate & Energy' };
  if (/\bbundesliga\b|\bbayern\b|\bdortmund\b|\boktoberfest\b|\bkarneval\b|\bweihnachts|\bchristmas\b|\bkita\b|\bschule\b|\bschool\b|\buniversi/.test(text))
    return { topic: 'life', label: 'Daily Life' };
  // Default — Germany national news, EU context, world events with German angle
  return { topic: 'germany', label: 'Germany' };
}

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

// Why-line server-side word cap. Claude sometimes ignores the 25-35 word
// constraint or self-truncates with "..." — this normalises after parse.
function trimWhy(text, maxWords = 38) {
  if (!text) return text;
  let t = String(text).trim();
  t = t.replace(/[\s,;:]*(?:\.{2,}|…)\s*$/g, '');
  if (!t) return t;
  const words = t.split(/\s+/);
  if (words.length <= maxWords) {
    if (!/[.!?]$/.test(t)) t += '.';
    return t;
  }
  const truncated = words.slice(0, maxWords).join(' ');
  const lastTerminal = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('?'),
    truncated.lastIndexOf('!')
  );
  if (lastTerminal > truncated.length * 0.55) {
    return truncated.slice(0, lastTerminal + 1).trim();
  }
  return truncated.replace(/[,;:]\s*$/, '').replace(/\s+$/, '') + '.';
}

// ── aisearch helpers ─────────────────────────────────────────
const SEARCH_STOPWORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should',
  'what','when','where','who','why','how','which',
  'and','or','but','if','then','with','about','on','in','at','to','for','of','from',
  'happening','going','tell','me','show','find','latest','news',
  'i','you','we','they','it','this','that','these','those',
  'german','germany','de',  // strip — every query is implicitly Germany
]);

function simplifyQuery(query) {
  const cleaned = (query || '')
    .toLowerCase()
    .replace(/[?!.,;:'"()[\]{}]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const meaningful = cleaned.filter(w => w.length > 2 && !SEARCH_STOPWORDS.has(w));
  return meaningful.join(' ').trim();
}

function buildFallbackQueries(rawQuery) {
  const simplified = simplifyQuery(rawQuery);
  const words = simplified.split(/\s+/).filter(Boolean);
  const queries = [];
  if (rawQuery && rawQuery.trim().split(/\s+/).length <= 4) {
    queries.push(rawQuery.trim());
  }
  if (simplified && !queries.includes(simplified)) queries.push(simplified);
  if (words.length > 3) queries.push(words.slice(0, 3).join(' '));
  if (words.length > 2) queries.push(words.slice(0, 2).join(' '));
  if (words.length > 1) {
    const longest = [...words].sort((a, b) => b.length - a.length)[0];
    if (longest) queries.push(longest);
  }
  return [...new Set(queries)].filter(Boolean);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {

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
    const { articles = [], interests = [], ts } = params;
    const skipCache = !!ts;
    const top4 = (Array.isArray(articles) ? articles : []).slice(0, 4);
    if (!top4.length) return res.status(400).json({ error: 'No articles.' });

    const interestsArr = Array.isArray(interests) ? interests : (interests ? interests.split(',') : []);

    function hashStr(s) {
      let h = 0;
      for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h = h & h; }
      return Math.abs(h).toString(36);
    }
    const headlineHash = hashStr(top4.map(a => a.headline).join('|'));
    const cacheKey = `oneliner-de-${headlineHash}`.slice(0, 100);

    if (!skipCache) {
      try {
        const { data: cached } = await supabase.from('digest_cache').select('digest')
          .eq('cache_key', cacheKey).gt('expires_at', new Date().toISOString()).single();
        if (cached?.digest && !Array.isArray(cached.digest) && Object.keys(cached.digest).length > 0) {
          return res.status(200).json({ success: true, fromCache: true, onelinerMap: cached.digest });
        }
      } catch (e) {}
    }

    const interestLabel = interestsArr.length ? interestsArr.join(', ') : 'daily life in Germany';
    const headlinesList = top4.map((a, i) => `${i + 1}. ${a.headline} (${a.source || 'Unknown'})`).join('\n');

    const systemPrompt = `You write sharp news briefs for an ${AUDIENCE}, interested in ${interestLabel}.

For each headline write EXACTLY 50-60 words across 3 sentences:
Sentence 1: The specific fact — what happened, with a number, name, or concrete detail.
Sentence 2: Why it matters for daily life in Germany or for ${interestLabel}.
Sentence 3: One forward-looking signal — what to watch or expect next.

Rules:
- Count words carefully. 50 minimum, 60 maximum. No exceptions.
- Never use vague phrases like "significant", "notable", "worth noting".
- Always use specific names, numbers, places.
- Use German terms naturally where they're standard (Krankenkasse, S-Bahn, Bürgergeld) — don't translate them.

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
            cache_key: cacheKey,
            digest: map,
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

    const { articles = [], interests = [], profession, ts } = params;
    const skipCache = !!ts;
    const pool = (Array.isArray(articles) ? articles : []).slice(0, 40);
    const interestsArr = Array.isArray(interests) ? interests : (interests ? interests.split(',') : []);
    if (pool.length === 0) return res.status(400).json({ error: 'No articles.' });

    const interestStr = interestsArr.length ? interestsArr.join(', ') : 'daily life in Germany';
    const professionStr = profession || null;

    function hashStr(s) {
      let h = 0;
      for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h = h & h; }
      return Math.abs(h).toString(36);
    }
    const cacheKey = `briefing-de-${hashStr(pool.slice(0,20).map(a=>a.headline).join('|'))}-${(interestsArr || []).sort().join('-').slice(0,30)}-${professionStr || 'na'}`.slice(0, 100);

    if (!skipCache) {
      try {
        const { data: cached } = await supabase.from('digest_cache').select('digest')
          .eq('cache_key', cacheKey).gt('expires_at', new Date().toISOString()).single();
        if (cached?.digest?.stories?.length >= 7) {
          return res.status(200).json({ success: true, fromCache: true, ...cached.digest });
        }
      } catch (e) {}
    }

    // Tag relevance to help Claude select stories.
    // RELEVANT = directly Germany. EU = European policy. WORLD = significant
    // beyond Germany. Anything else: CHECK_RELEVANCE — Claude must justify why-line.
    const GERMANY_KEYWORDS = /\bgermany\b|\bgerman\b|\bberlin\b|\bmunich\b|\bm[uü]nchen\b|\bhamburg\b|\bfrankfurt\b|\bcologne\b|\bk[oö]ln\b|\bstuttgart\b|\bbundestag\b|\bbundesrat\b|\bscholz\b|\bmerz\b|\bhabeck\b|\bbaerbock\b|\blindner\b|\bdeutsche\b|\bdax\b|\bbundesbank\b|\beuro\b|\bbürgergeld\b|\bb[uü]rgergeld\b|\bkrankenkasse\b|\bmietpreisbremse\b|\bheizungsgesetz\b|\bbvg\b|\bdeutschebahn\b|\bautobahn\b|\bbundesliga\b/i;
    const EU_KEYWORDS = /\beu\b|\beuropean\b|\beuropäisch\b|\becb\b|\bbrussels\b|\bbr[uü]ssel\b|\bnato\b|\beurope\b/i;
    const GLOBAL_KEYWORDS = /\bwar\b|\bnuclear\b|\bsanctions\b|\bpandemic\b|\bclimate summit\b|\bg7\b|\bg20\b|\bopec\b|\bun general assembly\b/i;

    const headlinesList = pool.map((a, i) => {
      const text = ((a.headline || '') + ' ' + (a.summary || '')).toLowerCase();
      let tag;
      if (GERMANY_KEYWORDS.test(text)) tag = 'GERMANY';
      else if (EU_KEYWORDS.test(text)) tag = 'EU';
      else if (GLOBAL_KEYWORDS.test(text)) tag = 'WORLD';
      else tag = 'CHECK_RELEVANCE';
      return `${i + 1}. [${tag}] ${a.headline} | ${a.source || 'Unknown'} | ${a.image ? 'HAS_IMAGE' : 'NO_IMAGE'}`;
    }).join('\n');

    const system = `You are a news editor briefing an ${AUDIENCE}. \
You write as a knowledgeable friend explaining what happened — not as a journalist writing for publication. \
Plain, direct English. Use German terms where they're standard (Bürgergeld, Krankenkasse, S-Bahn, Mietpreisbremse) without translating. \
Specific facts. No wire-service voice. No definitive predictions. \
When describing impact, use likelihood language: "this typically affects", "watch for", "historically this has meant". \
Never give financial, legal, or medical advice.`;

    const prompt = `Editing a personal news briefing for an ${AUDIENCE}, interested in ${interestStr}${professionStr ? `, working in ${professionStr}` : ''}.

RELEVANCE RULES:
1. At least 5 of the 7 stories MUST directly involve Germany or have clear, immediate impact on daily life in Germany. Tagged [GERMANY] articles are best; [EU] articles work if the EU policy specifically affects Germany; [WORLD] articles only if they directly hit German economy, politics, or life.
2. NEVER include foreign-domestic stories with no German angle (e.g. an Indian state election, a US Supreme Court ruling that doesn't affect Germany, a Japanese product launch).
3. NEVER include celebrity, royal, lifestyle-fluff, or entertainment-feed news. This is intelligence for adults, not a chaos feed.
4. Stories tagged [CHECK_RELEVANCE] are higher-risk — only pick if you can write a strong, specific why-line connecting them to life in Germany.

Select exactly 7 stories. All 7 carry equal weight — no lead, no tiers.
DIVERSITY RULE: 7 stories must cover at least 3 different topic areas (visa/bureaucracy, housing, transport, health, work/economy, climate/energy, politics, daily life). Never 4+ stories on the same topic.
SOURCE DIVERSITY: Never more than 2 stories from the same source. If 5 articles are from Politico Europe, pick at most 2.
STRONGLY PREFER articles marked HAS_IMAGE.

Articles are pre-ranked by semantic relevance — article 1 is most relevant. Trust this but apply the relevance rules.

For each story write a "why" — EXACTLY 2 sentences, 25-35 words total. The voice is 70% PRACTICAL SERVICE, 30% INTELLIGENT CONTEXT:

Sentence 1 (the practical hit — 70% mode): What this concretely changes for an English speaker living in Germany. Use a specific number, deadline, euro amount, or rule change. Use "your" not "this affects." Examples:
- "If you're applying for permanent residence before March, this shortens your wait by an average of 6 weeks."
- "Your Krankenkasse premium is likely to rise €18-25/month under this proposal — most plans adjust in January."
- "BVG night-bus service reduces 22% from Sunday — rethink late routes home."

Sentence 2 (the intelligent angle — 30% mode): Either (a) what to watch / decide / do next, or (b) the historical or political context a non-German might miss. Examples:
- "Watch the BMI announcement on Tuesday — that's when the timeline becomes concrete."
- "Germany has historically resisted EU-wide rules here. This vote breaks 30 years of precedent."
- "The Greens lose this fight every time it reaches the Bundesrat. The amendment dies before passage, usually."

NEVER restate the headline. NEVER give financial, legal, or medical advice. NEVER predict outcomes as certain.

Also write a "mood" sentence (under 20 words) summarising today's news tone for life in Germany.

Respond ONLY with valid JSON — no markdown, no explanation:
{
  "mood": "one sentence summarising today",
  "stories": [
    {"index": 1, "why": "2-sentence why-line"},
    {"index": 3, "why": "2-sentence why-line"},
    {"index": 5, "why": "2-sentence why-line"},
    {"index": 7, "why": "2-sentence why-line"},
    {"index": 9, "why": "2-sentence why-line"},
    {"index": 11, "why": "2-sentence why-line"},
    {"index": 12, "why": "2-sentence why-line"}
  ]
}

Articles:
${headlinesList}`;

    try {
      // 1500 max_tokens — at 800 Claude was self-truncating why-lines mid-word
      // when 7 stories of text plus JSON structure approached the budget.
      const raw = await callClaude(ANTHROPIC_KEY, system, prompt, 1500);
      const parsed = parseJSON(raw);
      if (!parsed?.stories || parsed.stories.length < 7) {
        await logError(supabase, { endpoint: 'ai', action: 'briefing', error: 'Insufficient stories returned', context: { storiesCount: parsed?.stories?.length }, sessionId });
        return res.status(500).json({ error: 'Briefing generation failed — insufficient stories.' });
      }
      const briefingStories = parsed.stories
        .filter(s => s.index >= 1 && s.index <= pool.length && s.why)
        .map(s => ({
          ...pool[s.index - 1],
          // trimWhy enforces 38-word cap, strips trailing "...", ensures clean endings
          why: trimWhy(s.why),
        }))
        .filter(s => s && s.headline);

      // Diversity check
      const topicSet = new Set();
      for (const s of briefingStories) {
        const t = inferTopic(s.headline, s.summary);
        topicSet.add(t.topic);
      }
      if (topicSet.size < 3) {
        console.warn('[DIVERSITY WARNING]', JSON.stringify({
          uniqueTopics: topicSet.size, topics: [...topicSet],
          headlines: briefingStories.map(s => s.headline?.slice(0, 40)),
        }));
        await logError(supabase, {
          endpoint: 'ai', action: 'briefing-diversity',
          error: `Only ${topicSet.size} unique topics in briefing`,
          context: { topics: [...topicSet] }, sessionId,
        });
      }

      // Germany-relevance check
      let germanyCount = 0;
      for (const s of briefingStories) {
        const txt = ((s.headline || '') + ' ' + (s.summary || '') + ' ' + (s.why || '')).toLowerCase();
        if (GERMANY_KEYWORDS.test(txt) || EU_KEYWORDS.test(txt)) germanyCount++;
      }
      if (germanyCount < 5) {
        console.warn('[GERMANY RELEVANCE WARNING]', JSON.stringify({
          germanyCount,
          headlines: briefingStories.map(s => s.headline?.slice(0, 50)),
        }));
        await logError(supabase, {
          endpoint: 'ai', action: 'briefing-relevance',
          error: `Only ${germanyCount}/7 stories Germany/EU-relevant`,
          context: { germanyCount }, sessionId,
        });
      }

      // Why-line monitoring
      const whyMonitor = {
        ts: new Date().toISOString(),
        profession: professionStr || 'none',
        storiesReturned: briefingStories.length,
        storiesMissingWhy: briefingStories.filter(s => !s.why).length,
        whyWordCounts: briefingStories.map(s => ({
          headline: (s.headline || '').slice(0, 50),
          hasImage: !!s.image,
          words: s.why ? s.why.split(/\s+/).length : 0,
        })),
      };
      const outOfRange = whyMonitor.whyWordCounts.filter(w => w.words > 0 && (w.words < 20 || w.words > 45));
      const missingImages = briefingStories.filter(s => !s.image).length;
      if (briefingStories.length < 7 || outOfRange.length > 0 || missingImages > 0) {
        console.warn('[WHY-LINE MONITOR]', JSON.stringify({
          ...whyMonitor,
          issues: {
            insufficientStories: briefingStories.length < 7,
            storiesMissingImages: missingImages,
            outOfWordRange: outOfRange.map(w => `${w.headline}... (${w.words}w)`),
          },
        }));
      }

      const result = { mood: parsed.mood, stories: briefingStories };
      try {
        await supabase.from('digest_cache').upsert({
          cache_key: cacheKey, digest: result,
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
  // Germany-relevance ranking. Articles get scored on:
  //   - semantic similarity to user profile (interests + profession + Germany context)
  //   - recency
  //   - Germany / EU keyword density (bonus)
  //   - foreign-domestic penalty (anything specifically about non-DE/EU country with no German angle)
  if (action === 'rank') {
    const rl = await checkRateLimit(supabase, sessionId, 'rank');
    if (!rl.allowed) return res.status(429).json({ error: 'Rate limit exceeded.', resetAt: rl.resetAt });

    const { articles = [], interests = [], profession } = params;
    const interestsArr = Array.isArray(interests) ? interests : (interests ? interests.split(',') : []);
    const pool = (Array.isArray(articles) ? articles : []).slice(0, 60);
    if (pool.length === 0) return res.status(200).json({ success: true, articles: [] });

    const NOISE_PATTERNS = /taylor swift|kardashian|celebrity|red carpet|oscars|emmys|grammys|iheartradio|nfl draft|nba trade|cricket score|match preview|recipe|horoscope|zodiac|best buy|sale deal|movie review|box office|reality tv|news bulletin|midday update|morning update|evening update|daily digest|weekly roundup|newsletter|podcast episode|royal family|prince harry|meghan/i;
    const filtered = pool.filter(a => {
      if (!a.headline || a.headline.length < 15) return false;
      if (NOISE_PATTERNS.test(a.headline)) return false;
      return true;
    });
    const candidates = filtered.length >= 10 ? filtered : pool.slice(0, 30);

    // Germany-relevance terms — heavy boost
    const GERMANY_TERMS = [
      'germany','german','berlin','munich','münchen','hamburg','frankfurt','cologne','köln',
      'stuttgart','düsseldorf','leipzig','dresden',
      'bundestag','bundesrat','scholz','merz','habeck','baerbock','lindner','steinmeier',
      'cdu','spd','fdp','afd','greens','grüne','linke',
      'dax','bundesbank','deutsche','volkswagen','vw','bmw','mercedes','porsche','siemens','sap','bayer','basf','bosch',
      'bvg','deutschebahn','bahn','autobahn','lufthansa','bundesliga',
      'krankenkasse','bürgergeld','bürgeramt','anmeldung','finanzamt',
      'mietpreisbremse','heizungsgesetz','energiewende','wärmepumpe',
      'visa','aufenthalt','niederlassung','einbürgerung','blue card',
      'mindestlohn','tarif','kurzarbeit','rente',
    ];
    // EU terms — moderate boost
    const EU_TERMS = ['eu','european','europe','ecb','euro','brussels','brüssel','nato','europäisch'];
    // Foreign-domestic — penalty when no German angle
    const FOREIGN_TERMS = [
      'india','indian','delhi','mumbai','bangalore','rbi','sensex','modi',
      'australia','australian','sydney','melbourne','canberra',
      'singapore','singaporean','mas',
      'uae','dubai','abu dhabi',
      'japan','japanese','tokyo','nikkei',
      'china','chinese','beijing','shanghai',
      'us senate','us congress','us president','american','usa',
      'uk','british','britain','london','sunak','labour',
    ];

    const PROFESSION_CONTEXT = {
      tech:     'software engineering AI machine learning startups venture capital tech industry',
      finance:  'investment banking financial markets portfolio management trading economics',
      founder:  'startup founder venture capital business strategy company building',
      medicine: 'healthcare clinical research public health pharmaceutical medical',
      academia: 'research university science publishing data analysis policy',
      student:  'university education student life integration courses',
      other:    'professional career industry work',
    };

    const INTEREST_CONTEXT = {
      germany:   'Germany national politics economy daily life',
      visa:      'visa residency immigration naturalization Aufenthaltstitel Blue Card',
      housing:   'housing rent Mietpreisbremse cost of living utilities',
      transport: 'transport BVG Deutsche Bahn S-Bahn autobahn strikes Lufthansa',
      health:    'healthcare Krankenkasse doctors hospitals pharmaceutical',
      work:      'work economy DAX Bürgergeld minimum wage employment industry',
      climate:   'climate energy Heizungsgesetz Energiewende renewables emissions',
      life:      'culture food festivals Bundesliga education kita schools daily life',
    };

    const profileText = [
      'Germany life as English speaker',
      ...interestsArr.map(i => INTEREST_CONTEXT[i] || i),
      profession ? (PROFESSION_CONTEXT[profession] || profession) : '',
    ].filter(Boolean).join('. ');

    if (!OPENAI_KEY) {
      // Rule-based fallback if no OpenAI key
      const profileTerms = profileText.toLowerCase();
      const scored = candidates.map(a => {
        const text = ((a.headline || '') + ' ' + (a.summary || '')).toLowerCase();
        let score = 0;
        profileTerms.split(' ').forEach(term => { if (term.length > 2 && text.includes(term)) score++; });
        const germanyMatches = GERMANY_TERMS.filter(t => text.includes(t)).length;
        score += Math.min(germanyMatches, 5);
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

      const scored = candidates.map((a, i) => {
        const similarity = cosineSimilarity(profileEmbedding, articleEmbeddings[i]);
        const hoursOld = (Date.now() - new Date(a.publishedAt)) / 3600000;
        const recency = Math.max(0, 1 - hoursOld / 48);
        const articleText = ((a.headline || '') + ' ' + (a.summary || '')).toLowerCase();

        // Germany boost
        const germanyMatches = GERMANY_TERMS.filter(term => articleText.includes(term)).length;
        const germanyBonus = Math.min(0.40, germanyMatches * 0.10);

        // EU boost
        const euMatches = EU_TERMS.filter(term => articleText.includes(term)).length;
        const euBonus = Math.min(0.15, euMatches * 0.05);

        // Foreign-domestic penalty: foreign terms with NO German anchor
        const foreignMatches = FOREIGN_TERMS.filter(term => term.length > 3 && articleText.includes(term)).length;
        const foreignPenalty = (foreignMatches >= 2 && germanyMatches === 0 && euMatches === 0) ? -0.30 : 0;

        // Global significance override — major events still get a pass
        const isGlobalSignificance = /\bwar\b|\bnuclear\b|\bsanctions\b|\bglobal recession\b|\bpandemic\b|\bg7\b|\bg20\b|\bnato\b|\bopec\b/i.test(articleText);
        const globalOverride = (foreignPenalty < 0 && isGlobalSignificance) ? 0.15 : 0;

        const score = (similarity * 0.45) + (recency * 0.15) + germanyBonus + euBonus + foreignPenalty + globalOverride;
        return { ...a, relevanceScore: Math.round(score * 100) / 100 };
      }).sort((a, b) => b.relevanceScore - a.relevanceScore);

      return res.status(200).json({ success: true, articles: scored.slice(0, 12), method: 'embedding' });
    } catch (e) {
      const scored = candidates.map(a => {
        const text = ((a.headline||'')+(a.summary||'')).toLowerCase();
        const germanyMatches = GERMANY_TERMS.filter(t => text.includes(t)).length;
        const score = germanyMatches + interestsArr.filter(i => text.includes(i)).length;
        return { ...a, relevanceScore: score };
      }).sort((a, b) => b.relevanceScore - a.relevanceScore);
      return res.status(200).json({ success: true, articles: scored.slice(0, 12), method: 'fallback', error: e.message });
    }
  }

  // ── ACTION: aisearch ─────────────────────────────────────────
  if (action === 'aisearch') {
    const rl = await checkRateLimit(supabase, sessionId, 'aisearch');
    if (!rl.allowed) return res.status(429).json({ error: 'Rate limit exceeded.', resetAt: rl.resetAt });

    const { query = '' } = params;
    if (!query.trim()) return res.status(400).json({ error: 'query required' });

    // Reusable searcher — Germany-only.
    async function runSearch(q) {
      try {
        const fetches = [
          fetch(`${VERCEL_URL}/api/content?action=search&q=${encodeURIComponent(q)}&country=de&max=8`)
            .then(r => r.json()).then(d => d.articles || []).catch(() => []),
        ];
        if (GNEWS_KEY) {
          // GNews search with Germany country bias
          fetches.push(
            fetch(`https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=en&country=de&max=10&apikey=${GNEWS_KEY}`)
              .then(r => r.json())
              .then(d => (d.articles || []).map(a => ({
                headline: a.title, summary: a.description,
                source: a.source?.name, sourceUrl: a.url, publishedAt: a.publishedAt,
              }))).catch(() => [])
          );
          // Also include EU-wide search since EU policy often matters for German life
          fetches.push(
            fetch(`https://gnews.io/api/v4/search?q=${encodeURIComponent(q + ' Germany')}&lang=en&max=8&apikey=${GNEWS_KEY}`)
              .then(r => r.json())
              .then(d => (d.articles || []).map(a => ({
                headline: a.title, summary: a.description,
                source: a.source?.name, sourceUrl: a.url, publishedAt: a.publishedAt,
              }))).catch(() => [])
          );
        }
        const all = (await Promise.all(fetches)).flat();
        const seen = new Set();
        return all.filter(a => {
          const k = (a.headline || '').slice(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!k || seen.has(k)) return false;
          seen.add(k); return true;
        }).slice(0, 15);
      } catch (e) {
        return [];
      }
    }

    // Cascading fallback: original → simplified → noun phrases → single keyword
    const fallbackQueries = buildFallbackQueries(query);
    let articles = [];
    let usedQuery = null;
    let attempts = [];

    for (const q of fallbackQueries) {
      const found = await runSearch(q);
      attempts.push({ q, count: found.length });
      if (found.length >= 3) {
        articles = found;
        usedQuery = q;
        break;
      }
      if (found.length > articles.length) {
        articles = found;
        usedQuery = q;
      }
    }

    // Last-resort: latest Germany news, framed as soft answer
    let usedLastResort = false;
    if (articles.length === 0) {
      try {
        const fallback = await fetch(`${VERCEL_URL}/api/content?action=news&country=de&max=8`)
          .then(r => r.json()).then(d => d.articles || []).catch(() => []);
        const seen = new Set();
        articles = fallback.filter(a => {
          const k = (a.headline || '').slice(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!k || seen.has(k)) return false;
          seen.add(k); return true;
        }).slice(0, 8);
        usedLastResort = articles.length > 0;
      } catch (e) {}
    }

    if (articles.length === 0) {
      await logError(supabase, {
        endpoint: 'ai', action: 'aisearch',
        error: 'All fallbacks exhausted, no articles found',
        context: { query, attempts },
        sessionId,
      });
      return res.status(200).json({
        success: true,
        synthesis: `No recent stories matched "${query}". Try a shorter query, or check Today for the latest Germany briefing.`,
        confidence: 'low',
        articles: [],
        query,
      });
    }

    const articlesList = articles.map((a, i) =>
      `${i + 1}. ${a.headline} (${a.source || 'Unknown'})`
    ).join('\n');

    const system = `You are a personal news analyst for an ${AUDIENCE}. Synthesise into clear, balanced answers focused on what this means for daily life in Germany. Specific. No fluff.`;

    const prompt = usedLastResort
      ? `User query: "${query}"

We didn't find articles directly matching this query. Below are today's most relevant Germany-life headlines. Acknowledge the gap honestly, then synthesise what IS in the news that may be tangentially relevant. Calm tone, not apologetic.

Articles available:
${articlesList}

Write 60-90 words. End with one line suggesting a sharper query.

Respond ONLY with JSON:
{"synthesis":"your answer here","sourceIndices":[1,3,5],"confidence":"low"}`
      : `User query: "${query}"

Articles found:
${articlesList}

Write a synthesis of 80-120 words that directly answers the query for an ${AUDIENCE}. Draw on multiple sources. Note conflicting perspectives if present. End with one forward-looking sentence — what to watch or do next.

Respond ONLY with JSON:
{"synthesis":"your answer here","sourceIndices":[1,3,5],"confidence":"high|medium|low"}`;

    try {
      const raw = await callClaude(ANTHROPIC_KEY, system, prompt, 400);
      const parsed = parseJSON(raw);
      const sourced = parsed?.sourceIndices
        ? parsed.sourceIndices.map(i => articles[i - 1]).filter(Boolean)
        : articles.slice(0, 5);
      return res.status(200).json({
        success: true, query,
        synthesis: parsed?.synthesis || null,
        confidence: parsed?.confidence || (usedLastResort ? 'low' : 'medium'),
        articles: sourced,
        allArticles: articles,
        usedQuery, usedLastResort, attempts,
      });
    } catch (e) {
      return res.status(200).json({
        success: true, query, synthesis: null,
        articles, error: e.message,
        usedQuery, usedLastResort, attempts,
      });
    }
  }

  // ── ACTION: digest ───────────────────────────────────────────
  if (action === 'digest') {
    const rl = await checkRateLimit(supabase, sessionId, 'digest');
    if (!rl.allowed) return res.status(429).json({ error: 'Rate limit exceeded.', resetAt: rl.resetAt });

    const { interests = [], topic, headline, source } = params;
    const interestsArr = Array.isArray(interests) ? interests : (interests ? interests.split(',') : []);
    const interestStr = interestsArr.length ? interestsArr.join(', ') : 'daily life in Germany';

    const isTopicDive = !!(topic || headline);
    const searchQuery = topic || headline || 'top news Germany';

    let articles = [];
    try {
      const fetches = [
        fetch(`${VERCEL_URL}/api/content?action=search&q=${encodeURIComponent(searchQuery)}&country=de&max=8`)
          .then(r => r.json()).then(d => d.articles || []).catch(() => []),
      ];
      if (GNEWS_KEY) {
        fetches.push(
          fetch(`https://gnews.io/api/v4/search?q=${encodeURIComponent(searchQuery)}&lang=en&country=de&max=10&apikey=${GNEWS_KEY}`)
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
      : 'No specific articles found — use your general knowledge of Germany news.';

    const system = isTopicDive
      ? `You are an analyst writing a deep-dive report for an ${AUDIENCE}, interested in ${interestStr}. Voice: 70% practical (what this means for daily life in Germany), 30% intelligent context (history, politics, what most non-Germans miss).`
      : `You are a morning briefing editor for an ${AUDIENCE}, interested in ${interestStr}. Voice: 70% practical, 30% intelligent context.`;

    const prompt = isTopicDive
      ? `Deep-dive report on this story: "${headline || topic}"
${source ? `Source: ${source}` : ''}

Related articles found:
${articlesList}

Structure as JSON:
{
  "title": "clean topic title (5 words max)",
  "briefLine": "one sentence: what is happening right now (under 25 words)",
  "background": "2-3 sentences: how did we get here? key context for someone who didn't grow up in Germany",
  "whatHappened": "2-3 sentences: the specific recent development",
  "whyItMatters": "2-3 sentences: practical impact for someone living in Germany — euros, deadlines, rule changes, daily life",
  "watchFor": "2-3 sentences: what to watch in the next 48-72 hours",
  "perspectives": [
    {"side": "label", "view": "one sentence view"},
    {"side": "label", "view": "one sentence view"}
  ],
  "sourceCount": ${articles.length},
  "generatedAt": "${new Date().toISOString()}"
}`
      : `Morning briefing for an ${AUDIENCE}, interested in ${interestStr}.

Articles available:
${articlesList}

Structure as JSON:
{
  "title": "Morning Briefing",
  "briefLine": "one editorial sentence capturing today's mood for life in Germany (under 25 words)",
  "stories": [
    {
      "headline": "clean headline",
      "whyItMatters": "exactly 50-60 words — specific fact, daily-life impact in Germany, what to watch",
      "source": "source name",
      "tier": 1
    }
  ],
  "countryLabels": "${LOCATION_LABEL}",
  "generatedAt": "${new Date().toISOString()}"
}
Include 5 stories. tier 1 = lead, tier 2 = also today, tier 3 = worth knowing.`;

    try {
      const raw = await callClaude(ANTHROPIC_KEY, system, prompt, 1000);
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

  return res.status(400).json({ error: `Unknown action: ${action}. Use: oneliner | briefing | rank | aisearch | digest` });

  } catch (topErr) {
    return res.status(500).json({
      error: 'Unhandled error: ' + (topErr.message || String(topErr)),
      action: (typeof action !== 'undefined' ? action : 'unknown'),
      stack: (topErr.stack || '').split('\n').slice(0, 4),
    });
  }
};
