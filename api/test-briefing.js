module.exports = async function handler(req, res) {
    try {
        var key = process.env.ANTHROPIC_API_KEY;

        var testArticles = [
            'EU carbon border tax takes effect on imports | FT',
            'Fed signals no rate cuts until Q4 as inflation persists | Reuters',
            'Germany green energy hits 60% for first time | DW',
            'Ceasefire extended: What is next in the Iran war? | DW',
            'Samsung workers rally, call for larger share of AI profits | DW',
            'EU forges ahead with membership for Ukraine after Orban exit | Politico',
            'Israel awaiting US green light on Iran, defence minister says | Euronews',
            'India RBI signals August rate cut if oil stabilises | NYT',
            'Sensex crosses 82000 on global optimism | Mint',
            'EU passes landmark AI governance framework | Guardian',
        ];

        var headlines = testArticles.map(function(h, i) {
            return (i + 1) + '. [RELEVANT] ' + h + ' | HAS_IMAGE';
        }).join('\n');

        var system = 'You are a news editor. Select exactly 7 stories. For each write a why in 2 sentences. Respond with valid JSON only.';
        var prompt = 'Pick 7 stories for a finance professional in Berlin, Germany.\n\nArticles:\n' + headlines + '\n\nRespond ONLY with JSON:\n{"mood":"one sentence","stories":[{"index":1,"why":"2 sentences"},{"index":3,"why":"2 sentences"}]}';

        var r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 800,
                system: system,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        var data = await r.json();

        return res.json({
            ok: true,
            claudeStatus: r.status,
            response: data.content ? data.content[0].text : data,
        });
    } catch (e) {
        return res.json({ ok: false, error: e.message });
    }
};
