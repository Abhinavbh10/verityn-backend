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
    var body = escapeHtml(s.body || '');
    var url = s.sourceUrl || 'https://verityn.news';
    var image = s.image || '';

    // Quick hit — compact for stories 6-7
    if (size === 'small') {
        return '<tr><td style="padding-bottom:6px">'
            + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
            + '<td style="width:24px;vertical-align:top;padding-top:2px"><span style="display:inline-block;width:22px;height:22px;background-color:#C0392B;border-radius:11px;text-align:center;line-height:22px;font-size:11px;font-weight:900;color:#FFFFFF">' + num + '</span></td>'
            + '<td style="padding-left:10px;vertical-align:top">'
            + '<a href="' + url + '" style="font-family:Georgia,serif;font-size:14px;font-weight:700;line-height:1.3;color:#111111;text-decoration:none">' + headline + '</a>'
            + '<div style="font-size:11px;color:#AAAAAA;margin-top:2px">' + source + '</div>'
            + '</td></tr></table></td></tr>';
    }

    var headlineSize = size === 'large' ? '20px' : '16px';
    var whySize = size === 'large' ? '14px' : '13px';
    var bodySize = size === 'large' ? '14px' : '13px';
    var cardBg = size === 'large' ? '#FAF8F4' : '#FAFAFA';
    var cardBorder = size === 'large' ? '2px solid rgba(192,57,43,0.15)' : '1px solid rgba(0,0,0,0.05)';

    // Image block (if available)
    var imgHtml = '';
    if (image && size === 'large') {
        imgHtml = '<tr><td style="padding-bottom:12px"><img src="' + image + '" alt="" style="width:100%;border-radius:10px;display:block;max-height:200px;object-fit:cover" /></td></tr>';
    } else if (image && size === 'medium') {
        imgHtml = '<tr><td style="padding-bottom:10px"><img src="' + image + '" alt="" style="width:100%;border-radius:8px;display:block;max-height:160px;object-fit:cover" /></td></tr>';
    }

    // Body block (multi-source synthesis)
    var bodyHtml = '';
    if (body) {
        bodyHtml = '<tr><td style="font-size:' + bodySize + ';color:#444444;line-height:1.6;padding-bottom:10px">' + body + '</td></tr>';
    }

    // Forward CTA only on lead story
    var forwardHtml = '';
    if (i === 0) {
        forwardHtml = '<td style="padding-left:12px;font-size:11px;color:#C0392B;font-weight:600"><a href="mailto:?subject=You%20should%20read%20this&body=Check%20out%20Verityn%20-%20verityn.news" style="color:#C0392B;text-decoration:underline">Forward this</a></td>';
    }

    return '<tr><td style="padding-bottom:12px">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:' + cardBg + ';border-radius:12px;border:' + cardBorder + '"><tr><td style="padding:18px">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        // Badge + source
        + '<tr><td style="padding-bottom:10px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="width:24px;height:24px;background-color:#C0392B;border-radius:12px;text-align:center;vertical-align:middle;font-size:12px;font-weight:900;color:#FFFFFF">' + num + '</td>'
        + '<td style="padding-left:8px;font-size:11px;font-weight:600;color:#AAAAAA;letter-spacing:0.3px">' + source + '</td>'
        + '</tr></table></td></tr>'
        // Image
        + imgHtml
        // Headline
        + '<tr><td style="font-family:Georgia,serif;font-size:' + headlineSize + ';font-weight:700;line-height:1.25;color:#111111;padding-bottom:10px">' + headline + '</td></tr>'
        // Body
        + bodyHtml
        // Why-line
        + '<tr><td style="padding-bottom:12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:rgba(192,57,43,0.05);border-left:3px solid #C0392B;border-radius:0 8px 8px 0"><tr>'
        + '<td style="padding:12px 14px"><span style="display:block;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#C0392B;margin-bottom:4px">Why this matters</span><span style="font-size:' + whySize + ';color:#5C3A1E;line-height:1.5">' + why + '</span></td>'
        + '</tr></table></td></tr>'
        // Read + Forward
        + '<tr><td><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="background-color:#111111;border-radius:14px;padding:6px 16px"><a href="' + url + '" style="font-size:12px;font-weight:700;color:#FFFFFF;text-decoration:none">Read &#8250;</a></td>'
        + forwardHtml
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
    var name = cleanName(recipientName);
    var today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    var hour = new Date().getUTCHours() + 2;
    var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    var unsubLink = 'https://verityn.news/unsubscribe?email=' + encodeURIComponent(email || '');

    var ext = extras || {};
    var weather = ext.weather || { line1: '', details: '' };
    var didYouKnow = ext.did_you_know || '';
    var watching = ext.watching || '';

    // Story cards with visual hierarchy
    var storyCards = '';
    for (var i2 = 0; i2 < stories.length; i2++) {
        if (i2 === 5 && stories.length > 5) {
            storyCards += '<tr><td style="padding:12px 0 8px">'
                + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
                + '<td style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#C0392B;padding-right:12px;white-space:nowrap">Quick hits</td>'
                + '<td style="border-bottom:1px solid rgba(0,0,0,0.08);width:100%"></td>'
                + '</tr></table></td></tr>';
        }
        var sz = i2 === 0 ? 'large' : (i2 >= 5 ? 'small' : 'medium');
        storyCards += buildStoryCard(stories[i2], i2, sz);
    }

    // Did you know — fun city fact
    var numberHtml = '';
    if (didYouKnow) {
        numberHtml = '<tr><td style="padding:6px 0 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#111111;border-radius:12px"><tr>'
            + '<td style="padding:18px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
            + '<tr><td style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#C0392B;padding-bottom:8px">&#128161; Did you know?</td></tr>'
            + '<tr><td style="font-family:Georgia,serif;font-size:15px;color:rgba(245,240,232,0.85);line-height:1.55">' + escapeHtml(didYouKnow) + '</td></tr>'
            + '</table></td></tr></table></td></tr>';
    }

    // Watching this week
    var watchHtml = '';
    if (watching) {
        watchHtml = '<tr><td style="padding:0 0 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:rgba(192,57,43,0.05);border-radius:10px"><tr>'
            + '<td style="padding:14px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
            + '<tr><td style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#C0392B;padding-bottom:5px">&#128065; What we\'re watching</td></tr>'
            + '<tr><td style="font-size:13px;color:#444444;line-height:1.55">' + escapeHtml(watching) + '</td></tr>'
            + '</table></td></tr></table></td></tr>';
    }

    // Feedback poll
    var feedbackBase = 'https://verityn-backend-ten.vercel.app/api/newsletter?action=feedback&email=' + encodeURIComponent(email || '') + '&rating=';
    var feedbackHtml = '<tr><td style="padding:8px 0 16px;text-align:center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + '<tr><td style="font-size:12px;color:#999999;padding-bottom:10px;text-align:center">How was today\'s briefing?</td></tr>'
        + '<tr><td style="text-align:center">'
        + '<a href="' + feedbackBase + 'good" style="text-decoration:none;padding:8px 16px;background:#F0F0F0;border-radius:16px;font-size:14px;margin:0 4px">&#128077; Loved it</a> &nbsp; '
        + '<a href="' + feedbackBase + 'ok" style="text-decoration:none;padding:8px 16px;background:#F0F0F0;border-radius:16px;font-size:14px;margin:0 4px">&#129335; Okay</a> &nbsp; '
        + '<a href="' + feedbackBase + 'bad" style="text-decoration:none;padding:8px 16px;background:#F0F0F0;border-radius:16px;font-size:14px;margin:0 4px">&#128078; Nah</a>'
        + '</td></tr></table></td></tr>';

    return '<!DOCTYPE html>'
        + '<html lang="en"><head>'
        + '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">'
        + '<meta name="x-apple-disable-message-reformatting">'
        + '<title>Verityn Daily Brief</title>'
        + '<style>body,table,td{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif}body{margin:0;padding:0;background-color:#F2EDE5}table{border-collapse:collapse}a{color:inherit}</style>'
        + '</head><body style="margin:0;padding:0;background-color:#F2EDE5">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F2EDE5">'
        + '<tr><td align="center" style="padding:24px 16px">'
        + '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">'

        // ── Header with red top bar ──
        + '<tr><td style="background-color:#C0392B;height:4px;border-radius:12px 12px 0 0;font-size:0"></td></tr>'
        + '<tr><td style="background-color:#FFFFFF;padding:20px 24px;border-bottom:1px solid rgba(0,0,0,0.06)"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="vertical-align:middle"><span style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#C0392B">V</span><span style="font-size:20px;font-weight:800;color:#111111">erityn</span></td>'
        + '<td style="text-align:right;vertical-align:middle"><span style="font-size:12px;color:#999999">' + today + '</span></td>'
        + '</tr></table></td></tr>'

        // ── Greeting + Weather ──
        + '<tr><td style="background-color:#FFFFFF;padding:20px 24px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + '<tr><td style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#111111;padding-bottom:6px">' + greeting + ', ' + escapeHtml(name) + '</td></tr>'
        + (weather.line1 ? '<tr><td style="font-size:15px;color:#444444;padding-bottom:4px">' + weather.line1 + '</td></tr>' : '')
        + (weather.details ? '<tr><td style="font-size:12px;color:#999999;padding-bottom:6px">' + weather.details + '</td></tr>' : '')
        + '<tr><td style="font-size:12px;color:#AAAAAA">We read 100+ articles this morning. You get 7.</td></tr>'
        + '</table></td></tr>'

        // ── Divider ──
        + '<tr><td style="background-color:#FFFFFF;padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-bottom:1px solid rgba(0,0,0,0.06)"></td></tr></table></td></tr>'

        // ── Stories section ──
        + '<tr><td style="background-color:#FFFFFF;padding:16px 24px 8px">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + storyCards
        + '</table></td></tr>'

        // ── Caught up ──
        + '<tr><td style="background-color:#FFFFFF;padding:10px 24px 16px;text-align:center">'
        + '<span style="font-family:Georgia,serif;font-size:15px;font-weight:700;color:#111111">You\'re caught up. &#9996;</span>'
        + '</td></tr>'

        // ── Bottom sections on cream ──
        + '<tr><td style="padding:16px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'

        // The Number
        + numberHtml

        // Watching
        + watchHtml

        // Feedback
        + feedbackHtml

        + '</table></td></tr>'

        // ── App promo ──
        + '<tr><td style="padding:0 0 14px;text-align:center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:rgba(0,0,0,0.03);border-radius:10px"><tr>'
        + '<td style="padding:14px 16px;text-align:center;font-size:12px;color:#999999">Want Deep Dive, AI Search, and Topics? <a href="https://verityn.news" style="color:#C0392B;font-weight:600;text-decoration:none">Get the app &#8250;</a></td>'
        + '</tr></table></td></tr>'

        // ── Footer ──
        + '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#111111;border-radius:0 0 12px 12px">'
        + '<tr><td style="padding:20px 24px;text-align:center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + '<tr><td style="text-align:center;padding-bottom:8px"><span style="font-family:Georgia,serif;font-size:14px;font-weight:700;color:#C0392B">V</span><span style="font-size:12px;font-weight:800;color:rgba(245,240,232,0.6)">erityn</span></td></tr>'
        + '<tr><td style="text-align:center;font-size:11px;color:rgba(245,240,232,0.3);line-height:2">'
        + '<a href="' + unsubLink + '" style="color:rgba(245,240,232,0.3);text-decoration:underline">Unsubscribe</a> &middot; '
        + '<a href="https://verityn.news" style="color:rgba(245,240,232,0.3);text-decoration:underline">verityn.news</a> &middot; '
        + '<a href="https://instagram.com/verityn.news" style="color:rgba(245,240,232,0.3);text-decoration:underline">Instagram</a></td></tr>'
        + '</table></td></tr></table></td></tr>'

        + '</table></td></tr></table></body></html>';
}

