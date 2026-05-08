// ============================================================
// FILE: api/briefing.js — Germany-only briefing endpoint
//
// CHANGES (May 2026, Germany pivot):
// - Drop multi-country/foreign-vs-local logic. We are Germany-only.
// - Drop profession dependency. Personalization axis is now city + interests.
// - Pool can include [CITY-LOCAL] articles (from /api/citynews) which get
//   priority when userCity is set.
// - Custom topics are NOT in scope here. They live in user prefs and will
//   drive push notifications later. The home briefing stays pure: Germany
//   nationwide + your city.
//
// KEPT FROM v2:
// - HARD RULES: source cap (max 2), no duplicates, relevance floor
// - POOL_SIZE 35
// - Why-line: 2 sentences, 25-35 words, sharp friend tone, "your" not
//   "this affects", concrete impact + what to watch/do next
// ============================================================

const { createClient } = require('@supabase/supabase-js');

function parseJSON(raw) {
    try { return JSON.parse(raw); } catch (e) {}
    try { return JSON.parse(raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()); } catch (e) {}
    try { const m = raw.match(/[\[{][\s\S]*[\]}]/); if (m) return JSON.parse(m[0]); } catch (e) {}
    return null;
}

function normaliseSource(s) {
    if (!s) return 'unknown';
    return s.toLowerCase()
        .replace(/^(www\.|feeds\.|rss\.|news\.)/, '')
        .replace(/\.(com|org|net|co\.uk|co|io|de|fr|eu|uk|in|at|ch|jp|au|sg|ae|es|it|nl)$/, '')
        .replace(/[-_\s]+/g, '')
        .trim();
}

