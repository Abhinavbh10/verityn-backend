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

function cleanSource(raw) {
    if (!raw) return 'NEWS';
    var s = raw.toUpperCase().replace(/^(WWW\.|FEEDS\.|RSS\.|NEWS\.)/, '').replace(/\.(COM|ORG|NET|CO\.UK|CO|IO)$/i, '');
    var map = {
        'NYTIMES': 'NEW YORK TIMES',
        'NYT': 'NEW YORK TIMES',
        'RSS.NYTIMES': 'NEW YORK TIMES',
        'FEEDS.NPR': 'NPR',
        'NPR': 'NPR',
        'WASHINGTONPOST': 'WASHINGTON POST',
        'BBC': 'BBC',
        'THEGUARDIAN': 'THE GUARDIAN',
        'GUARDIAN': 'THE GUARDIAN',
        'REUTERS': 'REUTERS',
        'ALJAZEERA': 'AL JAZEERA',
        'BLOOMBERG': 'BLOOMBERG',
        'CNBC': 'CNBC',
        'CNN': 'CNN',
        'DW': 'DEUTSCHE WELLE',
        'FT': 'FINANCIAL TIMES',
        'POLITICO': 'POLITICO',
        'EURONEWS': 'EURONEWS',
        'ECONOMICTIMES': 'ECONOMIC TIMES',
        'INDIATIMES': 'ECONOMIC TIMES',
        'HINDUSTANTIMES': 'HINDUSTAN TIMES',
        'NDTV': 'NDTV',
        'LIVEMINT': 'LIVEMINT',
        'THEHILL': 'THE HILL',
        'AXIOS': 'AXIOS',
        'APNEWS': 'AP NEWS',
        'AP': 'AP NEWS',
        'TECHCRUNCH': 'TECHCRUNCH',
        'THEVERGE': 'THE VERGE',
        'ARSTECHNICA': 'ARS TECHNICA',
        'WIRED': 'WIRED',
        'FOXNEWS': 'FOX NEWS',
        'SKYNEWS': 'SKY NEWS',
        'ABC': 'ABC NEWS',
        'CBS': 'CBS NEWS',
        'NBC': 'NBC NEWS',
        'SPIEGEL': 'DER SPIEGEL',
        'ZEIT': 'DIE ZEIT',
        'LEMONDE': 'LE MONDE',
        'SCMP': 'SOUTH CHINA MORNING POST',
        'JAPANTIMES': 'JAPAN TIMES',
        'STRAITS TIMES': 'STRAITS TIMES',
    };
    var clean = s.replace(/\.(COM|ORG|NET|CO\.UK|CO|IO)$/i, '');
    return map[clean] || map[s] || s.replace(/[-_]/g, ' ');
}

