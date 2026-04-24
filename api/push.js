// api/push.js — Push notification management
// Actions: register | send | send-all
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        var supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
        var action = req.query.action || (req.body && req.body.action);

        // ── Register token ──
        if (action === 'register') {
            var body = req.body || {};
            if (!body.expoToken) return res.status(400).json({ error: 'expoToken required' });

            var { error } = await supabase.from('push_tokens').upsert({
                session_id: body.sessionId || 'anonymous',
                expo_token: body.expoToken,
                platform: body.platform || 'unknown',
                timezone: body.timezone || 'UTC',
                location: body.location || 'us',
                interests: body.interests || ['world'],
                enabled: true,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'expo_token' });

            if (error) return res.status(500).json({ error: error.message });
            return res.json({ ok: true, registered: true });
        }

        // ── Send to specific tokens (for testing) ──
        if (action === 'send') {
            var body2 = req.body || {};
            var tokens = body2.tokens || [];
            var title = body2.title || 'Verityn';
            var msgBody = body2.body || 'Your briefing is ready.';
            var data = body2.data || {};

            if (!tokens.length) return res.status(400).json({ error: 'tokens array required' });

            var result = await sendPush(tokens, title, msgBody, data);
            return res.json(result);
        }

        // ── Send to all enabled users (cron) ──
        if (action === 'send-all') {
            var body3 = req.body || {};
            var pushType = body3.type || 'manual';
            var title2 = body3.title || (pushType === 'morning' ? 'Good morning' : pushType === 'evening' ? 'Good evening' : 'Verityn');
            var msgBody2 = body3.body || 'Your briefing is ready.';

            // Get all enabled tokens
            var { data: tokenRows, error: fetchErr } = await supabase
                .from('push_tokens')
                .select('expo_token')
                .eq('enabled', true);

            if (fetchErr) return res.status(500).json({ error: fetchErr.message });
            if (!tokenRows || !tokenRows.length) return res.json({ ok: true, sent: 0, reason: 'No tokens' });

            var allTokens = tokenRows.map(function(r) { return r.expo_token; });
            var result2 = await sendPush(allTokens, title2, msgBody2, { type: pushType });

            // Log
            try {
                await supabase.from('push_log').insert({
                    push_type: pushType,
                    sent_count: result2.sent,
                    failed_count: result2.failed,
                    errors: result2.errors.length > 0 ? result2.errors : null,
                });
            } catch (e) {}

            return res.json(result2);
        }

        return res.json({ error: 'action must be register, send, or send-all' });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};

// ── Expo Push API sender ──
async function sendPush(tokens, title, body, data) {
    var messages = tokens.map(function(token) {
        return {
            to: token,
            sound: 'default',
            title: title,
            body: body,
            data: data || {},
        };
    });

    // Expo recommends chunks of 100
    var chunks = [];
    for (var i = 0; i < messages.length; i += 100) {
        chunks.push(messages.slice(i, i + 100));
    }

    var sent = 0, failed = 0, errors = [];

    for (var c = 0; c < chunks.length; c++) {
        try {
            var r = await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(chunks[c]),
            });
            var result = await r.json();

            if (result.data) {
                for (var d = 0; d < result.data.length; d++) {
                    if (result.data[d].status === 'ok') sent++;
                    else {
                        failed++;
                        errors.push({ token: chunks[c][d].to, error: result.data[d].message });
                    }
                }
            }
        } catch (e) {
            failed += chunks[c].length;
            errors.push({ chunk: c, error: e.message });
        }
    }

    return { ok: true, sent: sent, failed: failed, total: tokens.length, errors: errors };
}