async function getWeather(region) {
    var coords = {
        eu: { lat: 52.52, lon: 13.41, city: 'Berlin' },
        us: { lat: 40.71, lon: -74.01, city: 'New York' },
        india: { lat: 28.61, lon: 77.23, city: 'Delhi' },
        asia: { lat: 35.68, lon: 139.69, city: 'Tokyo' },
        global: { lat: 51.51, lon: -0.13, city: 'London' },
    };
    var c = coords[region] || coords.global;
    try {
        var r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + c.lat + '&longitude=' + c.lon + '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=auto&forecast_days=1');
        var d = await r.json();
        var temp = Math.round(d.current.temperature_2m);
        var code = d.current.weather_code;
        var icon = code <= 1 ? '☀️' : code <= 3 ? '⛅' : code <= 48 ? '🌫️' : code <= 67 ? '🌧️' : code <= 77 ? '❄️' : '⛈️';
        var high = d.daily && d.daily.temperature_2m_max ? Math.round(d.daily.temperature_2m_max[0]) : null;
        var low = d.daily && d.daily.temperature_2m_min ? Math.round(d.daily.temperature_2m_min[0]) : null;
        var rain = d.daily && d.daily.precipitation_probability_max ? d.daily.precipitation_probability_max[0] : null;
        var sunrise = d.daily && d.daily.sunrise ? d.daily.sunrise[0].slice(11, 16) : null;
        var sunset = d.daily && d.daily.sunset ? d.daily.sunset[0].slice(11, 16) : null;

        var line1 = icon + ' ' + c.city + ' · ' + temp + '°C';
        var details = [];
        if (high !== null && low !== null) details.push('High ' + high + '° / Low ' + low + '°');
        if (rain !== null) details.push('Rain ' + rain + '%');
        if (sunrise && sunset) details.push('☀ ' + sunrise + ' – ' + sunset);

        return { line1: line1, details: details.join(' · ') };
    } catch (e) {
        return { line1: '', details: '' };
    }
}