function buildStoryCard(s, i, size) {
    var num = i + 1;
    var source = cleanSource(s.source);
    var headline = escapeHtml(s.headline);
    var why = escapeHtml(s.why || '');
    var url = s.sourceUrl || 'https://verityn.news';

    // Quick hit — compact one-liner for stories 6-7
    if (size === 'small') {
        return '<tr><td style="padding-bottom:6px">'
            + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;border-radius:10px"><tr><td style="padding:12px 16px">'
            + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
            + '<td style="width:20px;vertical-align:top"><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
            + '<td style="width:20px;height:20px;background-color:#C0392B;border-radius:10px;text-align:center;vertical-align:middle;font-size:11px;font-weight:900;color:#FFFFFF">' + num + '</td>'
            + '</tr></table></td>'
            + '<td style="padding-left:10px;vertical-align:top">'
            + '<a href="' + url + '" style="font-family:Georgia,serif;font-size:14px;font-weight:700;line-height:1.3;color:#111111;text-decoration:none">' + headline + '</a>'
            + '<div style="font-size:11px;color:#999999;margin-top:2px">' + source + '</div>'
            + '</td></tr></table></td></tr></table></td></tr>';
    }

    // Lead story — bigger for story 1
    var headlineSize = size === 'large' ? '20px' : '16px';
    var whySize = size === 'large' ? '14px' : '13px';
    var padding = size === 'large' ? '20px' : '16px';

    return '<tr><td style="padding-bottom:10px">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;border-radius:12px"><tr><td style="padding:' + padding + '">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + '<tr><td style="padding-bottom:8px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="width:20px;height:20px;background-color:#C0392B;border-radius:10px;text-align:center;vertical-align:middle;font-size:11px;font-weight:900;color:#FFFFFF">' + num + '</td>'
        + '<td style="padding-left:8px;font-size:11px;font-weight:600;color:#999999">' + source + '</td>'
        + '</tr></table></td></tr>'
        + '<tr><td style="font-family:Georgia,serif;font-size:' + headlineSize + ';font-weight:700;line-height:1.25;color:#111111;padding-bottom:8px">' + headline + '</td></tr>'
        + '<tr><td style="padding-bottom:10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBF4F3;border-radius:8px"><tr>'
        + '<td style="padding:10px 12px;font-size:' + whySize + ';color:#5C3A1E;line-height:1.45">' + why + '</td>'
        + '</tr></table></td></tr>'
        + '<tr><td><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="background-color:#111111;border-radius:14px;padding:5px 14px"><a href="' + url + '" style="font-size:12px;font-weight:700;color:#FFFFFF;text-decoration:none">Read &#8250;</a></td>'
        + (i === 0 ? '<td style="padding-left:10px;font-size:11px;color:#C0392B;font-weight:600">Know someone who\'d care? Forward this &#8250;</td>' : '')
        + '</tr></table></td></tr>'
        + '</table></td></tr></table></td></tr>';
}

function buildSubjectLine(stories) {
    if (!stories || !stories.length) return 'Your 7 stories are ready';

    // Extract short hooks from top 3 why-lines
    var hooks = [];
    for (var i = 0; i < Math.min(3, stories.length); i++) {
        var why = (stories[i].why || stories[i].headline || '').replace(/\s+/g, ' ').trim();
        // Take first sentence or first clause
        var hook = why.split(/\.\s/)[0].split(/,\s/)[0];
        // Keep it short
        if (hook.length > 35) hook = hook.substring(0, 32) + '...';
        if (hook.length > 5) hooks.push(hook);
    }

    if (hooks.length >= 2) {
        return hooks.slice(0, 3).join(', ');
    }

    // Fallback to headline
    var hl = (stories[0].headline || '').replace(/\s+/g, ' ').trim();
    if (hl.length > 55) hl = hl.substring(0, 52) + '...';
    return hl;
}

