// api/newsletter.js — Verityn daily brief newsletter
// Actions: subscribe | unsubscribe | preview | test | send | feedback
//
// CHANGES (2026-04-28, fourth pass):
// - Removed "Forward this" mailto link from story 1. The link opened a
//   generic email body with no story context, so it was clutter without
//   utility. Story 1 now shows just the Read button like the other cards.
//
// Earlier changes still in effect:
// - cleanSource strips country TLDs (.de .fr .eu .at .ch etc)
// - capPerSource caps each source at 3 in the pool
// - translateArticles cap raised to 12, de_local fetch raised to max=15
// - Translated articles front-loaded into allArticles
// - enrichStories prompt: every story has an angle, find it; banned give-up phrases
// - Logging at three checkpoints

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
    var s = raw.toUpperCase()
        .replace(/^(WWW\.|FEEDS\.|RSS\.|NEWS\.)/, '')
        .replace(/\.(COM|ORG|NET|CO\.UK|CO|IO|DE|FR|EU|UK|IN|AT|CH|JP|AU|SG|AE|ES|IT|NL)$/i, '');
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
        'ECONOMICTIMES.INDIATIMES': 'ECONOMIC TIMES',
        'INDIATIMES': 'ECONOMIC TIMES',
        'TIMESOFINDIA.INDIATIMES': 'TIMES OF INDIA',
        'TIMESOFINDIA': 'TIMES OF INDIA',
        'HINDUSTANTIMES': 'HINDUSTAN TIMES',
        'INDIANEXPRESS': 'INDIAN EXPRESS',
        'THEHINDU': 'THE HINDU',
        'BUSINESS-STANDARD': 'BUSINESS STANDARD',
        'BUSINESSSTANDARD': 'BUSINESS STANDARD',
        'FINANCIALEXPRESS': 'FINANCIAL EXPRESS',
        'MONEYCONTROL': 'MONEYCONTROL',
        'YOURSTORY': 'YOURSTORY',
        'ENTRACKR': 'ENTRACKR',
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
        'TAGESSCHAU': 'TAGESSCHAU',
        'TAGESSPIEGEL': 'TAGESSPIEGEL',
        'SUEDDEUTSCHE': 'SÜDDEUTSCHE ZEITUNG',
        'SZ': 'SÜDDEUTSCHE ZEITUNG',
        'FAZ': 'FAZ',
        'HANDELSBLATT': 'HANDELSBLATT',
        'BERLINER-ZEITUNG': 'BERLINER ZEITUNG',
        'BERLINERZEITUNG': 'BERLINER ZEITUNG',
    };
    return map[s] || s.replace(/[-_]/g, ' ');
}

function capPerSource(articles, capN) {
    if (!Array.isArray(articles)) return [];
    var counts = {};
    var kept = [];
    for (var i = 0; i < articles.length; i++) {
        var a = articles[i];
        var key = (a.source || 'unknown').toLowerCase()
            .replace(/^(www\.|feeds\.|rss\.|news\.)/, '')
            .replace(/\.(com|org|net|co\.uk|co|io|de|fr|eu|uk|in|at|ch|jp|au|sg|ae|es|it|nl)$/, '')
            .replace(/[-_\s]+/g, '')
            .trim();
        counts[key] = (counts[key] || 0) + 1;
        if (counts[key] <= capN) kept.push(a);
    }
    return kept;
}