function cleanName(raw) {
    if (!raw) return 'there';
    // If it looks like an email prefix, capitalize first letter
    var name = raw.trim();
    if (name.indexOf('@') > -1) name = name.split('@')[0];
    // Remove numbers at end
    name = name.replace(/[\d]+$/g, '');
    // Replace dots/underscores/hyphens with space
    name = name.replace(/[._-]/g, ' ');
    // Capitalize first letter of each word
    name = name.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    return name || 'there';
}

async function generateExtras(stories, region) {
    if (!stories || stories.length < 3) return { did_you_know: '', watching: '' };

    var headlines = stories.slice(0, 7).map(function(s, i) {
        return (i + 1) + '. ' + s.headline;
    }).join('\n');

    var regionCity = {
        eu: 'Berlin or Germany or Europe',
        us: 'New York or the United States',
        india: 'Delhi or Mumbai or India',
        asia: 'Asia',
        global: 'the world',
    };
    var city = regionCity[region] || regionCity.global;

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
                    content: 'Generate 2 things as JSON for a morning newsletter for readers in ' + city + ':\n\n1. "did_you_know": A fun, surprising, non-news fact about ' + city + '. Not from today\'s news. A cultural, historical, geographic, or quirky city/country fact. Format: "NUMBER — explanation." Examples: "42 — the number of lakes you can swim in within Berlin city limits." "1,247 — the number of bridges in Hamburg, more than Venice and Amsterdam combined." "23 — the official languages in India, not counting the 100+ unofficial ones." Make it the kind of thing people screenshot and send to friends. Avoid anything that sounds like a textbook. Pick something weird, delightful, or mildly absurd.\n\n2. "watching": One sentence about an ongoing story or scheduled event to watch this week. Based on these headlines:\n' + headlines + '\nDon\'t predict. Just say what\'s developing. E.g. "The ECB rate debate continues this week as inflation data drops Thursday."\n\nRespond with ONLY a JSON object with keys "did_you_know" and "watching". No markdown, no backticks.',
                }],
            }),
        });
        var data = await r.json();
        var text = (data.content && data.content[0] && data.content[0].text) || '';
        var clean = text.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);
    } catch (e) {
        return { did_you_know: '', watching: '' };
    }
}

