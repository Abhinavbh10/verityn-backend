// api/briefing.js — Standalone briefing endpoint
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

        // Truncate and clean
        var pool = articles.slice(0, 50).map(function(a, i) {
            return {
                headline: (a.headline || '').slice(0, 200),
                source: (a.source || '').slice(0, 50),
                summary: (a.summary || '').slice(0, 150),
                sourceUrl: (a.sourceUrl || '').slice(0, 300),
                image: a.image ? String(a.image).slice(0, 300) : null,
                topic: a.topic || 'world',
                country: a.country || 'DE',
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

        var headlinesList = pool.map(function(a, i) {
            var summary = a.summary ? ' — ' + a.summary.slice(0, 80) : '';
            return (i+1) + '. [' + (a.country || '??') + '] ' + a.headline + summary + ' | ' + a.source + (a.image ? ' | HAS_IMAGE' : '');
        }).join('\n');

        var prompt = 'Pick exactly ' + pickCount + ' stories for a '
            + (professionStr || 'professional') + ' in ' + locationStr
            + ', interested in ' + interestStr + '.\n\n'
            + 'LOCAL NEWS RULE: At least 2 stories must be ABOUT ' + locationStr
            + ' or directly affect people living there. A story is local if the HEADLINE mentions '
            + locationStr + ', or cities/institutions in that country (e.g. Berlin, Bundestag, BVG, Lufthansa, Deutsche Bank for Germany; Mumbai, RBI, Sensex for India; Congress, Fed, Wall Street for US). '
            + 'WARNING: Articles tagged [' + location.toUpperCase() + '] are from publishers based in that country but may NOT be about that country. A [DE] article about Mexican cartels is NOT a German story. Read the headline, not just the tag.\n\n'
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
            + 'PREFER articles marked HAS_IMAGE.\n'
            + 'Cover different topics. Max 2 stories from the same source.\n'
            + 'If fewer than 2 truly local stories exist, pick stories that have the strongest real impact on someone in ' + locationStr + '.\n\n'
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
                max_tokens: 1200,
                system: 'You are a news editor creating a personalised briefing. Use plain, direct English. No predictions. No financial advice. Respond with JSON only.',
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        var data = await r.json();

        if (data.error) {
            return res.status(500).json({ error: 'Claude: ' + (data.error.message || JSON.stringify(data.error)) });
        }

        var rawText = (data.content && data.content[0] && data.content[0].text) || '';
        var parsed = parseJSON(rawText);

        if (!parsed || !parsed.stories || parsed.stories.length === 0) {
            return res.status(500).json({ error: 'Parse failed', storiesFound: parsed ? (parsed.stories ? parsed.stories.length : 0) : 0, raw: rawText.slice(0, 300) });
        }

        // Map why-lines back to articles
        var briefingStories = parsed.stories
            .filter(function(s) { return s.index >= 1 && s.index <= pool.length && s.why; })
            .map(function(s) {
                var a = pool[s.index - 1];
                return {
                    id: a.id, headline: a.headline, summary: a.summary,
                    source: a.source, sourceUrl: a.sourceUrl, image: a.image,
                    topic: a.topic, country: a.country, why: s.why, time: a.time,
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
        });

    } catch(e) {
        return res.status(500).json({
            error: 'Briefing error: ' + (e.message || String(e)),
            stack: (e.stack || '').split('\n').slice(0,3),
        });
    }
};