function buildEmailHTML(stories, recipientName, email, extras) {
    var name = recipientName || 'there';
    var today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    var hour = new Date().getUTCHours() + 2; // rough CET
    var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    var unsubLink = 'https://verityn.news/unsubscribe?email=' + encodeURIComponent(email || '');

    var ext = extras || {};
    var opener = ext.opener || '';
    var theNumber = ext.the_number || '';
    var watchingTomorrow = ext.watching_tomorrow || '';

    // Opener block
    var openerHtml = '';
    if (opener) {
        openerHtml = '<tr><td style="padding:0 0 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
            + '<tr><td style="font-size:14px;color:#444444;line-height:1.65;font-style:italic;border-left:3px solid #C0392B;padding-left:14px">' + escapeHtml(opener) + '</td></tr>'
            + '</table></td></tr>';
    }

    // Story cards with visual hierarchy
    var storyCards = '';
    for (var i = 0; i < stories.length; i++) {
        var size = i === 0 ? 'large' : (i >= 5 ? 'small' : 'medium');
        storyCards += buildStoryCard(stories[i], i, size);
    }

    // Quick hits separator before compact stories
    if (stories.length > 5) {
        var quickHitSep = '<tr><td style="padding:6px 0 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
            + '<tr><td style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#C0392B">Also today</td></tr>'
            + '</table></td></tr>';
        // Insert separator before story 6
        var cards = storyCards.split('</td></tr>');
        // We need to count cards properly — just add separator text before building
    }

    // Build cards manually with separator
    storyCards = '';
    for (var i2 = 0; i2 < stories.length; i2++) {
        if (i2 === 5 && stories.length > 5) {
            storyCards += '<tr><td style="padding:8px 0 10px">'
                + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
                + '<td style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#C0392B">Quick hits</td>'
                + '<td style="border-bottom:1px solid rgba(0,0,0,0.06);width:100%"></td>'
                + '</tr></table></td></tr>';
        }
        var sz = i2 === 0 ? 'large' : (i2 >= 5 ? 'small' : 'medium');
        storyCards += buildStoryCard(stories[i2], i2, sz);
    }

    // The Number section
    var numberHtml = '';
    if (theNumber) {
        numberHtml = '<tr><td style="padding:4px 0 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#111111;border-radius:12px"><tr>'
            + '<td style="padding:16px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
            + '<td style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#C0392B;padding-bottom:6px">The number</td></tr>'
            + '<tr><td style="font-family:Georgia,serif;font-size:14px;color:rgba(245,240,232,0.8);line-height:1.5">' + escapeHtml(theNumber) + '</td></tr>'
            + '</table></td></tr></table></td></tr>';
    }

    // Watching tomorrow
    var watchHtml = '';
    if (watchingTomorrow) {
        watchHtml = '<tr><td style="padding:0 0 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:rgba(192,57,43,0.05);border-radius:10px"><tr>'
            + '<td style="padding:14px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
            + '<td style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#C0392B;padding-bottom:4px">Watching tomorrow</td></tr>'
            + '<tr><td style="font-size:13px;color:#444444;line-height:1.5">' + escapeHtml(watchingTomorrow) + '</td></tr>'
            + '</table></td></tr></table></td></tr>';
    }

    // Feedback poll
    var feedbackBase = 'https://verityn-backend-ten.vercel.app/api/newsletter?action=feedback&email=' + encodeURIComponent(email || '') + '&rating=';
    var feedbackHtml = '<tr><td style="padding:4px 0 16px;text-align:center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + '<tr><td style="font-size:12px;color:#999999;padding-bottom:10px;text-align:center">How was today\'s briefing?</td></tr>'
        + '<tr><td style="text-align:center">'
        + '<a href="' + feedbackBase + 'good" style="text-decoration:none;font-size:20px;padding:0 12px">&#128077;</a>'
        + '<a href="' + feedbackBase + 'ok" style="text-decoration:none;font-size:20px;padding:0 12px">&#129335;</a>'
        + '<a href="' + feedbackBase + 'bad" style="text-decoration:none;font-size:20px;padding:0 12px">&#128078;</a>'
        + '</td></tr></table></td></tr>';

    // Sources count
    var sourceCount = stories.length >= 7 ? '100+' : '50+';

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
        // Greeting + source count
        + '<tr><td style="padding:0 0 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + '<tr><td style="font-family:Georgia,serif;font-size:16px;font-weight:700;color:#111111;padding-bottom:2px">' + greeting + ', ' + escapeHtml(name) + '</td></tr>'
        + '<tr><td style="font-size:12px;color:#999999">We read ' + sourceCount + ' articles this morning. You get 7.</td></tr>'
        + '</table></td></tr>'
        // Opener
        + openerHtml
        // Stories
        + storyCards
        // The Number
        + numberHtml
        // Caught up
        + '<tr><td style="text-align:center;padding:8px 0 14px">'
        + '<span style="font-family:Georgia,serif;font-size:14px;font-weight:700;color:#111111">You\'re caught up.</span>'
        + '</td></tr>'
        // Watching tomorrow
        + watchHtml
        // Feedback
        + feedbackHtml
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

async function generateOpener(stories) {
    if (!stories || stories.length < 3) return { opener: '', theNumber: '', watchingTomorrow: '' };

    var headlines = stories.slice(0, 7).map(function(s, i) {
        return (i + 1) + '. ' + s.headline + (s.why ? ' — ' + s.why : '');
    }).join('\n');

    try {
        var r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 300,
                messages: [{
                    role: 'user',
                    content: 'You write for Verityn, a 7-story morning news briefing. Based on today\'s stories, generate 3 things as JSON:\n\n1. "opener": Exactly 2 sentences that tease today\'s edition. Be direct, confident, slightly conversational. Not promotional. No emojis. No "let\'s dive in." Think sharp editor.\n\n2. "the_number": One striking number from today\'s stories with a one-line explanation. Format: "€2.6M — the amount Berlin\'s culture senator illegally distributed." Pick the most memorable stat.\n\n3. "watching_tomorrow": One sentence about what to watch for tomorrow based on what\'s developing. E.g. "Tomorrow: The Fed meets. We\'ll tell you what it means for your savings."\n\nToday\'s stories:\n' + headlines + '\n\nRespond with ONLY a JSON object with keys "opener", "the_number", "watching_tomorrow". No markdown, no backticks.',
                }],
            }),
        });
        var data = await r.json();
        var text = (data.content && data.content[0] && data.content[0].text) || '';
        var clean = text.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);
    } catch (e) {
        return { opener: '', the_number: '', watching_tomorrow: '' };
    }
}