function buildStoryCard(s, i, size) {
    var num = i + 1;
    var source = cleanSource(s.source);
    var headline = escapeHtml(s.headline);
    var why = escapeHtml(s.why || '');
    var body = escapeHtml(s.body || '');
    var url = s.sourceUrl || 'https://verityn.news';
    var image = s.image || '';

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

    var imgHtml = '';
    if (image && size === 'large') {
        imgHtml = '<tr><td style="padding-bottom:12px"><img src="' + image + '" alt="" style="width:100%;border-radius:10px;display:block;max-height:200px;object-fit:cover" /></td></tr>';
    } else if (image && size === 'medium') {
        imgHtml = '<tr><td style="padding-bottom:10px"><img src="' + image + '" alt="" style="width:100%;border-radius:8px;display:block;max-height:160px;object-fit:cover" /></td></tr>';
    }

    var bodyHtml = '';
    if (body) {
        bodyHtml = '<tr><td style="font-size:' + bodySize + ';color:#444444;line-height:1.6;padding-bottom:10px">' + body + '</td></tr>';
    }

    return '<tr><td style="padding-bottom:12px">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:' + cardBg + ';border-radius:12px;border:' + cardBorder + '"><tr><td style="padding:18px">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + '<tr><td style="padding-bottom:10px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="width:24px;height:24px;background-color:#C0392B;border-radius:12px;text-align:center;vertical-align:middle;font-size:12px;font-weight:900;color:#FFFFFF">' + num + '</td>'
        + '<td style="padding-left:8px;font-size:11px;font-weight:600;color:#AAAAAA;letter-spacing:0.3px">' + source + '</td>'
        + '</tr></table></td></tr>'
        + imgHtml
        + '<tr><td style="font-family:Georgia,serif;font-size:' + headlineSize + ';font-weight:700;line-height:1.25;color:#111111;padding-bottom:10px">' + headline + '</td></tr>'
        + bodyHtml
        + '<tr><td style="padding-bottom:12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:rgba(192,57,43,0.05);border-left:3px solid #C0392B;border-radius:0 8px 8px 0"><tr>'
        + '<td style="padding:12px 14px"><span style="display:block;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#C0392B;margin-bottom:4px">Why this matters</span><span style="font-size:' + whySize + ';color:#5C3A1E;line-height:1.5">' + why + '</span></td>'
        + '</tr></table></td></tr>'
        + '<tr><td><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="background-color:#111111;border-radius:14px;padding:6px 16px"><a href="' + url + '" style="font-size:12px;font-weight:700;color:#FFFFFF;text-decoration:none">Read &#8250;</a></td>'
        + '</tr></table></td></tr>'
        + '</table></td></tr></table></td></tr>';
}