const CITY_LABELS = {
    all: 'Germany', berlin: 'Berlin', munich: 'Munich', hamburg: 'Hamburg',
    frankfurt: 'Frankfurt', cologne: 'Cologne', stuttgart: 'Stuttgart',
    duesseldorf: 'Düsseldorf', leipzig: 'Leipzig',
};

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

        const body = req.body || {};
        const articlesIn = Array.isArray(body.articles) ? body.articles : [];
        const interests = Array.isArray(body.interests) ? body.interests : [];
        const userCity = (body.userCity || 'all').toLowerCase();

        const POOL_SIZE = 35;
        const pool = articlesIn.slice(0, POOL_SIZE).map((a, i) => ({
            headline: (a.headline || '').slice(0, 200),
            source: (a.source || '').slice(0, 50),
            summary: (a.summary || '').slice(0, 150),
            sourceUrl: (a.sourceUrl || '').slice(0, 300),
            image: a.image ? String(a.image).slice(0, 300) : null,
            topic: a.topic || 'world',
            country: a.country || 'DE',
            sourceCity: (a.sourceCity || 'nationwide').toLowerCase(),
            isLocal: !!a.isLocal,
            id: a.id || ('a-' + i),
            time: a.time || '',
        }));

        if (pool.length === 0) return res.status(400).json({ error: 'No articles provided.' });

        const pickCount = Math.min(7, pool.length);
        if (pickCount < 3) return res.status(400).json({ error: 'Need at least 3 articles, got ' + pool.length });

        const cityLabel = CITY_LABELS[userCity] || 'Germany';
        const isCityUser = userCity !== 'all' && userCity !== '';
        const audience = isCityUser
            ? `English speaker living in ${cityLabel}, Germany`
            : `English speaker living in Germany`;
        const interestStr = interests.length ? interests.join(', ') : 'daily life in Germany';

        // City quota: if user has a city, push for 2-3 city-LOCAL stories
        const cityLocalInPool = pool.filter(a => a.sourceCity === userCity).length;
        const cityLocalIdeal = isCityUser
            ? Math.min(3, Math.max(1, cityLocalInPool >= 5 ? 3 : cityLocalInPool >= 2 ? 2 : cityLocalInPool))
            : 0;

        // Build the headline list with city-aware tags.
        const headlinesList = pool.map((a, i) => {
            let tag;
            if (a.sourceCity && a.sourceCity !== 'nationwide') tag = `${a.sourceCity.toUpperCase()}-LOCAL`;
            else if (a.isLocal) tag = 'DE-LOCAL';
            else tag = 'NATIONWIDE';
            const summary = a.summary ? ' — ' + a.summary.slice(0, 50) : '';
            return `${i + 1}. [${tag}] ${a.headline}${summary} | ${a.source}${a.image ? ' | HAS_IMAGE' : ''}`;
        }).join('\n');

        const prompt =
            `Pick exactly ${pickCount} stories for an ${audience}, who follows these topics: ${interestStr}.\n\n`

            + `HARD RULES (non-negotiable):\n\n`

            + `1. SOURCE CAP. Maximum 2 stories from any one source. Cap is not optional. If your picks include 3 from one source, drop the weakest and replace with another.\n\n`

            + `2. NO DUPLICATES. If two articles describe the SAME event, pick only ONE. Two articles sharing a topic but covering different events are fine.\n\n`

            + `3. RELEVANCE FLOOR. Every picked story must have a specific, concrete impact angle for life in ${cityLabel}. The angle can be: rent, taxes, salary, commute, energy bills, healthcare, visa, jobs, schools, local news, or a clear connection to one of the user's stated topics. If you can't name a concrete way it affects them, DON'T PICK IT. The pool has alternatives.\n\n`

            + (isCityUser
                ? `4. CITY PREFERENCE. The user lives in ${cityLabel}. Aim for ${cityLocalIdeal} of ${pickCount} stories tagged [${userCity.toUpperCase()}-LOCAL] when they're in the pool and relevant. ${cityLocalInPool} city-local articles are available. Don't force this — quality wins — but a Berlin user should see Berlin-specific stories when they exist.\n\n`
                : `4. NATIONWIDE COVERAGE. The user follows all-Germany news. Spread picks across federal politics, daily life, work, transport, healthcare. No single city should dominate.\n\n`)

            + `TAG GLOSSARY:\n`
            + `  [BERLIN-LOCAL] / [MUNICH-LOCAL] / [HAMBURG-LOCAL] / [FRANKFURT-LOCAL] — from a city-specific source. Strongly preferred for the city quota when user has a city.\n`
            + `  [NATIONWIDE] — Germany-wide coverage from any English-language outlet.\n`
            + `  [DE-LOCAL] — translated from German press (Tagesschau, Tagesspiegel, FAZ, SZ, Spiegel).\n\n`

            + `For each story write a "why" — exactly 2 sentences, 25 to 35 words total.\n`
            + `Sentence 1: the specific impact on YOU living in ${cityLabel}. Use "your" not "this affects." Never restate the headline. Be specific about your rent, commute, taxes, grocery bill, salary.\n`
            + `Sentence 2: what YOU should watch or do next. Concrete action or timeframe.\n\n`

            + `WHY-LINE TONE: Sharp friend explaining news over coffee. Not a textbook. Not a press release.\n`
            + `WRONG: "Your understanding of governance benefits from monitoring local affairs"\n`
            + `WRONG: "This is mostly political ethics but worth knowing"\n`
            + `RIGHT: "Your December Krankenkasse letter likely shows €18-25 more. Switch carriers in Q1 if you don't want it."\n`
            + `RIGHT: "BVG night-bus cuts hit your route from June. Plan alt-transport for late shifts now — taxi prices won't be kind."\n`
            + `RIGHT: "ECB rate hold means your German variable-rate mortgage stays put for ~6 weeks. Lock in fixed before September if you can."\n\n`

            + `PREFER articles marked HAS_IMAGE for the lead and medium slots, but never skip a [${isCityUser ? userCity.toUpperCase() + '-LOCAL' : 'DE-LOCAL'}] story for image reasons. Local relevance > image availability.\n`
            + `Cover at least 3 different topics across the picks.\n\n`

            + `Respond ONLY with valid JSON, no markdown:\n`
            + `{"mood":"one sentence","stories":[{"index":1,"why":"2-sentence why-line"}]}\n\n`
            + `Articles:\n` + headlinesList;

        const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1500,
                system: 'You are a news editor creating a personalised briefing for an English speaker living in Germany. Plain, direct English. Use German terms where standard (Bürgergeld, Krankenkasse, S-Bahn, Mietpreisbremse) without translating. No predictions stated as fact. No financial, legal, or medical advice. Every story you pick must matter to this specific reader. Respond with JSON only.',
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        const data = await r.json();

        if (data.error) {
            return res.status(500).json({ error: 'Claude: ' + (data.error.message || JSON.stringify(data.error)) });
        }

        const rawText = (data.content && data.content[0] && data.content[0].text) || '';
        const stopReason = data.stop_reason || 'unknown';

        if (stopReason === 'max_tokens') {
            return res.status(500).json({ error: 'Response truncated', stop_reason: stopReason, raw: rawText.slice(-200) });
        }

        const parsed = parseJSON(rawText);

        if (!parsed || !parsed.stories || parsed.stories.length === 0) {
            return res.status(500).json({
                error: 'Parse failed',
                stop_reason: stopReason,
                storiesFound: parsed ? (parsed.stories ? parsed.stories.length : 0) : 0,
                raw: rawText.slice(0, 500),
            });
        }

        const briefingStories = parsed.stories
            .filter(s => s.index >= 1 && s.index <= pool.length && s.why)
            .map(s => {
                const a = pool[s.index - 1];
                return {
                    id: a.id, headline: a.headline, summary: a.summary,
                    source: a.source, sourceUrl: a.sourceUrl, image: a.image,
                    topic: a.topic, country: a.country, sourceCity: a.sourceCity,
                    isLocal: a.isLocal,
                    why: s.why, time: a.time,
                };
            })
            .filter(s => s && s.headline);

        if (briefingStories.length === 0) {
            return res.status(500).json({
                error: 'No stories mapped',
                indices: parsed.stories.map(s => s.index),
                poolSize: pool.length,
            });
        }

        // Source cap audit
        const sourceCounts = {};
        for (const s of briefingStories) {
            const src = normaliseSource(s.source);
            sourceCounts[src] = (sourceCounts[src] || 0) + 1;
        }
        const capViolations = Object.keys(sourceCounts).filter(k => sourceCounts[k] > 2);
        if (capViolations.length > 0) {
            console.log('[briefing] SOURCE CAP VIOLATION: ' + JSON.stringify(sourceCounts));
        }

        // Audit: how many city-local picks made it through
        const cityLocalPicked = briefingStories.filter(s => s.sourceCity === userCity).length;

        try {
            const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
            await supabase.from('newsletter_cache').insert({ stories: briefingStories, mood: parsed.mood });
        } catch (e) {}

        return res.status(200).json({
            success: true,
            fromCache: false,
            mood: parsed.mood,
            stories: briefingStories,
            poolSize: pool.length,
            userCity,
            cityLocalInPool,
            cityLocalIdeal,
            cityLocalPicked,
            sourceCounts,
            capViolations,
        });

    } catch (e) {
        return res.status(500).json({
            error: 'Briefing error: ' + (e.message || String(e)),
            stack: (e.stack || '').split('\n').slice(0, 3),
        });
    }
};