async function generateFreshBriefing(supabase, region) {
    var regionCountries = {
        eu: ['gb', 'de'],
        us: ['us', 'gb'],
        india: ['in', 'gb'],
        asia: ['in', 'us'],
        global: ['us', 'gb', 'de', 'in'],
    };

    var countries = regionCountries[region] || regionCountries.global;
    var BASE = 'https://verityn-backend-ten.vercel.app';
    var sid = 'newsletter-' + Date.now();

    // Step 1: Fetch articles from BOTH news (GNews) AND rss (local feeds)
    var allArticles = [];
    for (var c = 0; c < countries.length; c++) {
        var country = countries[c];
        // GNews
        try {
            var r1 = await fetch(BASE + '/api/content?action=news&country=' + country + '&max=10&sessionId=' + sid);
            var d1 = await r1.json();
            if (d1.articles && Array.isArray(d1.articles)) {
                allArticles = allArticles.concat(d1.articles);
            }
        } catch (e) { }
        // RSS local feeds
        try {
            var r2 = await fetch(BASE + '/api/content?action=rss&country=' + country + '&max=10&sessionId=' + sid);
            var d2 = await r2.json();
            if (d2.articles && Array.isArray(d2.articles)) {
                allArticles = allArticles.concat(d2.articles);
            }
        } catch (e) { }
    }

    if (allArticles.length < 3) return null;

    // Step 2: Pass combined articles to briefing for curation + why-lines
    try {
        var r3 = await fetch(BASE + '/api/briefing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                articles: allArticles,
                countries: countries,
                interests: ['world', 'finance', 'tech', 'politics'],
                location: region === 'india' ? 'in' : region === 'us' ? 'us' : 'de',
                profession: 'professional',
                sessionId: 'newsletter-' + region + '-' + new Date().toISOString().slice(0, 10),
            }),
        });
        var d3 = await r3.json();
        if (d3.stories && d3.stories.length >= 3) {
            return d3.stories;
        }
    } catch (e) { }

    return null;
}

