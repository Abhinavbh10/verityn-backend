// api/newsletter.js — Verityn daily brief newsletter
// Actions: subscribe | unsubscribe | preview | test | send

var FROM_EMAIL = 'hello@verityn.news';
var FROM_NAME = 'Verityn';
var BATCH_SIZE = 100;

function getSupabase() {
    var { createClient } = require('@supabase/supabase-js');
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function getTransporter() {
    var nodemailer = require('nodemailer');
    return nodemailer.createTransport({
        host: 'smtpout.secureserver.net',
        port: 465,
        secure: true,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        tls: { rejectUnauthorized: false },
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildStoryCard(s, i) {
    var num = i + 1;
    var source = (s.source || 'NEWS').toUpperCase();
    var headline = escapeHtml(s.headline);
    var why = escapeHtml(s.why || '');
    var url = s.sourceUrl || 'https://verityn.news';

    return '<tr><td style="padding-bottom:10px">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;border-radius:12px"><tr><td style="padding:16px">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + '<tr><td style="padding-bottom:8px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="width:20px;height:20px;background-color:#C0392B;border-radius:10px;text-align:center;vertical-align:middle;font-size:11px;font-weight:900;color:#FFFFFF">' + num + '</td>'
        + '<td style="padding-left:8px;font-size:11px;font-weight:600;color:#999999">' + source + '</td>'
        + '</tr></table></td></tr>'
        + '<tr><td style="font-family:Georgia,serif;font-size:16px;font-weight:700;line-height:1.25;color:#111111;padding-bottom:8px">' + headline + '</td></tr>'
        + '<tr><td style="padding-bottom:10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBF4F3;border-radius:8px"><tr>'
        + '<td style="padding:10px 12px;font-size:13px;color:#5C3A1E;line-height:1.45">' + why + '</td>'
        + '</tr></table></td></tr>'
        + '<tr><td><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="background-color:#111111;border-radius:14px;padding:5px 14px"><a href="' + url + '" style="font-size:12px;font-weight:700;color:#FFFFFF;text-decoration:none">Read &#8250;</a></td>'
        + '</tr></table></td></tr>'
        + '</table></td></tr></table></td></tr>';
}

function buildSubjectLine(stories) {
    // Use top story's headline + why-line essence as subject
    if (!stories || !stories.length) return 'Your 7 stories are ready';
    var top = stories[0];
    var headline = (top.headline || '').replace(/\s+/g, ' ').trim();
    // Keep under 60 chars for mobile preview
    if (headline.length > 55) headline = headline.substring(0, 52) + '...';
    return headline;
}

function buildEmailHTML(stories, recipientName, email) {
    var name = recipientName || 'there';
    var today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    var hour = new Date().getUTCHours() + 2; // rough CET
    var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    var unsubLink = 'https://verityn.news/unsubscribe?email=' + encodeURIComponent(email || '');

    var storyCards = '';
    for (var i = 0; i < stories.length; i++) {
        storyCards += buildStoryCard(stories[i], i);
    }

    return '<!DOCTYPE html>'
        + '<html lang="en"><head>'
        + '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">'
        + '<meta name="x-apple-disable-message-reformatting">'
        + '<title>Verityn Daily Brief</title>'
        + '<style>body,table,td{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif}body{margin:0;padding:0;background-color:#F2EDE5}table{border-collapse:collapse}</style>'
        + '</head><body style="margin:0;padding:0;background-color:#F2EDE5">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F2EDE5">'
        + '<tr><td align="center" style="padding:24px 16px">'
        + '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">'
        // Header
        + '<tr><td style="padding:0 0 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:#C0392B;vertical-align:baseline">V<span style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;color:#111111">erityn</span></td>'
        + '<td style="text-align:right;font-size:11px;color:#999999;vertical-align:bottom">' + today + '</td>'
        + '</tr></table></td></tr>'
        // Greeting
        + '<tr><td style="padding:0 0 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + '<tr><td style="font-family:Georgia,serif;font-size:16px;font-weight:700;color:#111111;padding-bottom:2px">' + greeting + ', ' + escapeHtml(name) + '</td></tr>'
        + '<tr><td style="font-size:12px;color:#999999">4 min &middot; 7 stories &middot; why they matter to you</td></tr>'
        + '</table></td></tr>'
        // Stories
        + storyCards
        // Caught up
        + '<tr><td style="text-align:center;padding:8px 0 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + '<tr><td style="font-family:Georgia,serif;font-size:14px;font-weight:700;color:#111111;text-align:center;padding-bottom:4px">You\'re caught up.</td></tr>'
        + '<tr><td style="font-size:11px;color:#999999;text-align:center;padding-bottom:14px">Forward this to someone who hates doomscrolling.</td></tr>'
        + '</table></td></tr>'
        // Footer
        + '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#111111;border-radius:0 0 12px 12px">'
        + '<tr><td style="padding:20px 24px;text-align:center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + '<tr><td style="text-align:center;padding-bottom:8px"><span style="font-family:Georgia,serif;font-size:14px;font-weight:700;color:#C0392B">V</span><span style="font-size:12px;font-weight:800;color:rgba(245,240,232,0.6)">erityn</span></td></tr>'
        + '<tr><td style="text-align:center;font-size:11px;color:rgba(245,240,232,0.3);line-height:1.8">'
        + '<a href="' + unsubLink + '" style="color:rgba(245,240,232,0.3);text-decoration:underline">Unsubscribe</a> &middot; '
        + '<a href="https://verityn.news" style="color:rgba(245,240,232,0.3);text-decoration:underline">verityn.news</a></td></tr>'
        + '</table></td></tr></table></td></tr>'
        + '</table></td></tr></table></body></html>';
}

async function getLatestBriefing(supabase) {
    try {
        var result = await supabase
            .from('newsletter_cache')
            .select('stories, created_at')
            .order('created_at', { ascending: false })
            .limit(1);

        if (result.data && result.data.length > 0 && result.data[0].stories && result.data[0].stories.length >= 3) {
            return result.data[0].stories;
        }
    } catch (e) { }

    // Generate fresh briefing if cache empty
    try {
        var r = await fetch('https://verityn-backend-ten.vercel.app/api/briefing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                countries: ['us', 'gb', 'de', 'in'],
                interests: ['world', 'finance', 'tech', 'politics'],
                location: 'de',
                profession: 'professional',
                sessionId: 'newsletter',
            }),
        });
        var d = await r.json();
        if (d.stories && d.stories.length >= 3) {
            try { await supabase.from('newsletter_cache').insert({ stories: d.stories }); } catch (e) { }
            return d.stories;
        }
    } catch (e) { }

    return null;
}

async function getSubscribers(supabase) {
    var result = await supabase
        .from('waitlist')
        .select('email, name')
        .eq('unsubscribed', false)
        .order('created_at', { ascending: true });

    if (result.error) throw new Error('Supabase: ' + result.error.message);
    return result.data || [];
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        var supabase = getSupabase();
        var action = req.query.action || (req.body && req.body.action);

        // ── Subscribe ──
        if (action === 'subscribe') {
            var body = req.body || {};
            var email = (body.email || '').trim().toLowerCase();
            if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

            var name = (body.name || email.split('@')[0]).trim();

            // Check if already exists
            var existing = await supabase.from('waitlist').select('id, unsubscribed').eq('email', email).limit(1);
            if (existing.data && existing.data.length > 0) {
                if (existing.data[0].unsubscribed) {
                    // Re-subscribe
                    await supabase.from('waitlist').update({ unsubscribed: false, name: name }).eq('email', email);
                    return res.json({ ok: true, resubscribed: true });
                }
                return res.json({ ok: true, already: true });
            }

            var { error } = await supabase.from('waitlist').insert({ email: email, name: name, unsubscribed: false });
            if (error) return res.status(500).json({ error: error.message });
            return res.json({ ok: true, subscribed: true });
        }

        // ── Unsubscribe ──
        if (action === 'unsubscribe') {
            var email2 = (req.query.email || (req.body && req.body.email) || '').trim().toLowerCase();
            if (!email2) return res.status(400).json({ error: 'Email required' });

            await supabase.from('waitlist').update({ unsubscribed: true }).eq('email', email2);
            return res.json({ ok: true, unsubscribed: true });
        }

        // ── Preview ──
        if (action === 'preview') {
            var stories = await getLatestBriefing(supabase);
            if (!stories) return res.json({ error: 'No briefing available yet.' });
            res.setHeader('Content-Type', 'text/html');
            return res.send(buildEmailHTML(stories, 'Reader', 'preview@example.com'));
        }

        // ── Test ──
        if (action === 'test') {
            var testEmail = req.query.email;
            if (!testEmail) return res.json({ error: 'Add &email=your@email.com' });
            if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return res.json({ error: 'SMTP creds not set' });

            var stories2 = await getLatestBriefing(supabase);
            if (!stories2) return res.json({ error: 'No briefing available yet.' });

            var transporter = getTransporter();
            var subject = buildSubjectLine(stories2);
            try {
                var result = await transporter.sendMail({
                    from: FROM_NAME + ' <' + FROM_EMAIL + '>',
                    to: testEmail,
                    subject: subject,
                    html: buildEmailHTML(stories2, testEmail.split('@')[0], testEmail),
                });
                try { transporter.close(); } catch (e) { }
                return res.json({ ok: true, messageId: result.messageId, subject: subject, to: testEmail });
            } catch (e) {
                try { transporter.close(); } catch (e2) { }
                return res.json({ error: 'SMTP failed: ' + e.message });
            }
        }

        // ── Send to all ──
        if (action === 'send') {
            if (process.env.NEWSLETTER_ENABLED !== 'true') return res.json({ ok: false, reason: 'Set NEWSLETTER_ENABLED=true' });
            if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return res.json({ error: 'SMTP creds not set' });

            var stories3 = await getLatestBriefing(supabase);
            if (!stories3) return res.json({ error: 'No briefing available' });

            var subscribers = await getSubscribers(supabase);
            if (!subscribers.length) return res.json({ ok: true, sent: 0, reason: 'No subscribers' });

            var subject2 = buildSubjectLine(stories3);
            var transporter2 = getTransporter();
            var sent = 0, failed = 0, errors = [];

            for (var i = 0; i < Math.min(subscribers.length, BATCH_SIZE); i++) {
                var sub = subscribers[i];
                try {
                    await transporter2.sendMail({
                        from: FROM_NAME + ' <' + FROM_EMAIL + '>',
                        to: sub.email,
                        subject: subject2,
                        html: buildEmailHTML(stories3, sub.name || sub.email.split('@')[0], sub.email),
                    });
                    sent++;
                } catch (e) {
                    failed++;
                    errors.push({ email: sub.email, error: e.message });
                }
                if (i > 0 && i % 5 === 0) await new Promise(function(r) { setTimeout(r, 2000); });
            }

            try { transporter2.close(); } catch (e) { }
            try {
                await supabase.from('newsletter_log').insert({
                    sent_count: sent, failed_count: failed,
                    errors: errors.length > 0 ? errors : null,
                    subject: subject2, story_count: stories3.length,
                });
            } catch (e) { }

            return res.json({ ok: true, sent: sent, failed: failed, total: subscribers.length, subject: subject2 });
        }

        return res.json({ actions: 'subscribe, unsubscribe, preview, test, send' });
    } catch (e) {
        return res.json({ error: e.message });
    }
};
