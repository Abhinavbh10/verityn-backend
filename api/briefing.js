// api/briefing.js — Standalone briefing endpoint
//
// CHANGES (2026-04-28, third pass):
// - Added HARD RULE #3: RELEVANCE FLOOR. Every picked story must have a
//   specific, concrete impact angle for someone living in {location}. No
//   filler picks. No "this is interesting but doesn't affect you" stories.
//   The pool has 25+ articles after capping; 7 with real angles is always
//   findable.
// - Removed the previous "fill remaining slots with strongest impact"
//   wording that left a back door for weak picks.
//
// Earlier changes still in effect:
// - HARD SOURCE CAP (max 2 per source) and NO DUPLICATES
// - [DE-LOCAL] vs [DE] vs [GB] tag glossary
// - LOCAL NEWS RULE: 3 minimum, 4 ideal of 7
// - Pool size 35
// - Source-count audit in response payload

const { createClient } = require('@supabase/supabase-js');

var COUNTRY_NAMES = {
    de:'Germany',in:'India',us:'United States',gb:'United Kingdom',
    au:'Australia',sg:'Singapore',ae:'UAE',jp:'Japan'
};

function parseJSON(raw) {
    try { return JSON.parse(raw); } catch(e) {}
    try { return JSON.parse(raw.replace(/```json\s*/gi,'').replace(/```\s*/gi,'').trim()); } catch(e) {}
    try { var m = raw.match(/[\[{][\s\S]*[\]}]/); if(m) return JSON.parse(m[0]); } catch(e) {}
    return null;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function normaliseSource(s) {
    if (!s) return 'unknown';
    return s.toLowerCase()
        .replace(/^(www\.|feeds\.|rss\.|news\.)/, '')
        .replace(/\.(com|org|net|co\.uk|co|io|de|fr|eu|uk|in|at|ch|jp|au|sg|ae|es|it|nl)$/, '')
        .replace(/[-_\s]+/g, '')
        .trim();
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        var key = process.env.ANTHROPIC_API_KEY;
        if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

        var body = req.body || {};
        var articles = body.articles || [];
        var countries = body.countries || ['de'];
        var location = body.location || 'de';
        var profession = body.profession || null;
        var interests = body.interests || [];

        if (!Array.isArray(articles)) articles = [];
        if (!Array.isArray(countries)) countries = [countries];

        var POOL_SIZE = 35;
        var pool = articles.slice(0, POOL_SIZE).map(function(a, i) {
            return {
                headline: (a.headline || '').slice(0, 200),
                source: (a.source || '').slice(0, 50),
                summary: (a.summary || '').slice(0, 150),
                sourceUrl: (a.sourceUrl || '').slice(0, 300),
                image: a.image ? String(a.image).slice(0, 300) : null,
                topic: a.topic || 'world',
                country: a.country || 'DE',
                isLocal: !!a.isLocal,
                id: a.id || ('a-' + i),
                time: a.time || '',
            };
        });

        if (pool.length === 0) return res.status(400).json({ error: 'No articles provided.' });

        var pickCount = Math.min(7, pool.length);
        if (pickCount < 3) return res.status(400).json({ error: 'Need at least 3 articles, got ' + pool.length });

        var locationStr = COUNTRY_NAMES[location] || location || 'Germany';
        var professionStr = profession || '';
        var interestStr = (interests.length ? interests.join(', ') : 'world news');

        var localMinimum = pickCount >= 7 ? 3 : pickCount >= 5 ? 2 : 1;
        var localIdeal = pickCount >= 7 ? 4 : pickCount >= 5 ? 3 : 1;

        var guaranteedLocalCount = pool.filter(function(a) { return a.isLocal; }).length;

        var headlinesList = pool.map(function(a, i) {
            var summary = a.summary ? ' — ' + a.summary.slice(0, 50) : '';
            var locTag = a.isLocal ? (a.country || 'XX') + '-LOCAL' : (a.country || '??');
            return (i+1) + '. [' + locTag + '] ' + a.headline + summary + ' | ' + a.source + (a.image ? ' | HAS_IMAGE' : '');
        }).join('\n');

        var foreignTag = (countries[0] || 'gb').toUpperCase();
        var localTag = (countries[1] || 'de').toUpperCase();
        var foreignName = COUNTRY_NAMES[(countries[0] || 'gb').toLowerCase()] || 'foreign';

        var prompt = 'Pick exactly ' + pickCount + ' stories for a '
            + (professionStr || 'professional') + ' in ' + locationStr
            + ', interested in ' + interestStr + '.\n\n'

            + 'HARD RULES (non-negotiable):\n\n'

            + '1. SOURCE CAP. Maximum 2 stories from any one source. If your picks include 3 stories from FAZ (or Tagesspiegel, NYT, anyone), DROP the weakest and replace with a different source. Cap is not optional. If cap conflicts with the local quota, the cap wins.\n\n'

            + '2. NO DUPLICATES. If two articles describe the SAME news event (same actors, same announcement, same incident), pick only ONE. Example: a Tagesspiegel piece "UAE leaves OPEC oil cartel" and an NYT piece "United Arab Emirates Says It Will Leave OPEC" are the same story. Pick the local-language source if available. Two articles that share a topic but describe different events are fine.\n\n'

            + '3. RELEVANCE FLOOR. Every picked story must have a specific, concrete impact angle for someone living in ' + locationStr + (professionStr ? ' working in ' + professionStr : '') + '. The angle can be: rent, taxes, savings, salary, commute, energy bills, grocery prices, jobs, the local job market, supply chains, banking exposure, currency, mortgages, kids, school, weekend plans, neighborhood, or a clear connection to one of the reader\'s stated interests (' + interestStr + ').\n'
            + '   Before picking a story, ask: "Can I name a concrete way this affects this reader?" If the honest answer is no, DO NOT PICK IT. The pool has alternatives. There are no "filler" slots. There are no stories worth picking that you have to apologise for.\n'
            + '   The angle does NOT have to be Berlin-specific. A Fed rate decision affects German Euribor mortgages. A Japan story affects German exports. A Russia story affects gas prices or migration. But the angle must be REAL. If you find yourself reaching, that is the signal to drop the story.\n\n'

            + 'LOCAL NEWS RULE: At least ' + localMinimum + ' of the ' + pickCount + ' stories must be ABOUT '
            + locationStr + '. Ideally ' + localIdeal + ' of ' + pickCount + '. '
            + 'A story is local if the HEADLINE mentions ' + locationStr
            + ', or cities, institutions, or named figures in that country (Germany examples: Berlin, Munich, Hamburg, Frankfurt, Bundestag, Bundesregierung, BVG, Lufthansa, Deutsche Bank, Bayer, Siemens, Volkswagen, BMW, Merz, Scholz, DAX, ECB; India: Mumbai, Delhi, Bangalore, RBI, Sensex, Modi; US: Congress, Fed, Wall Street, NYSE).\n\n'

            + 'TAG GLOSSARY:\n'
            + '  [' + localTag + '-LOCAL] — translated from local-language press (Tagesschau, FAZ, Süddeutsche, Spiegel-DE, Tagesspiegel, Handelsblatt, Berliner Zeitung). Guaranteed about ' + locationStr + '. Strongly prefer these for the local quota. ' + guaranteedLocalCount + ' available in this pool.\n'
            + '  [' + localTag + '] — published by a ' + locationStr + '-based outlet writing in English (DW, Politico EU, Spiegel International, The Local). Counts as local ONLY if the headline mentions ' + locationStr + ' or its cities/institutions.\n'
            + '  [' + foreignTag + '] — published by a ' + foreignName + ' outlet (BBC, Guardian, NYT). Counts as local only if the headline is genuinely about ' + locationStr + '.\n\n'

            + 'For each story write a "why" — exactly 2 sentences, 25 to 35 words total.\n'
            + 'Sentence 1: the specific impact on YOU living in ' + locationStr
            + (professionStr ? ' working in ' + professionStr : '')
            + '. Use "your" not "this affects." Never restate the headline. Be specific about your rent, your commute, your taxes, your grocery bill, your salary.\n'
            + 'Sentence 2: what YOU should watch or do next. Concrete action or timeframe.\n\n'

            + 'WHY-LINE TONE: Sharp friend explaining news over coffee. Not a textbook. Not a press release.\n'
            + 'WRONG: "Your understanding of democratic developments benefits from monitoring local governance"\n'
            + 'WRONG: "This is mostly a political ethics story but worth knowing"\n'
            + 'RIGHT: "That rate hold hits your mortgage in about 6 weeks. Lock in a fixed rate before July."\n'
            + 'RIGHT: "Lufthansa fuel surcharges go up next month. If you fly for work, book Q3 trips now while fares are locked."\n\n'

            + 'PREFER articles marked HAS_IMAGE for the lead and medium slots. But do NOT skip a [' + localTag + '-LOCAL] story because it lacks an image. Local relevance beats image availability.\n'
            + 'Cover at least 3 different topics across the picks.\n\n'

            + 'Respond ONLY with valid JSON, no markdown:\n'
            + '{"mood":"one sentence","stories":[{"index":1,"why":"2-sentence why-line"}]}\n\n'
            + 'Articles:\n' + headlinesList;

        var r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1400,
                system: 'You are a news editor creating a personalised briefing. Plain, direct English. No predictions. No financial advice. Every story you pick must matter to this specific reader. Respond with JSON only.',
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        var data = await r.json();

        if (data.error) {
            return res.status(500).json({ error: 'Claude: ' + (data.error.message || JSON.stringify(data.error)) });
        }

        var rawText = (data.content && data.content[0] && data.content[0].text) || '';
        var stopReason = data.stop_reason || 'unknown';

        if (stopReason === 'max_tokens') {
            return res.status(500).json({ error: 'Response truncated', stop_reason: stopReason, raw: rawText.slice(-200) });
        }

        var parsed = parseJSON(rawText);

        if (!parsed || !parsed.stories || parsed.stories.length === 0) {
            return res.status(500).json({ error: 'Parse failed', stop_reason: stopReason, storiesFound: parsed ? (parsed.stories ? parsed.stories.length : 0) : 0, raw: rawText.slice(0, 500) });
        }

        var briefingStories = parsed.stories
            .filter(function(s) { return s.index >= 1 && s.index <= pool.length && s.why; })
            .map(function(s) {
                var a = pool[s.index - 1];
                return {
                    id: a.id, headline: a.headline, summary: a.summary,
                    source: a.source, sourceUrl: a.sourceUrl, image: a.image,
                    topic: a.topic, country: a.country, isLocal: a.isLocal,
                    why: s.why, time: a.time,
                };
            })
            .filter(function(s) { return s && s.headline; });

        if (briefingStories.length === 0) {
            return res.status(500).json({ error: 'No stories mapped', indices: parsed.stories.map(function(s){return s.index;}), poolSize: pool.length });
        }

        var sourceCounts = {};
        for (var bi = 0; bi < briefingStories.length; bi++) {
            var src = normaliseSource(briefingStories[bi].source);
            sourceCounts[src] = (sourceCounts[src] || 0) + 1;
        }
        var capViolations = Object.keys(sourceCounts).filter(function(k) { return sourceCounts[k] > 2; });
        if (capViolations.length > 0) {
            console.log('[briefing] SOURCE CAP VIOLATION: ' + JSON.stringify(sourceCounts));
        }

        try {
            var supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
            await supabase.from('newsletter_cache').insert({ stories: briefingStories, mood: parsed.mood });
        } catch(e) {}

        return res.status(200).json({
            success: true,
            fromCache: false,
            mood: parsed.mood,
            stories: briefingStories,
            poolSize: pool.length,
            guaranteedLocalInPool: guaranteedLocalCount,
            localPicked: briefingStories.filter(function(s) { return s.isLocal; }).length,
            sourceCounts: sourceCounts,
            capViolations: capViolations,
        });

    } catch(e) {
        return res.status(500).json({
            error: 'Briefing error: ' + (e.message || String(e)),
            stack: (e.stack || '').split('\n').slice(0,3),
        });
    }
};