function buildSubjectLine(stories) {
    // Subject line discipline (post-Germany pivot, May 2026): lead with ONE
    // specific headline of the day. Not three truncated ones. See SKILL.md
    // "Newsletter Operational Spec — Subject line examples" for target shape:
    //   "Krankenkasse hikes confirmed for January"
    //   "BVG strikes Tuesday — plan now"
    //   "Mietpreisbremse extended until 2029"
    if (!stories || !stories.length) return 'Your morning briefing from Verityn';

    var hl = (stories[0].headline || '').replace(/\s+/g, ' ').trim();

    // Drop common "Source: " prefixes that creep in from RSS titles
    hl = hl.replace(/^([A-Z][A-Za-z\s]+?\s*[:\-–]\s*)/, '');

    // If headline has a colon, prefer the more specific half. The half BEFORE
    // the colon is usually the topic ("Coalition agrees:") and the half AFTER
    // is usually the actual news ("pension increase 4.24 percent").
    if (hl.indexOf(':') !== -1) {
        var parts = hl.split(':');
        var afterColon = parts.slice(1).join(':').trim();
        if (afterColon.length > 15) hl = afterColon;
    }

    // Cap length, word-boundary truncation only (no mid-word ellipses).
    var MAX_LEN = 65;
    if (hl.length > MAX_LEN) {
        var trimmed = hl.substring(0, MAX_LEN);
        var lastSpace = trimmed.lastIndexOf(' ');
        if (lastSpace > 30) trimmed = trimmed.substring(0, lastSpace);
        hl = trimmed.replace(/[,;:\-–—\s]+$/, '') + '...';
    }

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

    var numberHtml = '';
    if (didYouKnow) {
        numberHtml = '<tr><td style="padding:6px 0 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#111111;border-radius:12px"><tr>'
            + '<td style="padding:18px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
            + '<tr><td style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#C0392B;padding-bottom:8px">&#128161; Did you know?</td></tr>'
            + '<tr><td style="font-family:Georgia,serif;font-size:15px;color:rgba(245,240,232,0.85);line-height:1.55">' + escapeHtml(didYouKnow) + '</td></tr>'
            + '</table></td></tr></table></td></tr>';
    }

    var watchHtml = '';
    if (watching) {
        watchHtml = '<tr><td style="padding:0 0 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:rgba(192,57,43,0.05);border-radius:10px"><tr>'
            + '<td style="padding:14px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
            + '<tr><td style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#C0392B;padding-bottom:5px">&#128065; What we\'re watching</td></tr>'
            + '<tr><td style="font-size:13px;color:#444444;line-height:1.55">' + escapeHtml(watching) + '</td></tr>'
            + '</table></td></tr></table></td></tr>';
    }

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
        + '<tr><td style="background-color:#C0392B;height:4px;border-radius:12px 12px 0 0;font-size:0"></td></tr>'
        + '<tr><td style="background-color:#FFFFFF;padding:20px 24px;border-bottom:1px solid rgba(0,0,0,0.06)"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="vertical-align:middle"><span style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#C0392B">V</span><span style="font-size:20px;font-weight:800;color:#111111">erityn</span></td>'
        + '<td style="text-align:right;vertical-align:middle"><span style="font-size:12px;color:#999999">' + today + '</span></td>'
        + '</tr></table></td></tr>'
        + '<tr><td style="background-color:#FFFFFF;padding:20px 24px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + '<tr><td style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#111111;padding-bottom:6px">' + greeting + ', ' + escapeHtml(name) + '</td></tr>'
        + (weather.line1 ? '<tr><td style="font-size:15px;color:#444444;padding-bottom:4px">' + weather.line1 + '</td></tr>' : '')
        + (weather.details ? '<tr><td style="font-size:12px;color:#999999;padding-bottom:6px">' + weather.details + '</td></tr>' : '')
        + '<tr><td style="font-size:12px;color:#AAAAAA">We read 100+ articles this morning. You get 7.</td></tr>'
        + '</table></td></tr>'
        + '<tr><td style="background-color:#FFFFFF;padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-bottom:1px solid rgba(0,0,0,0.06)"></td></tr></table></td></tr>'
        + '<tr><td style="background-color:#FFFFFF;padding:16px 24px 8px">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + storyCards
        + '</table></td></tr>'
        + '<tr><td style="background-color:#FFFFFF;padding:10px 24px 16px;text-align:center">'
        + '<span style="font-family:Georgia,serif;font-size:15px;font-weight:700;color:#111111">You\'re caught up. &#9996;</span>'
        + '</td></tr>'
        + '<tr><td style="padding:16px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + numberHtml
        + watchHtml
        + feedbackHtml
        + '</table></td></tr>'
        + '<tr><td style="padding:0 0 14px;text-align:center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:rgba(0,0,0,0.03);border-radius:10px"><tr>'
        + '<td style="padding:14px 16px;text-align:center;font-size:12px;color:#999999">Want Deep Dive, AI Search, and Topics? <a href="https://verityn.news" style="color:#C0392B;font-weight:600;text-decoration:none">Get the app &#8250;</a></td>'
        + '</tr></table></td></tr>'
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

async function getWeather() {
    // Germany-only post-pivot. Hardcoded to Berlin since the audience is
    // English speakers living in Germany. If we ever go regional inside DE
    // (Munich edition, Hamburg edition), revisit.
    var c = { lat: 52.52, lon: 13.41, city: 'Berlin' };
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
    var name = raw.trim();
    if (name.indexOf('@') > -1) name = name.split('@')[0];
    name = name.replace(/[\d]+$/g, '');
    name = name.replace(/[._-]/g, ' ');
    name = name.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    return name || 'there';
}

async function generateExtras(stories) {
    if (!stories || stories.length < 3) return { did_you_know: '', watching: '' };

    // Did You Know pulls from the curated 'eu' pool in _facts.js — Berlin and
    // Germany facts. Post-Germany pivot the 'eu' label is a legacy key inside
    // _facts.js; the content is Germany-focused regardless. Could be renamed
    // to 'de' in a later cleanup.
    var facts = require('./_facts.js');
    var didYouKnow = facts.getRandomFact('eu');

    // "What we're watching" is still Claude-generated since it's news-derived
    // and benefits from real-time context. Tightened the prompt to push for
    // forward-looking content (was recapping top stories).
    var headlines = stories.slice(0, 7).map(function(s, i) {
        return (i + 1) + '. ' + s.headline;
    }).join('\n');

    var watching = '';
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
                max_tokens: 150,
                messages: [{
                    role: 'user',
                    content: 'Below are 7 news headlines from this morning. Write ONE forward-looking sentence about something developing in the coming days or week. Do NOT recap any of these stories. Point at what to watch NEXT.\n\n'
                        + 'WRONG (recap): "Bengal voting Phase 2 continues this week with over 1,000 candidates."\n'
                        + 'WRONG (recap): "Italian rail company Italo is launching German operations with 26 trains."\n'
                        + 'RIGHT (forward-looking): "Watch the ECB on Thursday — inflation data lands Wednesday and a rate decision follows."\n'
                        + 'RIGHT (forward-looking): "Q1 earnings from BASF and Bayer drop this week. Both sit downstream of the Iran-driven chemical cost spike."\n'
                        + 'RIGHT (forward-looking): "The Bundestag debates the Gebäudemodernisierungsgesetz next Wednesday. Watch how the heating cost split lands."\n\n'
                        + 'Headlines:\n' + headlines + '\n\n'
                        + 'Respond with ONLY the one sentence. No JSON, no markdown, no preamble.',
                }],
            }),
        });
        var data = await r.json();
        var text = (data.content && data.content[0] && data.content[0].text) || '';
        watching = text.replace(/```/g, '').trim();
        // Strip any leading "What we're watching:" or quote marks the model might add
        watching = watching.replace(/^["'\s]*(what.*?watching\s*[:\-–—]?\s*)?["']?/i, '').replace(/["']\s*$/, '').trim();
    } catch (e) {
        watching = '';
    }

    return { did_you_know: didYouKnow, watching: watching };
}

var TRANSLATE_LIMIT = 12;

async function translateArticles(articles) {
    if (!articles || !articles.length) return [];

    var slice = articles.slice(0, TRANSLATE_LIMIT);
    var toTranslate = slice.map(function(a, i) {
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
                max_tokens: 2000,
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

        if (Array.isArray(translated) && translated.length === slice.length) {
            return slice.map(function(a, i) {
                return Object.assign({}, a, {
                    headline: translated[i].headline || a.headline,
                    summary: translated[i].summary || a.summary,
                    translated: true,
                });
            });
        }
    } catch (e) {
        console.log('[newsletter] translateArticles failed:', e.message);
    }

    return [];
}

async function generateFreshBriefing(supabase) {
    // Germany-only post-pivot (May 2026). Countries fetch English wires from
    // GB and DE; de_local fetches German-language feeds for translation.
    // Region branching removed — see SKILL.md "Newsletter Operational Spec".
    var countries = ['gb', 'de'];
    var BASE = 'https://verityn-backend-ten.vercel.app';
    var sid = 'newsletter-' + Date.now();

    var fetchPromises = [];
    for (var c = 0; c < countries.length; c++) {
        var country = countries[c];
        fetchPromises.push(
            fetch(BASE + '/api/content?action=news&country=' + country + '&max=10&sessionId=' + sid)
                .then(function(r) { return r.json(); })
                .catch(function() { return { articles: [] }; })
        );
        fetchPromises.push(
            fetch(BASE + '/api/content?action=rss&country=' + country + '&max=10&sessionId=' + sid)
                .then(function(r) { return r.json(); })
                .catch(function() { return { articles: [] }; })
        );
    }

    // German-language local feed (translated downstream)
    fetchPromises.push(
        fetch(BASE + '/api/content?action=rss&country=de_local&max=15&sessionId=' + sid)
            .then(function(r) { return r.json(); })
            .catch(function() { return { articles: [] }; })
    );

    var results = await Promise.all(fetchPromises);

    var allArticles = [];
    var localArticles = [];
    for (var r = 0; r < results.length; r++) {
        var d = results[r];
        if (d.articles && Array.isArray(d.articles)) {
            // Last fetch promise is always de_local — collect separately for translation
            if (r === results.length - 1) {
                localArticles = d.articles;
            } else {
                allArticles = allArticles.concat(d.articles);
            }
        }
    }

    console.log('[newsletter] englishArticles=' + allArticles.length + ' localArticles=' + localArticles.length);

    var translatedCount = 0;
    if (localArticles.length > 0) {
        var translated = await translateArticles(localArticles);
        if (translated.length > 0) {
            translated = translated.map(function(a) {
                return Object.assign({}, a, { country: 'DE', isLocal: true });
            });
            allArticles = translated.concat(allArticles);
            translatedCount = translated.length;
        }
    }

    var beforeCap = allArticles.length;
    allArticles = capPerSource(allArticles, 3);
    console.log('[newsletter] translated=' + translatedCount + ' poolBeforeCap=' + beforeCap + ' poolAfterCap=' + allArticles.length);

    if (allArticles.length < 3) return null;

    try {
        var r2 = await fetch(BASE + '/api/briefing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                articles: allArticles,
                countries: countries,
                interests: ['world', 'finance', 'tech', 'politics'],
                location: 'de',
                profession: 'professional',
                sessionId: 'newsletter-de-' + new Date().toISOString().slice(0, 10),
            }),
        });
        var d2 = await r2.json();
        if (d2.stories && d2.stories.length >= 3) {
            var localPicked = d2.stories.filter(function(s) { return s.isLocal; }).length;
            console.log('[newsletter] briefingStories=' + d2.stories.length + ' localPicked=' + localPicked + ' capViolations=' + JSON.stringify(d2.capViolations || []));
            return d2.stories;
        } else if (d2.error) {
            console.log('[newsletter] briefing error: ' + d2.error);
        }
    } catch (e) {
        console.log('[newsletter] briefing fetch failed: ' + e.message);
    }

    return null;
}

async function enrichStories(stories) {
    if (!stories || !stories.length) return stories;

    // Germany-only post-pivot. Voice rules from SKILL.md "Brand Voice & Content Guide":
    //   - 70% service journalism (what changes for you, what to do, by when)
    //   - 30% intelligent context (history, politics, what non-Germans miss)
    //   - German terms used directly: Krankenkasse, Bürgergeld, Mietpreisbremse,
    //     Anmeldung, S-Bahn, U-Bahn, BVG, Bundestag, Bundesrat, Sparkasse,
    //     Bundesländer, Steuererklärung, Wohngeld, Kita, Mietvertrag, Kiez.
    //     Do not translate. Reader lives in Germany and recognizes them.
    var context = 'an English speaker living in Germany — likely Berlin or another major city. They care about: their rent (Miete), their energy bills (Strom/Gas), their grocery prices, their commute (BVG, S-Bahn, U-Bahn), their health insurance (Krankenkasse), their visa or Niederlassungserlaubnis status, their kids\' school or Kita, their taxes (Steuererklärung), their savings at Sparkasse or Deutsche Bank, their Mietvertrag, their Anmeldung, their Bürgergeld eligibility (or what reform means for it). Could be expat, international student, remote worker, diplomat, journalist, or English-fluent German. Don\'t assume wealth or corporate lifestyle. Don\'t assume they own stocks. Assume a normal person living a normal life in Germany who reads English and wants to understand how news affects their daily life — practically and intellectually — without slogging through bureaucratic German.';

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
                    content: 'You write for Verityn, a morning news email for ' + context + '\n\nFor each story below, write two things:\n\n'
                        + '1. "body": A 2-3 sentence news paragraph that synthesises the story. Cite the source name naturally inline ("According to Reuters..." or "...the Guardian reports."). If you can, mention a second angle or source. Be factual and specific. Use numbers, names, dates.\n\n'
                        + '2. "why": A 1-2 sentence why-line explaining how the story touches the reader\'s life. EVERY story has an angle. Find it.\n\n'
                        + 'CORE RULE: Every story made it into this briefing because it matters to this reader. Your job is to find and explain the angle, not to flag when there isn\'t one. There always is. The angle might be obvious (a German tax change hits their paycheck directly). It might be one step removed (a Russia story affects their gas bill, a Fed move affects their Euribor mortgage, a Japan trade story affects German exports and the Berlin job market). Either way: write the angle. Do not give up.\n\n'
                        + 'WHY-LINE STYLE:\n'
                        + '- 70/30 SPLIT: 70% of the why-line is service journalism — what changes for you, what to do, by when. 30% is intelligent context — history, politics, what non-Germans miss. Service first, then context. Not the reverse.\n'
                        + '- GERMAN TERMS USED DIRECTLY. Do NOT translate these into English: Krankenkasse, Bürgergeld, Mietpreisbremse, Mietendeckel, Anmeldung, Niederlassungserlaubnis, S-Bahn, U-Bahn, BVG, Bundestag, Bundesrat, Bundesländer, Sparkasse, Steuererklärung, Wohngeld, Kita, Mietvertrag, Kiez, Heizungsgesetz, Wärmepumpe, Energiewende, Bürgeramt, Termin. The reader lives in Germany. Translating these signals you don\'t trust them.\n'
                        + '- Sound like a sharp friend telling you something over coffee. Not a textbook. Not a press release.\n'
                        + '- Connect to DAILY LIFE: rent (Miete), energy bills (Strom/Gas), grocery prices, commute (BVG, S-Bahn), taxes (Steuererklärung), savings (Sparkasse), salary, kids, weekend plans, Kiez, jobs, mortgages, banking, visa or Niederlassungserlaubnis status.\n'
                        + '- Do NOT assume the reader owns stocks, has a corporate travel budget, works in finance, or has defense investments.\n'
                        + '- Be specific. Use timeframes ("by July"), amounts ("8-10 cents per liter"), local references ("Berlin pumps", "your Sparkasse rate", "BVG monthly pass", "your Krankenkasse deduction").\n'
                        + '- Use "your" not "this affects." "Watch your December Krankenkasse letter," not "consumers should monitor their statements."\n'
                        + '- Avoid em dashes. Use periods or commas.\n\n'
                        + 'NEVER use these phrases or anything close to them. They are tells of give-up writing:\n'
                        + '"could potentially", "may impact", "highlights the importance of", "underscores", "it remains to be seen", "this is significant because", "your portfolio", "your investments", "more background than action", "but worth knowing if you follow", "skip unless you follow", "doesn\'t affect your daily life", "mostly a political ethics story", "broader landscape", "evolving landscape", "this development affects", "no direct impact on your daily life", "interesting tech development but".\n'
                        + 'If you find yourself reaching for one of these, STOP. Re-read the story. There is an angle. A Russia internet story affects German VPN providers and tech jobs in Berlin. A foreign election affects German trade exposure. A tech announcement in Japan affects German auto suppliers. Find the angle and write THAT.\n\n'
                        + 'EXAMPLES of WRONG (do not write like this):\n'
                        + '"Russian politics story that doesn\'t affect your Berlin commute, rent, or grocery bills. Skip unless you follow Eastern European developments."\n'
                        + '"Mostly a political ethics story that doesn\'t change your daily costs or services."\n'
                        + '"This one is more background than action but worth knowing if you follow finance."\n'
                        + '"Your defense contractor stocks and NATO-related investments face volatility."\n\n'
                        + 'EXAMPLES of RIGHT (variety of shapes, real angles, no give-up):\n'
                        + '"Fill up your car this week. Berlin pump prices follow Brent crude with a 3-week delay, so expect 8 to 10 cents more per liter by mid-May."\n'
                        + '"Direct hit on your paycheck if you earn above 69,300 euros annually. Expect higher Krankenkasse deductions starting next year, or weigh the switch to private coverage now."\n'
                        + '"Watch the Bundestag vote next Thursday. The new sugar tax adds about 20 cents to a bottle of cola from 2028."\n'
                        + '"Russia\'s internet fight touches your VPN cost and Berlin\'s small Russian-speaking tech scene. ProtonVPN and Mullvad have already raised prices once this year."\n'
                        + '"Lobbying access scandals shape who actually writes the next housing law. If your Mietendeckel renewal hangs on it, watch which committee takes the bill in June."\n\n'
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

        if (action === 'subscribe') {
            var body = req.body || {};
            var email = (body.email || '').trim().toLowerCase();
            if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

            var name = (body.name || email.split('@')[0]).trim();
            var timezone = body.timezone || '';
            // Germany pivot (May 2026): force region='de' regardless of any client input.
            // The country-tag field has been removed from the subscribe form on
            // verityn.news, but defensive normalisation is enforced server-side too.
            // Timezone is still captured for future Bundesland-aware features.
            var region = 'de';

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

        if (action === 'unsubscribe') {
            var email2 = (req.query.email || (req.body && req.body.email) || '').trim().toLowerCase();
            if (!email2) return res.status(400).json({ error: 'Email required' });

            await supabase.from('waitlist').update({ unsubscribed: true }).eq('email', email2);
            return res.json({ ok: true, unsubscribed: true });
        }

        if (action === 'preview') {
            // Germany-only post-pivot. Region query param ignored.
            var stories = await generateFreshBriefing(supabase);
            if (!stories) return res.json({ error: 'No briefing available yet.' });
            stories = await enrichStories(stories);
            var extras = await generateExtras(stories);
            extras.weather = await getWeather();
            res.setHeader('Content-Type', 'text/html');
            return res.send(buildEmailHTML(stories, 'Reader', 'preview@example.com', extras));
        }

        if (action === 'test') {
            var testEmail = req.query.email;
            if (!testEmail) return res.json({ error: 'Add &email=your@email.com' });
            if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return res.json({ error: 'SMTP creds not set' });

            var testName = testEmail.split('@')[0];
            try {
                var lookup = await supabase.from('waitlist').select('name').eq('email', testEmail.toLowerCase()).limit(1);
                if (lookup.data && lookup.data.length > 0) {
                    testName = lookup.data[0].name || testName;
                }
            } catch (e) { }

            var stories2 = await generateFreshBriefing(supabase);
            if (!stories2) {
                var debugStories = null;
                try {
                    var BASE = 'https://verityn-backend-ten.vercel.app';
                    var dSid = 'debug-' + Date.now();
                    var dr1 = await fetch(BASE + '/api/content?action=rss&country=de&max=5&sessionId=' + dSid);
                    var dd1 = await dr1.json();
                    var articleCount = dd1.articles ? dd1.articles.length : 0;

                    var dr2 = await fetch(BASE + '/api/briefing', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            articles: (dd1.articles || []).slice(0, 5),
                            countries: ['de', 'gb'],
                            location: 'de',
                            interests: ['world'],
                        }),
                    });
                    var dd2 = await dr2.json();
                    return res.json({
                        error: 'Full pipeline failed. Debug info:',
                        articlesFound: articleCount,
                        briefingResponse: dd2.error || dd2.stories ? 'got ' + (dd2.stories || []).length + ' stories' : 'unknown',
                        briefingRaw: JSON.stringify(dd2).slice(0, 500),
                    });
                } catch (debugErr) {
                    return res.json({ error: 'Full pipeline failed. Debug also failed: ' + debugErr.message });
                }
            }

            stories2 = await enrichStories(stories2);
            var extras2 = await generateExtras(stories2);
            extras2.weather = await getWeather();

            var transporter = getTransporter();
            var subject = buildSubjectLine(stories2);
            try {
                var result = await transporter.sendMail({
                    from: FROM_NAME + ' <' + FROM_EMAIL + '>',
                    to: testEmail,
                    subject: subject,
                    html: buildEmailHTML(stories2, testName, testEmail, extras2),
                });
                try { transporter.close(); } catch (e) { }
                var localCount = stories2.filter(function(s) { return s.isLocal; }).length;
                var srcCounts = {};
                for (var sci = 0; sci < stories2.length; sci++) {
                    var sk = (stories2[sci].source || '').toLowerCase()
                        .replace(/^(www\.|feeds\.|rss\.|news\.)/, '')
                        .replace(/\.(com|org|net|co\.uk|co|io|de|fr|eu|uk|in|at|ch|jp|au|sg|ae|es|it|nl)$/, '')
                        .replace(/[-_\s]+/g, '').trim();
                    srcCounts[sk] = (srcCounts[sk] || 0) + 1;
                }
                return res.json({ ok: true, messageId: result.messageId, subject: subject, to: testEmail, name: testName, stories: stories2.length, localStories: localCount, sourceCounts: srcCounts });
            } catch (e) {
                try { transporter.close(); } catch (e2) { }
                return res.json({ error: 'SMTP failed: ' + e.message });
            }
        }

        if (action === 'send') {
            // GUARD 1: POST-only. Browsers do not auto-retry POSTs, do not prefetch
            // POSTs, do not restore them from history. Eliminates the class of bug
            // where a slow GET request gets duplicated by browser retry mid-flight.
            // Hit with: curl -X POST .../api/newsletter?action=send  (or browser
            // dev tools fetch with method=POST). NOT a regular browser URL hit.
            if (req.method !== 'POST') {
                return res.status(405).json({
                    error: 'send action requires POST method',
                    hint: 'curl -X POST "<url>/api/newsletter?action=send"',
                });
            }

            // GUARD 2: Idempotency — has a newsletter already been sent today?
            // Today is computed in UTC since newsletter_log.created_at is UTC.
            // Any send that completed on the same UTC calendar day blocks subsequent sends.
            // To override (e.g. for a verified rebroadcast), pass &force=1 — explicit opt-in only.
            try {
                var todayUtc = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
                var force = req.query.force === '1' || (req.body && req.body.force === '1');
                if (!force) {
                    var { data: existingSends } = await supabase
                        .from('newsletter_log')
                        .select('created_at, sent_count, subject')
                        .gte('created_at', todayUtc + 'T00:00:00.000Z')
                        .lt('created_at', todayUtc + 'T23:59:59.999Z')
                        .gt('sent_count', 0)
                        .limit(1);
                    if (existingSends && existingSends.length > 0) {
                        return res.status(409).json({
                            ok: false,
                            alreadySent: true,
                            reason: 'Newsletter already sent today (UTC)',
                            previous: existingSends[0],
                            hint: 'To rebroadcast, pass &force=1 — explicit opt-in only.',
                        });
                    }
                }
            } catch (e) {
                // Don't fail the send if the idempotency check itself errors.
                // Better to risk a duplicate than to block a legitimate send because the
                // log table is unreachable. Log to errors and continue.
                console.error('[newsletter] idempotency check failed:', e.message);
            }

            if (process.env.NEWSLETTER_ENABLED !== 'true') return res.json({ ok: false, reason: 'Set NEWSLETTER_ENABLED=true' });
            if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return res.json({ error: 'SMTP creds not set' });

            var subscribers = await getSubscribers(supabase);
            if (!subscribers.length) return res.json({ ok: true, sent: 0, reason: 'No subscribers' });

            // Germany-only post-pivot. All subscribers receive the same edition.
            // Region grouping removed — see SKILL.md "Newsletter Operational Spec".
            var stories = await generateFreshBriefing(supabase);
            if (!stories) return res.json({ error: 'No briefing available' });

            stories = await enrichStories(stories);

            try { await supabase.from('newsletter_cache').insert({ stories: stories }); } catch (e) { }

            var extras = await generateExtras(stories);
            extras.weather = await getWeather();
            var subject = buildSubjectLine(stories);

            var transporter2 = getTransporter();
            var sent = 0, failed = 0, errors = [];

            for (var i = 0; i < Math.min(subscribers.length, BATCH_SIZE); i++) {
                var sub = subscribers[i];
                try {
                    await transporter2.sendMail({
                        from: FROM_NAME + ' <' + FROM_EMAIL + '>',
                        to: sub.email,
                        subject: subject,
                        html: buildEmailHTML(stories, sub.name || sub.email.split('@')[0], sub.email, extras),
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
                    subject: subject, story_count: stories.length,
                });
            } catch (e) { }

            return res.json({ ok: true, sent: sent, failed: failed, total: subscribers.length, subject: subject });
        }

        return res.json({ actions: 'subscribe, unsubscribe, preview, test, send' });
    } catch (e) {
        return res.json({ error: e.message });
    }
};
