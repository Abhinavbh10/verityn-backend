module.exports = async function handler(req, res) {
    try {
        var key = process.env.ANTHROPIC_API_KEY;
        if (!key) return res.json({ error: 'ANTHROPIC_API_KEY not set' });

        var r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 50,
                messages: [{ role: 'user', content: 'Say hello in one word.' }],
            }),
        });

        var data = await r.json();
        return res.json({ status: r.status, response: data });
    } catch (e) {
        return res.json({ error: e.message });
    }
};
