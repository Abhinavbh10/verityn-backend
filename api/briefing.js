const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    console.log('BRIEFING: handler entered, method=' + req.method);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        console.log('BRIEFING: parsing body');
        var body = req.body || {};
        var bodySize = JSON.stringify(body).length;
        console.log('BRIEFING: body size=' + bodySize);

        var articles = body.articles || [];
        console.log('BRIEFING: articles count=' + articles.length);

        if (!articles.length) {
            return res.status(400).json({ error: 'No articles', bodySize: bodySize });
        }

        // Truncate everything aggressively
        var pool = articles.slice(0, 30).map(function(a) {
            return {
                headline: (a.headline || '').slice(0, 200),
                source: (a.source || '').slice(0, 50),
                summary: (a.summary || '').slice(0, 150),
                sourceUrl: (a.sourceUrl || '').slice(0, 300),
                image: a.image ? String(a.image).slice(0, 300) : null,
                topic: a.topic || 'world',
                country: a.country || 'DE',
                id: a.id || ('a-' + Math.random().toString(36).slice(2, 6)),
            };
        });

        console.log('BRIEFING: pool ready, size=' + pool.length);

        var countries = body.countries || ['de'];
        var location = body.location || 'de';
        var profession = body.profession || null;
        var interests = body.interests || [];

        var COUNTRY_NAMES = {
            de:'Germany',in:'India',us:'United States',gb:'United Kingdom',
            au:'Australia',sg:'Singapore',ae:'UAE',jp:'Japan'
        };

        var locationStr = COUNTRY_NAMES[location] || location || 'Germany';
        var professionStr = profession || '';

        var headlinesList = pool.map(function(a, i) {
            return (i+1) + '. ' + a.headline + ' | ' + a.source + (a.image ? ' | HAS_IMAGE' : '');
        }).join('\n');

        console.log('BRIEFING: calling Claude, headlines length=' + headlinesList.length);

        var key = process.env.ANTHROPIC_API_KEY;
        if (!key) return res.status(500).json({ error: 'No ANTHROPIC_API_KEY' });

        var claudeBody = JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 800,
            system: 'You are a news editor. Select 7 stories. Write 2-sentence why-lines. Respond with JSON only, no markdown.',
            messages: [{
                role: 'user',
                content: 'Pick ' + Math.min(7, pool.length) + ' stories for a ' + (professionStr || 'professional') + ' in ' + locationStr + '.\n\nArticles:\n' + headlinesList + '\n\nRespond ONLY with JSON:\n{"mood":"one sentence","stories":[{"index":1,"why":"2 sentences"}]}'
            }],
        });

        console.log('BRIEFING: claude request size=' + claudeBody.length);

        var r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
            },
            body: claudeBody,
        });

        console.log('BRIEFING: claude responded, status=' + r.status);

        var data = await r.json();

        if (data.error) {
            console.log('BRIEFING: claude error=' + JSON.stringify(data.error));
            return res.status(500).json({ error: 'Claude: ' + (data.error.message || JSON.stringify(data.error)) });
        }

        var rawText = (data.content && data.content[0] && data.content[0].text) || '';
        console.log('BRIEFING: raw response length=' + rawText.length);

        // Parse JSON from response
        var parsed = null;
        try { parsed = JSON.parse(rawText); } catch(e) {}
        if (!parsed) {
            try { parsed = JSON.parse(rawText.replace(/```json\s*/gi,'').replace(/```\s*/gi,'').trim()); } catch(e) {}
        }
        if (!parsed) {
            try { var m = rawText.match(/[\[{][\s\S]*[\]}]/); if(m) parsed = JSON.parse(m[0]); } catch(e) {}
        }

        console.log('BRIEFING: parsed=' + (parsed ? 'yes, stories=' + (parsed.stories ? parsed.stories.length : 0) : 'no'));

        if (!parsed || !parsed.stories || parsed.stories.length < Math.min(7, pool.length)) {
            return res.status(500).json({ error: 'Parse failed', raw: rawText.slice(0, 300) });
        }

        var briefingStories = parsed.stories.map(function(s) {
            if (s.index < 1 || s.index > pool.length) return null;
            var a = pool[s.index - 1];
            return {
                id: a.id, headline: a.headline, summary: a.summary,
                source: a.source, sourceUrl: a.sourceUrl, image: a.image,
                topic: a.topic, country: a.country, why: s.why,
            };
        }).filter(function(s) { return s && s.headline; });

        console.log('BRIEFING: mapped stories=' + briefingStories.length);

        // Cache
        try {
            var supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
            await supabase.from('newsletter_cache').insert({ stories: briefingStories, mood: parsed.mood });
        } catch(e) { console.log('BRIEFING: cache error=' + e.message); }

        console.log('BRIEFING: success');
        return res.status(200).json({ success: true, fromCache: false, mood: parsed.mood, stories: briefingStories });

    } catch(e) {
        console.log('BRIEFING: CATCH error=' + e.message);
        return res.status(500).json({ error: e.message, stack: (e.stack||'').split('\n').slice(0,3) });
    }
};