async function getRegionalWhyLines(stories, region) {
    if (!stories || !stories.length) return stories;
    if (region === 'global') return stories;

    var regionContext = {
        eu: 'a professional living in Europe (Germany/EU)',
        us: 'a professional living in the United States',
        india: 'a professional living in India',
    };

    var regionDetails = {
        eu: 'Reference ECB policy, euro, EU regulations, housing markets, job markets, Schengen where relevant.',
        us: 'Reference Fed policy, US dollar, 401k, healthcare costs, housing, job markets where relevant.',
        india: 'Reference RBI policy, rupee, EMIs, stock markets, IT sector, startup ecosystem where relevant.',
    };

    var context = regionContext[region];
    var details = regionDetails[region];
    if (!context) return stories;

    var headlines = stories.map(function(s, i) {
        return (i + 1) + '. ' + s.headline;
    }).join('\n');

    try {
        var r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1200,
                messages: [{
                    role: 'user',
                    content: 'You write why-lines for Verityn, a daily news briefing. A why-line is 1-2 sentences that tell the reader why a news story matters to THEM personally.\n\nWrite for ' + context + '. ' + details + '\n\nTone rules:\n- Sound like a sharp colleague explaining news over coffee, not a textbook\n- Be specific: use numbers, timeframes, concrete actions when possible\n- Say "your" not "the reader\'s"\n- Avoid hedging words: "could", "might", "may potentially"\n- Lead with the impact, not the event\n- No emojis, no exclamation marks\n- Wrong: "This policy may affect European housing markets"\n- Right: "That rate hold hits your mortgage in about 6 weeks. If you\'re on variable, this is your window to lock in fixed before July."\n\nHeadlines:\n' + headlines + '\n\nRespond with ONLY a JSON array of strings, one why-line per headline, in the same order. No markdown, no backticks, just the JSON array.',
                }],
            }),
        });
        var data = await r.json();
        var text = (data.content && data.content[0] && data.content[0].text) || '';
        var clean = text.replace(/```json|```/g, '').trim();
        var whyLines = JSON.parse(clean);

        if (Array.isArray(whyLines) && whyLines.length === stories.length) {
            return stories.map(function(s, i) {
                return Object.assign({}, s, { why: whyLines[i] });
            });
        }
    } catch (e) {
        // Fall back to original why-lines
    }
    return stories;
}

