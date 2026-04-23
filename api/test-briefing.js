const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    try {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') return res.status(200).end();

        var params = req.method === 'POST' ? req.body : {};
        var articles = params.articles || [];

        // Step 1: Check body size
        var bodySize = JSON.stringify(params).length;

        // Step 2: Build a minimal prompt
        var headlines = articles.slice(0, 15).map(function(a, i) {
            return (i + 1) + '. ' + (a.headline || 'No headline');
        }).join('\n');

        // Step 3: Call Claude
        var key = process.env.ANTHROPIC_API_KEY;
        var r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 400,
                system: 'You are a news editor. Pick 7 stories and write a one-line summary for each. Respond with JSON only.',
                messages: [{ role: 'user', content: 'Pick 7:\n' + headlines }],
            }),
        });

        var data = await r.json();

        return res.json({
            ok: true,
            bodySize: bodySize,
            articlesReceived: articles.length,
            headlinesSent: articles.slice(0, 15).length,
            claudeStatus: r.status,
            claudeResponse: data.content ? data.content[0].text.slice(0, 200) : data,
        });
    } catch (e) {
        return res.json({
            ok: false,
            error: e.message,
            stack: (e.stack || '').split('\n').slice(0, 4),
        });
    }
};
