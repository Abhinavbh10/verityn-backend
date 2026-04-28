// api/briefing.js — Standalone briefing endpoint
//
// CHANGES (2026-04-28):
// 1. Translated local-language articles (newsletter.js sets isLocal: true)
//    are now tagged [DE-LOCAL] in the headline list shown to Claude. This
//    distinguishes guaranteed-local Tagesschau/FAZ/SZ stories from
//    [DE]-tagged stories that are merely from German publishers writing
//    about world topics (DW, Politico EU, Spiegel International).
// 2. LOCAL NEWS RULE raised from "at least 2 of 7" to "at least 3, ideally 4
//    of 7". Aligned with product spec.
// 3. Pool size raised 30 → 35 to reduce slice-loss when both English and
//    translated local articles are abundant. (Front-loading in newsletter.js
//    is the real fix; this is belt-and-braces.)

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

        // Truncate and clean. Pool size 35 (was 30) — gives a small buffer for
        // when both English and translated local articles are abundant.
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

        // Pick count: 7 if we have enough, otherwise use what we have (min 3)
        var pickCount = Math.min(7, pool.length);
        if (pickCount < 3) return res.status(400).json({ error: 'Need at least 3 articles, got ' + pool.length });

        var locationStr = COUNTRY_NAMES[location] || location || 'Germany';
        var professionStr = profession || '';
        var interestStr = (interests.length ? interests.join(', ') : 'world news');

        // How many local stories to require. For 7-story briefings: 3 minimum,
        // 4 ideal. For shorter briefings, scale down proportionally.
        var localMinimum = pickCount >= 7 ? 3 : pickCount >= 5 ? 2 : 1;
        var localIdeal = pickCount >= 7 ? 4 : pickCount >= 5 ? 3 : 1;

        // How many guaranteed-local (translated isLocal=true) articles are in the pool
        var guaranteedLocalCount = pool.filter(function(a) { return a.isLocal; }).length;

        var headlinesList = pool.map(function(a, i) {
            var summary = a.summary ? ' — ' + a.summary.slice(0, 50) : '';
            // Tag truly local (translated) articles distinctly from
            // [country] — German publishers writing about anything.
            var locTag = a.isLocal ? (a.country || 'XX') + '-LOCAL' : (a.country || '??');
            return (i+1) + '. [' + locTag + '] ' + a.headline + summary + ' | ' + a.source + (a.image ? ' | HAS_IMAGE' : '');
        }).join('\n');

        var prompt = 'Pick exactly ' + pickCount + ' stories for a '
            + (professionStr || 'professional') + ' in ' + locationStr
            + ', interested in ' + interestStr + '.\n\n'
            + 'LOCAL NEWS RULE: At least ' + localMinimum + ' of the ' + pickCount + ' stories MUST be ABOUT '
            + locationStr + '. Ideally ' + localIdeal + ' of ' + pickCount + '. '
            + 'A story is local if the HEADLINE mentions ' + locationStr
            + ', or cities/institutions/people in that country (e.g. for Germany: Berlin, Munich, Hamburg, Frankfurt, Bundestag, Bundesregierung, BVG, Lufthansa, Deutsche Bank, Bayer, Siemens, Volkswagen, BMW, Merz, Scholz, DAX, ECB; for India: Mumbai, Delhi, Bangalore, RBI, Sensex, Modi; for US: Congress, Fed, Wall Street, NYSE).\n\n'
            + 'TAG GLOSSARY:\n'
            + '  [' + (countries[1] || 'DE').toUpperCase() + '-LOCAL] — translated from local-language press (e.g. Tagesschau, FAZ, Süddeutsche). Guaranteed about ' + locationStr + '. Strongly prefer these for the local quota. ' + guaranteedLocalCount + ' available in this pool.\n'
            + '  [' + (countries[1] || 'DE').toUpperCase() + '] — published by a ' + locationStr + '-based outlet (DW, Politico EU, Spiegel International). May or may not be about ' + locationStr + '. Read the headline. Counts as local ONLY if the headline mentions ' + locationStr + ' or its cities/institutions.\n'
            + '  [' + (countries[0] || 'GB').toUpperCase() + '] — published by a ' + (COUNTRY_NAMES[(countries[0] || 'gb').toLowerCase()] || 'foreign') + ' outlet. Counts as local only if the headline is genuinely about ' + locationStr + '.\n\n'
            + 'For each story write a "why" — EXACTLY 2 sentences, 25-35 words total:\n'
            + 'Sentence 1: The specific impact on YOU living in ' + locationStr
            + (professionStr ? ' working in ' + professionStr : '')
            + '. Use "your" not "this affects." NEVER restate the headline. Be specific about YOUR rent, YOUR commute, YOUR taxes, YOUR grocery bill, YOUR salary.\n'
            + 'Sentence 2: What YOU should watch or do next. Give a concrete action or timeframe.\n\n'
            + 'WHY-LINE TONE: Write like a sharp friend explaining news over coffee. Not a textbook. Not a press release.\n'
            + 'WRONG: "Your understanding of democratic developments benefits from monitoring local governance"\n'
            + 'WRONG: "Your business travel budget takes a hit as airline costs rise, potentially affecting your company\'s mobility policies"\n'
            + 'RIGHT: "That rate hold hits your mortgage in about 6 weeks. Lock in fixed before July."\n'
            + 'RIGHT: "Fuel surcharges on Lufthansa go up next month. If you fly for work, book Q3 trips now while fares are locked."\n\n'
            + 'PREFER articles marked HAS_IMAGE for the lead and medium slots, but DO NOT skip a [' + (countries[1] || 'DE').toUpperCase() + '-LOCAL] story just because it lacks an image — local relevance beats image availability.\n'
            + 'Cover different topics. Max 2 stories from the same source.\n'
            + 'If fewer than ' + localMinimum + ' truly local stories exist in the entire pool (count the [' + (countries[1] || 'DE').toUpperCase() + '-LOCAL] entries plus any [' + (countries[1] || 'DE').toUpperCase() + ']/[' + (countries[0] || 'GB').toUpperCase() + '] stories whose headlines mention ' + locationStr + '), pick whatever truly local stories DO exist, then fill remaining slots with stories that have the strongest real impact on someone in ' + locationStr + '.\n\n'
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
                system: 'You are a news editor creating a personalised briefing. Use plain, direct English. No predictions. No financial advice. Respond with JSON only.',
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        var data = await r.json();

        if (data.error) {
            return res.status(500).json({ error: 'Claude: ' + (data.error.message || JSON.stringify(data.error)) });
        }

        var rawText = (data.content && data.content[0] && data.content[0].text) || '';
        var stopReason = data.stop_reason || 'unknown';

        // If response was cut off, increase tokens next time
        if (stopReason === 'max_tokens') {
            return res.status(500).json({ error: 'Response truncated — Claude ran out of tokens', stop_reason: stopReason, raw: rawText.slice(-200) });
        }

        var parsed = parseJSON(rawText);

        if (!parsed || !parsed.stories || parsed.stories.length === 0) {
            return res.status(500).json({ error: 'Parse failed', stop_reason: stopReason, storiesFound: parsed ? (parsed.stories ? parsed.stories.length : 0) : 0, raw: rawText.slice(0, 500) });
        }

        // Map why-lines back to articles. Preserve isLocal so newsletter.js can
        // log how many guaranteed-local stories ended up in the briefing.
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

        // Cache for newsletter
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
        });

    } catch(e) {
        return res.status(500).json({
            error: 'Briefing error: ' + (e.message || String(e)),
            stack: (e.stack || '').split('\n').slice(0,3),
        });
    }
};
