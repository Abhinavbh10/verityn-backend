// api/newsletter.js — Verityn daily brief newsletter
const { createClient } = require('@supabase/supabase-js');
var nodemailer = null;

var supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

var SMTP_USER = process.env.SMTP_USER;
var SMTP_PASS = process.env.SMTP_PASS;
var ENABLED = process.env.NEWSLETTER_ENABLED === 'true';
var FROM_EMAIL = 'hello@verityn.news';
var FROM_NAME = 'Verityn';
var BATCH_SIZE = 100;

function getTransporter() {
    if (!nodemailer) nodemailer = require('nodemailer');
    return nodemailer.createTransport({
        host: 'smtpout.secureserver.net',
        port: 465,
        secure: true,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
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
        // Badge + source
        + '<tr><td style="padding-bottom:8px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="width:20px;height:20px;background-color:#C0392B;border-radius:10px;text-align:center;vertical-align:middle;font-size:11px;font-weight:900;color:#FFFFFF">' + num + '</td>'
        + '<td style="padding-left:8px;font-size:11px;font-weight:600;color:#999999">' + source + '</td>'
        + '</tr></table></td></tr>'
        // Headline
        + '<tr><td style="font-family:Georgia,serif;font-size:16px;font-weight:700;line-height:1.25;color:#111111;padding-bottom:8px">' + headline + '</td></tr>'
        // Why box
        + '<tr><td style="padding-bottom:10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBF4F3;border-radius:8px"><tr>'
        + '<td style="padding:10px 12px;font-size:13px;color:#5C3A1E;line-height:1.45">' + why + '</td>'
        + '</tr></table></td></tr>'
        // Buttons
        + '<tr><td><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="background-color:#111111;border-radius:14px;padding:5px 14px"><a href="' + url + '" style="font-size:12px;font-weight:700;color:#FFFFFF;text-decoration:none">Read &#8250;</a></td>'
        + '<td style="width:6px"></td>'
        + '<td style="background-color:#FBF4F3;border-radius:14px;padding:5px 14px"><a href="https://verityn.news" style="font-size:12px;font-weight:700;color:#C0392B;text-decoration:none">Deep Dive &#8250;</a></td>'
        + '</tr></table></td></tr>'
        + '</table></td></tr></table>'
        + '</td></tr>';
}

function buildEmailHTML(stories, recipientName) {
    var name = recipientName || 'there';
    var today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    var hour = new Date().getHours();
    var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    var storyCards = '';
    for (var i = 0; i < stories.length; i++) {
        storyCards += buildStoryCard(stories[i], i);
    }

    var html = '<!DOCTYPE html>'
        + '<html lang="en"><head>'
        + '<meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1.0">'
        + '<meta name="x-apple-disable-message-reformatting">'
        + '<title>Verityn Daily Brief</title>'
        + '<style>body,table,td{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif}body{margin:0;padding:0;background-color:#F2EDE5}table{border-collapse:collapse}</style>'
        + '</head>'
        + '<body style="margin:0;padding:0;background-color:#F2EDE5">'
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
        + '<tr><td style="font-size:12px;color:#999999">4 min &middot; 7 stories</td></tr>'
        + '</table></td></tr>'
        // Stories
        + storyCards
        // Caught up
        + '<tr><td style="text-align:center;padding:8px 0 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + '<tr><td style="font-family:Georgia,serif;font-size:14px;font-weight:700;color:#111111;text-align:center;padding-bottom:4px">You\'re caught up.</td></tr>'
        + '<tr><td style="font-size:11px;color:#999999;text-align:center;padding-bottom:14px">Go deeper on any story in the app.</td></tr>'
        + '<tr><td align="center"><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="background-color:#C0392B;border-radius:8px;padding:10px 24px"><a href="https://verityn.news" style="font-size:13px;font-weight:600;color:#FFFFFF;text-decoration:none">Open Verityn</a></td>'
        + '</tr></table></td></tr></table></td></tr>'
        // Footer
        + '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#111111">'
        + '<tr><td style="padding:20px 24px;text-align:center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + '<tr><td style="text-align:center;padding-bottom:8px"><span style="font-family:Georgia,serif;font-size:14px;font-weight:700;color:#C0392B">V</span><span style="font-size:12px;font-weight:800;color:rgba(245,240,232,0.6)">erityn</span></td></tr>'
        + '<tr><td style="text-align:center;font-size:11px;color:rgba(245,240,232,0.3);line-height:1.8">'
        + '<a href="https://verityn.news/unsubscribe" style="color:rgba(245,240,232,0.3);text-decoration:underline">Unsubscribe</a> &middot; '
        + '<a href="https://verityn.news/preferences" style="color:rgba(245,240,232,0.3);text-decoration:underline">Preferences</a> &middot; '
        + '<a href="https://instagram.com/verityn.news" style="color:rgba(245,240,232,0.3);text-decoration:underline">Instagram</a><br>verityn.news</td></tr>'
        + '</table></td></tr></table></td></tr>'
        // Close
        + '</table></td></tr></table></body></html>';

    return html;
}

async function getLatestBriefing() {
    // Try newsletter cache first
    try {
        var result = await supabase
            .from('newsletter_cache')
            .select('stories, created_at')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (result.data && result.data.stories && result.data.stories.length >= 7) {
            return result.data.stories;
        }
    } catch (e) { }

    // Fallback: call the briefing API
    try {
        var r = await fetch('https://verityn-backend-ten.vercel.app/api/ai?action=briefing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                articles: [],
                countries: ['de', 'in'],
                interests: ['finance', 'tech', 'world'],
                location: 'de',
                profession: 'finance',
                sessionId: 'newsletter',
                ts: Date.now(),
            }),
        });
        var d = await r.json();
        if (d.stories && d.stories.length >= 7) {
            try {
                await supabase.from('newsletter_cache').insert({ stories: d.stories, mood: d.mood });
            } catch (e) { }
            return d.stories;
        }
    } catch (e) { }

    return null;
}