async function getSubscribers(supabase) {
    var result = await supabase
        .from('waitlist')
        .select('email, name, region')
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
            var timezone = body.timezone || '';
            var region = body.region || 'global';

            // Check if already exists
            var existing = await supabase.from('waitlist').select('id, unsubscribed').eq('email', email).limit(1);
            if (existing.data && existing.data.length > 0) {
                if (existing.data[0].unsubscribed) {
                    await supabase.from('waitlist').update({ unsubscribed: false, name: name, timezone: timezone, region: region }).eq('email', email);
                    return res.json({ ok: true, resubscribed: true });
                }
                return res.json({ ok: true, already: true });
            }

            var { error } = await supabase.from('waitlist').insert({ email: email, name: name, unsubscribed: false, timezone: timezone, region: region });
            if (error) return res.status(500).json({ error: error.message });
            return res.json({ ok: true, subscribed: true });
        }

        // ── Feedback ──
        if (action === 'feedback') {
            var fbEmail = (req.query.email || '').trim();
            var rating = (req.query.rating || '').trim();
            if (fbEmail && rating) {
                try {
                    await supabase.from('newsletter_log').insert({
                        sent_count: 0, failed_count: 0,
                        subject: 'feedback:' + rating + ':' + fbEmail,
                        story_count: 0,
                    });
                } catch (e) { }
            }
            return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#FAF8F4"><h2>Thanks for the feedback!</h2><p style="color:#777;margin-top:8px">See you tomorrow morning.</p></body></html>');
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
            var stories = await generateFreshBriefing(supabase, 'global');
            if (!stories) return res.json({ error: 'No briefing available yet.' });
            var extras = await generateOpener(stories);
            res.setHeader('Content-Type', 'text/html');
            return res.send(buildEmailHTML(stories, 'Reader', 'preview@example.com', extras));
        }

        // ── Test ──
        if (action === 'test') {
            var testEmail = req.query.email;
            if (!testEmail) return res.json({ error: 'Add &email=your@email.com' });
            if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return res.json({ error: 'SMTP creds not set' });

            var stories2 = await generateFreshBriefing(supabase, 'global');
            if (!stories2) return res.json({ error: 'No briefing available yet.' });

            var opener2 = await generateOpener(stories2);
            var transporter = getTransporter();
            var subject = buildSubjectLine(stories2);
            try {
                var result = await transporter.sendMail({
                    from: FROM_NAME + ' <' + FROM_EMAIL + '>',
                    to: testEmail,
                    subject: subject,
                    html: buildEmailHTML(stories2, testEmail.split('@')[0], testEmail, opener2),
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

            var subscribers = await getSubscribers(supabase);
            if (!subscribers.length) return res.json({ ok: true, sent: 0, reason: 'No subscribers' });

            // Group subscribers by region
            var groups = {};
            for (var g = 0; g < subscribers.length; g++) {
                var reg = subscribers[g].region || 'global';
                if (!groups[reg]) groups[reg] = [];
                groups[reg].push(subscribers[g]);
            }

            // Generate fresh briefing per region (country-weighted + regional why-lines)
            var regions = Object.keys(groups);
            var regionalStories = {};
            var firstStories = null;

            for (var ri = 0; ri < regions.length; ri++) {
                var rgn = regions[ri];

                // Generate fresh briefing with region-weighted country sources
                var stories = await generateFreshBriefing(supabase, rgn);
                if (!stories) continue;

                if (!firstStories) firstStories = stories;

                // Apply regional why-lines for eu/us/india
                if (rgn !== 'global' && rgn !== 'asia') {
                    regionalStories[rgn] = await getRegionalWhyLines(stories, rgn);
                } else {
                    regionalStories[rgn] = stories;
                }
            }

            if (!firstStories) return res.json({ error: 'No briefing available' });

            // Cache today's global version for reference
            try { await supabase.from('newsletter_cache').insert({ stories: firstStories }); } catch (e) { }

            // Generate opener/number/watching per region
            var regionalExtras = {};
            for (var oi = 0; oi < regions.length; oi++) {
                var oRgn = regions[oi];
                if (regionalStories[oRgn]) {
                    regionalExtras[oRgn] = await generateOpener(regionalStories[oRgn]);
                }
            }

            var subject2 = buildSubjectLine(firstStories);
            var transporter2 = getTransporter();
            var sent = 0, failed = 0, errors = [];

            for (var ri2 = 0; ri2 < regions.length; ri2++) {
                var region = regions[ri2];
                var subs = groups[region];
                var regionStories = regionalStories[region];
                var regionExtras = regionalExtras[region] || {};
                if (!regionStories) continue;

                for (var i = 0; i < Math.min(subs.length, BATCH_SIZE); i++) {
                    var sub = subs[i];
                    try {
                        await transporter2.sendMail({
                            from: FROM_NAME + ' <' + FROM_EMAIL + '>',
                            to: sub.email,
                            subject: subject2,
                            html: buildEmailHTML(regionStories, sub.name || sub.email.split('@')[0], sub.email, regionExtras),
                        });
                        sent++;
                    } catch (e) {
                        failed++;
                        errors.push({ email: sub.email, error: e.message });
                    }
                    if (i > 0 && i % 5 === 0) await new Promise(function(r) { setTimeout(r, 2000); });
                }
            }

            try { transporter2.close(); } catch (e) { }
            try {
                await supabase.from('newsletter_log').insert({
                    sent_count: sent, failed_count: failed,
                    errors: errors.length > 0 ? errors : null,
                    subject: subject2, story_count: firstStories.length,
                });
            } catch (e) { }

            return res.json({ ok: true, sent: sent, failed: failed, total: subscribers.length, subject: subject2, regions: regions });
        }

        return res.json({ actions: 'subscribe, unsubscribe, preview, test, send' });
    } catch (e) {
        return res.json({ error: e.message });
    }
};