async function translateArticles(articles) {
    if (!articles || !articles.length) return [];

    var toTranslate = articles.slice(0, 12).map(function(a, i) {
        return (i + 1) + '. HEADLINE: ' + (a.headline || '') + '\n   SUMMARY: ' + (a.summary || '').slice(0, 150);
    }).join('\n\n');

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
                max_tokens: 1500,
                messages: [{
                    role: 'user',
                    content: 'Translate these German news headlines and summaries to English. Keep translations natural and news-style, not word-for-word. If a headline or summary is already in English, keep it as-is.\n\n' + toTranslate + '\n\nRespond with ONLY a JSON array of objects, each with "headline" and "summary" keys. Same order as input. No markdown, no backticks.',
                }],
            }),
        });
        var data = await r.json();
        var text = (data.content && data.content[0] && data.content[0].text) || '';
        var clean = text.replace(/```json|```/g, '').trim();
        var translated = JSON.parse(clean);

        if (Array.isArray(translated) && translated.length === Math.min(articles.length, 12)) {
            return articles.slice(0, 12).map(function(a, i) {
                return Object.assign({}, a, {
                    headline: translated[i].headline || a.headline,
                    summary: translated[i].summary || a.summary,
                    translated: true,
                });
            });
        }
    } catch (e) { }

    return [];
}

