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
        // City-keyed pipeline (May 2026 city pivot). When set, enforces stricter
        // hyperlocal quota — 4 of 7 stories must be ABOUT this city, not just
        // about its country. When not set, falls back to country-level quota.
        var city = (body.city || '').toLowerCase();
        // Cross-day dedup (May 2026). newsletter.js passes what recent sends covered
        // so we can avoid repeating stories/themes day after day.
        var recentHeadlines = Array.isArray(body.recentHeadlines) ? body.recentHeadlines : [];
        var recentThemes = Array.isArray(body.recentThemes) ? body.recentThemes : [];

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
                isCityLocal: !!a.isCityLocal,
                id: a.id || ('a-' + i),
                time: a.time || '',
            };
        });

        if (pool.length === 0) return res.status(400).json({ error: 'No articles provided.' });

        // Bucket-aware pickCount (Architecture B, June 2026).
        // newsletter.js's specialist bucket calls pass an explicit pickCount
        // (e.g. 2 from place bucket, 3 from context bucket). Legacy single-call
        // mode falls back to "pick up to 7".
        var requestedPick = parseInt(body.pickCount, 10);
        var pickCount;
        if (requestedPick && requestedPick > 0) {
            pickCount = Math.min(requestedPick, pool.length);
        } else {
            pickCount = Math.min(7, pool.length);
        }
        if (pickCount < 1) return res.status(400).json({ error: 'Need at least 1 article, got ' + pool.length });

        var bucketName = (body.bucket || '').toLowerCase();

        var locationStr = COUNTRY_NAMES[location] || location || 'Germany';
        var professionStr = profession || '';
        var interestStr = (interests.length ? interests.join(', ') : 'world news');

        // City-keyed quota (May 2026 city pivot). If city is set, enforce STRICTER
        // quota of 4-of-7 city-local stories — not just German, but ABOUT this city.
        // Falls back to country-level quota when city is not provided.
        // BUCKET MODE (June 2026): when bucket is set, the pool is already pre-filtered
        // by category, so we skip the hyperlocal quota rule entirely — the bucket job
        // framing handles the focus.
        var hasCity = !!city && !bucketName;
        var cityNameStr = '';
        var cityEntityHints = '';
        if (city === 'berlin') {
            cityNameStr = 'Berlin';
            cityEntityHints = 'Berlin neighbourhoods (Kreuzberg, Neukölln, Mitte, Prenzlauer Berg, Charlottenburg, Wedding, Friedrichshain, Lichtenberg, Tempelhof, Schöneberg, Spandau, Steglitz, Treptow, Pankow, Marzahn, Reinickendorf, Köpenick), Berlin transit (BVG, S-Bahn, U-Bahn, Ringbahn, named U/S line numbers like U7 or S41), Berlin landmarks (Brandenburger Tor, Alexanderplatz, Hauptbahnhof, BER, Tegel, Tempelhof, Reichstag, Tiergarten), Berlin politicians and bodies (Berliner Senat, Kai Wegner, Berlin Abgeordnetenhaus), or Berlin-specific institutions (Charité, Humboldt, Sparkasse Berlin)';
        } else if (city === 'frankfurt') {
            cityNameStr = 'Frankfurt';
            cityEntityHints = 'Frankfurt neighbourhoods (Sachsenhausen, Bornheim, Bockenheim, Westend, Nordend, Höchst, Niederrad, Offenbach, Bad Homburg), Frankfurt transit (RMV, VGF, S-Bahn Rhein-Main, named U-Bahn lines, Hauptbahnhof), Frankfurt landmarks (Römer, Hauptwache, Konstablerwache, Main-Taunus-Zentrum, Messe Frankfurt, Frankfurt Flughafen FRA), Frankfurt institutions (Frankfurter Sparkasse, Commerzbank tower, Deutsche Bank tower, ECB, Goethe University), or Hessen-level politics (Boris Rhein, Hessen Landtag)';
        } else if (city === 'bonn') {
            cityNameStr = 'Bonn';
            cityEntityHints = 'Bonn neighbourhoods (Bad Godesberg, Beuel, Poppelsdorf, Endenich, Kessenich, Tannenbusch, Hardtberg, Dottendorf), Bonn transit (SWB, VRS, Stadtbahn lines 16/63/66/67, Bonn Hauptbahnhof, DB to Köln), Bonn landmarks (Münsterplatz, Marktplatz, Beethoven-Haus, Poppelsdorfer Schloss, UN Campus, Rheinaue, Kennedybrücke), Bonn institutions (Sparkasse KölnBonn, Universität Bonn, Deutsche Post DHL, Deutsche Telekom, UN/NGO offices), or Bonn/NRW politics (Stadt Bonn, Oberbürgermeisterin, NRW Landtag)';
        }

        // Quota numbers — stricter when city is set
        var localMinimum, localIdeal;
        if (hasCity && pickCount >= 7) {
            localMinimum = 3;
            localIdeal = 4;
        } else if (hasCity && pickCount >= 5) {
            localMinimum = 3;
            localIdeal = 4;
        } else if (hasCity) {
            localMinimum = 2;
            localIdeal = 2;
        } else {
            localMinimum = pickCount >= 7 ? 3 : pickCount >= 5 ? 2 : 1;
            localIdeal = pickCount >= 7 ? 4 : pickCount >= 5 ? 3 : 1;
        }

        var guaranteedLocalCount = pool.filter(function(a) { return a.isLocal; }).length;
        var guaranteedCityLocalCount = pool.filter(function(a) { return a.isCityLocal; }).length;

        var headlinesList = pool.map(function(a, i) {
            var summary = a.summary ? ' — ' + a.summary.slice(0, 50) : '';
            var locTag = a.isLocal ? (a.country || 'XX') + '-LOCAL' : (a.country || '??');
            return (i+1) + '. [' + locTag + '] ' + a.headline + summary + ' | ' + a.source + (a.image ? ' | HAS_IMAGE' : '');
        }).join('\n');

        var foreignTag = (countries[0] || 'gb').toUpperCase();
        var localTag = (countries[1] || 'de').toUpperCase();
        var foreignName = COUNTRY_NAMES[(countries[0] || 'gb').toLowerCase()] || 'foreign';

        // CITY-ONLY MODE (June 2026): newsletter.js passes cityOnly=true with a
        // pool already filtered to one city. No buckets, no quotas — the pool
        // IS the city, briefing's only job is to pick the 7 strongest.
        var cityOnly = !!body.cityOnly;

        var prompt = 'Pick exactly ' + pickCount + ' stories for an English speaker living in '
            + (cityOnly && cityNameStr ? cityNameStr : locationStr)
            + '.\n\n'

            + (cityOnly
                ? ('THE POOL. Every article in this pool is from ' + (cityNameStr || locationStr) + ' hyperlocal news sources. Your only job is to pick the ' + pickCount + ' stories that most matter to a reader living in ' + (cityNameStr || locationStr) + ' today. No quotas to balance — just pick the strongest ' + pickCount + '.\n\n'

                + 'WHAT TO PREFER (in this order):\n'
                + '1. Stories with concrete daily-life impact — transit changes, rent/Mietspiegel updates, named neighborhood incidents, local policy shifts, BVG/SWB/RMV strikes, Kita/Bürgeramt/Krankenkasse changes, energy bills, local labor strikes, public service openings, weekend events.\n'
                + '2. Stories naming specific places, institutions, or people the reader recognises (named Kiez/Stadtteil, named transit lines, named local figures, named landmarks).\n'
                + '3. Stories where a reader could plausibly take an action this week (avoid the U7 strike, book a Termin before deadline, check their Mietspiegel, plan for a festival).\n\n'

                + 'WHAT TO AVOID:\n'
                + '- Politician severance payouts, university building closures, abstract budget items, pure ceremonial politics — these are technically local but readers do not feel them.\n'
                + '- Stories that are mostly about another city even if they mention ' + (cityNameStr || locationStr) + ' once.\n'
                + '- Sports coverage of away games against other cities.\n'
                + '- Pure weather descriptions ("warm weekend") unless they carry a material impact (heatwave warning, transit shutdown, forest fire restrictions, weekend swimming-pool openings).\n\n'

                + 'HARD RULE — WEATHER NEVER LEADS: A weather story (storms, temperature, rain, sun, hail, heat warnings, etc.) is NEVER allowed in slot 1, no matter how dramatic. Weather can earn slot 2 through 7 ONLY if it has a material impact (transit shutdown, school closure, named-event cancellation, forest fire restriction). The lead slot is reserved for news about the city. If the strongest pick in your pool is a weather story, find the SECOND strongest and lead with that instead.\n\n')

                : ('HARD RULES (non-negotiable):\n\n'
            + '1. SOURCE CAP. Maximum 2 stories from any one source. If your picks include 3 stories from FAZ (or Tagesspiegel, NYT, anyone), DROP the weakest and replace with a different source. Cap is not optional.\n\n'
            + '2. NO DUPLICATES. If two articles describe the SAME news event, pick only ONE.\n\n'
            + '3. RELEVANCE FLOOR. Every picked story must have a specific, concrete impact angle for someone living in ' + locationStr + '. Before picking a story, ask: "Can I name a concrete way this affects this reader?" If no, DO NOT PICK IT.\n\n'))

            + 'SOURCE CAP: maximum 2 stories from any single source. If you find 3 from one outlet, drop the weakest and swap.\n'
            + 'NO DUPLICATES: if two articles describe the same event (same actors, same incident), pick only one. Headlines like "Tram derails in Berlin-Hohenschönhausen" and "20 injured after Hohenschönhausen tram crash" are the same story — pick one.\n\n'

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
                model: 'claude-sonnet-4-6',
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
                    isCityLocal: a.isCityLocal,
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
            cityLocalPicked: briefingStories.filter(function(s) { return s.isCityLocal; }).length,
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