async function getSubscribers() {
    var result = await supabase
        .from('waitlist')
        .select('email, name')
        .eq('unsubscribed', false)
        .order('created_at', { ascending: true });

    if (result.error) throw new Error('Supabase: ' + result.error.message);
    return result.data || [];
}

async function sendOneEmail(transporter, to, subject, html) {
    return transporter.sendMail({
        from: FROM_NAME + ' <' + FROM_EMAIL + '>',
        to: to,
        subject: subject,
        html: html,
    });
}

module.exports = async function handler(req, res) {
    try {
        var action = req.query.action;
        var email = req.query.email;

        // Preview — renders in browser, no SMTP needed
        if (action === 'preview') {
            var stories = await getLatestBriefing();
            if (!stories) {
                return res.status(200).json({
                    error: 'No briefing available yet.',
                    hint: 'The newsletter_cache table is empty. Open the app first to generate a briefing, or insert test data into newsletter_cache manually.',
                });
            }
            res.setHeader('Content-Type', 'text/html');
            return res.send(buildEmailHTML(stories, 'John'));
        }

        // Test — send one email to yourself
        if (action === 'test') {
            if (!email) return res.status(400).json({ error: 'Add &email=your@email.com to the URL' });
            if (!SMTP_USER || !SMTP_PASS) return res.status(200).json({ error: 'SMTP_USER and SMTP_PASS not set. Add them in Vercel dashboard > Settings > Environment Variables.' });

            var stories2 = await getLatestBriefing();
            if (!stories2) return res.status(200).json({ error: 'No briefing available yet.' });

            var transporter = getTransporter();
            var today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            try {
                var result2 = await sendOneEmail(transporter, email, 'Your 7 stories \u2014 ' + today, buildEmailHTML(stories2, email.split('@')[0]));
                try { transporter.close(); } catch (e) { }
                return res.json({ ok: true, messageId: result2.messageId, to: email });
            } catch (e) {
                try { transporter.close(); } catch (e2) { }
                return res.status(200).json({ error: 'SMTP send failed: ' + e.message });
            }
        }

        // Send — to all subscribers (cron)
        if (action === 'send') {
            if (!ENABLED) return res.json({ ok: false, reason: 'Newsletter disabled. Set NEWSLETTER_ENABLED=true in Vercel env vars.' });
            if (!SMTP_USER || !SMTP_PASS) return res.status(200).json({ error: 'SMTP credentials not set' });

            var stories3 = await getLatestBriefing();
            if (!stories3) return res.status(200).json({ error: 'No briefing available' });

            var subscribers = await getSubscribers();
            if (!subscribers.length) return res.json({ ok: true, sent: 0, reason: 'No subscribers' });

            var today2 = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            var subject = 'Your 7 stories \u2014 ' + today2;
            var transporter2 = getTransporter();
            var sent = 0, failed = 0, errors = [];

            for (var i = 0; i < Math.min(subscribers.length, BATCH_SIZE); i++) {
                var sub = subscribers[i];
                try {
                    await sendOneEmail(transporter2, sub.email, subject, buildEmailHTML(stories3, sub.name || sub.email.split('@')[0]));
                    sent++;
                } catch (e) {
                    failed++;
                    errors.push({ email: sub.email, error: e.message });
                }
                if (i > 0 && i % 5 === 0) {
                    await new Promise(function(resolve) { setTimeout(resolve, 2000); });
                }
            }

            try { transporter2.close(); } catch (e) { }

            try {
                await supabase.from('newsletter_log').insert({
                    sent_count: sent,
                    failed_count: failed,
                    errors: errors.length > 0 ? errors : null,
                    subject: subject,
                    story_count: stories3.length,
                });
            } catch (e) { }

            return res.json({ ok: true, sent: sent, failed: failed, total: subscribers.length });
        }

        return res.status(200).json({ error: 'action must be preview, test, or send', usage: '/api/newsletter?action=preview' });

    } catch (e) {
        // Catch-all — surface the real error instead of crashing
        return res.status(200).json({
            error: 'Function error: ' + e.message,
            stack: (e.stack || '').split('\n').slice(0, 3),
        });
    }
};