async function generateFreshBriefing(supabase, region) {
    var regionCountries = {
        eu: ['gb', 'de'],
        us: ['us', 'gb'],
        india: ['in', 'gb'],
        asia: ['in', 'us'],
        global: ['us', 'gb', 'de', 'in'],
    };

    // Regions that have local-language feeds to translate
    var localFeedRegions = {
        eu: 'de_local',
    };

    var countries = regionCountries[region] || regionCountries.global;
    var BASE = 'https://verityn-backend-ten.vercel.app';
    var sid = 'newsletter-' + Date.now();

    // Step 1: Fetch English articles from GNews + RSS
    var allArticles = [];
    for (var c = 0; c < countries.length; c++) {
        var country = countries[c];
        try {
            var r1 = await fetch(BASE + '/api/content?action=news&country=' + country + '&max=15&sessionId=' + sid);
            var d1 = await r1.json();
            if (d1.articles && Array.isArray(d1.articles)) {
                allArticles = allArticles.concat(d1.articles);
            }
        } catch (e) { }
        try {
            var r2 = await fetch(BASE + '/api/content?action=rss&country=' + country + '&max=15&sessionId=' + sid);
            var d2 = await r2.json();
            if (d2.articles && Array.isArray(d2.articles)) {
                allArticles = allArticles.concat(d2.articles);
            }
        } catch (e) { }
    }

    // Step 2: Fetch and translate local-language articles
    var localKey = localFeedRegions[region];
    if (localKey) {
        try {
            var r3 = await fetch(BASE + '/api/content?action=rss&country=' + localKey + '&max=12&sessionId=' + sid);
            var d3 = await r3.json();
            if (d3.articles && Array.isArray(d3.articles) && d3.articles.length > 0) {
                var translated = await translateArticles(d3.articles);
                if (translated.length > 0) {
                    // Mark as local German news
                    translated = translated.map(function(a) {
                        return Object.assign({}, a, { country: 'DE', isLocal: true });
                    });
                    allArticles = allArticles.concat(translated);
                }
            }
        } catch (e) { }
    }

    if (allArticles.length < 3) return null;

    // Step 3: Pass combined pool to briefing
    try {
        var r4 = await fetch(BASE + '/api/briefing', {
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
        var d4 = await r4.json();
        if (d4.stories && d4.stories.length >= 3) {
            return d4.stories;
        }
    } catch (e) { }

    return null;
}

async function enrichStories(stories, region) {
    if (!stories || !stories.length) return stories;

    var regionContext = {
        eu: 'a working professional in Berlin, Germany',
        us: 'a working professional in New York, United States',
        india: 'a working professional in Mumbai, India',
        global: 'a working professional',
        asia: 'a working professional in Asia',
    };

    var context = regionContext[region] || regionContext.global;

    var storyData = stories.map(function(s, i) {
        return (i + 1) + '. HEADLINE: ' + s.headline
            + '\n   SOURCE: ' + (s.source || 'Unknown')
            + '\n   SUMMARY: ' + (s.summary || s.description || 'No summary available')
            + '\n   IMAGE: ' + (s.image || 'none');
    }).join('\n\n');

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
                max_tokens: 2500,
                messages: [{
                    role: 'user',
                    content: 'You write for Verityn, a morning news email for ' + context + '. For each story below, write two things:\n\n'
                        + '1. "body": A 2-3 sentence news paragraph that synthesizes the story. Cite the source name naturally inline, e.g. "According to Reuters..." or "...the Guardian reports." If possible, mention a second angle or source. Be factual and specific. Use numbers, names, dates.\n\n'
                        + '2. "why": A 1-2 sentence why-line explaining why this specific story affects the reader personally. The reader is ' + context + '.\n\n'
                        + 'WHY-LINE RULES (critical):\n'
                        + '- Sound like a sharp friend telling you something over coffee, not a textbook\n'
                        + '- Say "your" — make it about THEIR life: their rent, their commute, their salary, their grocery bill, their kids school, their taxes\n'
                        + '- Be specific: use timeframes ("by July"), amounts ("8-12%"), actions ("check your fixed rate options")\n'
                        + '- NEVER use: "could potentially", "may impact", "highlights the importance of", "underscores", "it remains to be seen", "this is significant because"\n'
                        + '- NEVER write generic lines like "Your understanding of X benefits from Y" or "This development affects the broader landscape"\n'
                        + '- WRONG: "This policy may affect European housing markets and consumer pricing"\n'
                        + '- RIGHT: "That rate hold hits your mortgage in about 6 weeks. If you are on variable, this is your window to lock in fixed before July."\n'
                        + '- WRONG: "Your awareness of democratic developments in Palestinian territories benefits from understanding local governance"\n'
                        + '- RIGHT: "Peace talks just got more complicated. If they stall, expect oil prices to creep up again, which you will feel at the pump by August."\n\n'
                        + 'Stories:\n' + storyData + '\n\n'
                        + 'Respond with ONLY a JSON array of objects, each with "body" and "why" keys. Same order as input. No markdown, no backticks.',
                }],
            }),
        });
        var data = await r.json();
        var text = (data.content && data.content[0] && data.content[0].text) || '';
        var clean = text.replace(/```json|```/g, '').trim();
        var enriched = JSON.parse(clean);

        if (Array.isArray(enriched) && enriched.length === stories.length) {
            return stories.map(function(s, i) {
                return Object.assign({}, s, {
                    body: enriched[i].body || '',
                    why: enriched[i].why || s.why || '',
                });
            });
        }
    } catch (e) { }
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
            var extras = await generateExtras(stories, 'eu');
            extras.weather = await getWeather('eu');
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

            var opener2 = await generateExtras(stories2, 'eu');
            opener2.weather = await getWeather('eu');
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
                    regionalStories[rgn] = await enrichStories(stories, rgn);
                } else {
                    regionalStories[rgn] = stories;
                }
            }

            if (!firstStories) return res.json({ error: 'No briefing available' });

            // Cache today's global version for reference
            try { await supabase.from('newsletter_cache').insert({ stories: firstStories }); } catch (e) { }

            // Generate extras (fun fact, watching) + weather per region
            var regionalExtras = {};
            for (var oi = 0; oi < regions.length; oi++) {
                var oRgn = regions[oi];
                if (regionalStories[oRgn]) {
                    regionalExtras[oRgn] = await generateExtras(regionalStories[oRgn], oRgn);
                    regionalExtras[oRgn].weather = await getWeather(oRgn);
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
