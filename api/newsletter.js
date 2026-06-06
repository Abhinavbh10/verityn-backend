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

// ── Cross-day memory + same-event dedup + theme tagging (May 2026) ──────────
// Kills the repetition problem: same story across days, same event from two
// sources within a send, same theme every day, same fact two days running.

// Lightweight entity extraction for same-event dedup. Pulls salient nouns /
// proper-noun-ish tokens from a headline. Two headlines that share enough
// entities are treated as the same event.
var STOPWORDS = new Set(['the','a','an','and','or','but','of','to','in','on','for','with','at','by','from','as','is','are','was','were','be','been','will','would','could','should','this','that','these','those','it','its','his','her','their','your','you','we','they','he','she','after','before','over','under','into','out','up','down','new','says','say','said','how','why','what','when','where','who','amid','again','more','less','than','then','now','here','there','about','against']);
function extractEntities(headline) {
    var words = (headline || '').toLowerCase().replace(/[^a-z0-9äöüß\s]/g, ' ').split(/\s+/);
    var ents = [];
    for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (w.length >= 4 && !STOPWORDS.has(w)) ents.push(w);
    }
    return ents;
}

// Same-event dedup within a candidate pool. If two articles share >=2 salient
// entities AND aren't from purposely-different angles, keep the first (which is
// city-local-first ordered) and drop the later duplicate.
function dedupeSameEvent(articles) {
    var kept = [];
    var keptEntitySets = [];
    for (var i = 0; i < articles.length; i++) {
        var ents = extractEntities(articles[i].headline);
        var entSet = new Set(ents);
        var isDup = false;
        for (var k = 0; k < keptEntitySets.length; k++) {
            var overlap = 0;
            var prev = keptEntitySets[k];
            entSet.forEach(function(e) { if (prev.has(e)) overlap++; });
            // 3+ shared salient entities = same event. (Was 2+ originally —
            // bumped June 2026 because 2+ was over-merging related-but-distinct
            // stories like two caterpillar articles about different neighborhoods.)
            if (overlap >= 3) { isDup = true; break; }
        }
        if (!isDup) {
            kept.push(articles[i]);
            keptEntitySets.push(entSet);
        }
    }
    return kept;
}

// Rough theme tagger for cross-day theme rotation + within-day diversity.
var THEME_PATTERNS = [
    ['conflict', /\b(iran|israel|gaza|hormuz|ukraine|russia|war|strike[sd]?|missile|military|troops|nato|ceasefire)\b/i],
    ['housing', /\b(rent|miete|mietpreis|wohnung|housing|apartment|tempelhof|immobilien|landlord|tenant|wohngeld)\b/i],
    ['transit', /\b(bvg|s-bahn|u-bahn|sbahn|ubahn|deutsche bahn|\bdb\b|rmv|tram|bus|commute|train|verkehr|bahn)\b/i],
    ['politics', /\b(wegner|senat|bundestag|election|wahl|coalition|afd|cdu|spd|government|minister|abgeordnetenhaus)\b/i],
    ['economy', /\b(inflation|economy|gdp|recession|jobs|unemployment|tax|steuer|wirtschaft|export|dax|ecb|interest rate)\b/i],
    ['energy', /\b(oil|gas|strom|energy|solar|heizkosten|fuel|diesel|petrol|electricity|power)\b/i],
    ['crime', /\b(police|polizei|arrest|shooting|attack|crime|gewalt|killed|stabbing|gang)\b/i],
    ['weather', /\b(weather|wetter|storm|rain|heat|hitze|temperature|sun|snow|forecast)\b/i],
    ['tech', /\b(ai|tech|chip|semiconductor|software|startup|digital|samsung|meta|google|apple|nvidia)\b/i],
    ['culture', /\b(festival|museum|concert|art|kultur|film|theatre|theater|exhibition|karneval|food|restaurant)\b/i],
];
function tagTheme(headline) {
    for (var i = 0; i < THEME_PATTERNS.length; i++) {
        if (THEME_PATTERNS[i][1].test(headline || '')) return THEME_PATTERNS[i][0];
    }
    return 'other';
}

// Fetch what recent sends covered for this city (last `days` days).
async function getRecentMemory(supabase, city, days) {
    days = days || 3;
    var cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    var out = { headlines: [], themes: [], facts: [] };
    try {
        var res = await supabase
            .from('newsletter_memory')
            .select('headlines, themes, fact_served, sent_date')
            .eq('city', city)
            .gte('sent_date', cutoff)
            .order('sent_date', { ascending: false });
        if (res.data) {
            for (var i = 0; i < res.data.length; i++) {
                var row = res.data[i];
                if (Array.isArray(row.headlines)) out.headlines = out.headlines.concat(row.headlines);
                if (Array.isArray(row.themes)) out.themes = out.themes.concat(row.themes);
                if (row.fact_served) out.facts.push(row.fact_served);
            }
        }
    } catch (e) {
        console.log('[newsletter] getRecentMemory failed (non-fatal): ' + e.message);
    }
    return out;
}

// Theme rotation: given themes already heavy this week, return them sorted by
// frequency (most overused first) so briefing knows what to avoid.
function overusedThemes(recentThemes) {
    var counts = {};
    for (var i = 0; i < recentThemes.length; i++) {
        counts[recentThemes[i]] = (counts[recentThemes[i]] || 0) + 1;
    }
    return Object.keys(counts)
        .filter(function(t) { return counts[t] >= 2 && t !== 'other'; })
        .sort(function(a, b) { return counts[b] - counts[a]; });
}

// Write today's send to memory.
async function writeMemory(supabase, city, stories, factServed) {
    try {
        var headlines = stories.map(function(s) { return s.headline; }).filter(Boolean);
        var themes = stories.map(function(s) { return tagTheme(s.headline); });
        var entities = [];
        stories.forEach(function(s) { entities = entities.concat(extractEntities(s.headline).slice(0, 3)); });
        await supabase.from('newsletter_memory').insert({
            city: city,
            story_entities: entities,
            headlines: headlines,
            themes: themes,
            fact_served: factServed || '',
        });
    } catch (e) {
        console.log('[newsletter] writeMemory failed (non-fatal): ' + e.message);
    }
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
    var body = escapeHtml(s.body || s.summary || '');
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
    var dayNum = new Date().toLocaleDateString('en-GB', { day: '2-digit' });
    var dayMonth = new Date().toLocaleDateString('en-GB', { weekday: 'short', month: 'short' });
    var hour = new Date().getUTCHours() + 2;
    var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    var unsubLink = 'https://verityn.news/unsubscribe?email=' + encodeURIComponent(email || '');

    var ext = extras || {};
    var weather = ext.weather || { line1: '', details: '' };
    var pollen = ext.pollen || '';                  // e.g. "Pollen: Grass HIGH" — pill renders only when set
    var alerts = Array.isArray(ext.alerts) ? ext.alerts : []; // array of strings; section hides when empty
    var events = Array.isArray(ext.events) ? ext.events : []; // [{when,title,detail}]
    var didYouKnow = ext.did_you_know || '';
    var didYouKnowBig = ext.did_you_know_number || '';   // optional, large display number
    var word = ext.word_of_day || null;             // {german, literal, meaning, example}
    var holiday = ext.holiday || null;              // {name, daysUntil, dateLabel} or null
    var closer = ext.closer || 'You\'re caught up.';

    // ── Strike / disruption alert (top, red) — renders only if alerts present ──
    var alertHtml = '';
    if (alerts.length > 0) {
        var alertItems = alerts.map(function(a) { return escapeHtml(a); }).join(' &middot; ');
        alertHtml = '<tr><td style="background-color:#D14A28;color:#FBF5E8;padding:14px 24px">'
            + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
            + '<td style="vertical-align:top;width:28px;font-family:Georgia,serif;font-size:22px;line-height:1;color:#FBF5E8">!</td>'
            + '<td style="padding-left:8px">'
            + '<div style="font-size:9px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;opacity:0.85;margin-bottom:3px">Heads up — Today in Berlin</div>'
            + '<div style="font-size:13.5px;line-height:1.45">' + alertItems + '</div>'
            + '</td></tr></table></td></tr>';
    }

    // ── Pollen pill in weather strip ──
    var pollenHtml = '';
    if (pollen) {
        // Color: high/very-high = red, moderate = amber, low = green
        var low = /low/i.test(pollen);
        var bg = low ? 'rgba(67,123,67,0.15)' : 'rgba(209,74,40,0.12)';
        var fg = low ? '#3F6E3F' : '#A03A20';
        pollenHtml = '<span style="background:' + bg + ';color:' + fg + ';padding:3px 10px;border-radius:14px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-left:8px">' + escapeHtml(pollen) + '</span>';
    }

    // ── Build story sections: lead (slot 0) + deep-dives (slot 1-3) + quick hits (slot 4+) ──
    var leadHtml = '';
    var deepDivesHtml = '';
    var quickHitsHtml = '';

    var leadStory = stories.length > 0 ? stories[0] : null;
    var deepStart = leadStory ? 1 : 0;
    var deepStories = [];
    var quickStories = [];

    // Lead is slot 0, deep-dives next 3 (max), rest become quick hits
    for (var si = deepStart; si < stories.length && deepStories.length < 3; si++) {
        deepStories.push(stories[si]);
    }
    var qStart = deepStart + deepStories.length;
    for (var qi = qStart; qi < stories.length; qi++) {
        quickStories.push(stories[qi]);
    }

    // -- Lead (large headline, body, why-line, read more) --
    if (leadStory) {
        leadHtml = '<tr><td style="background-color:#FBF5E8;padding:24px 36px 0">'
            + '<span style="font-family:Georgia,serif;font-size:24px;font-weight:400;color:#1F1810;border-bottom:3px solid #D14A28;padding-bottom:4px">Today\'s lead</span>'
            + '</td></tr>'
            + '<tr><td style="background-color:#FBF5E8;padding:18px 36px 28px">'
            + buildLeadStory(leadStory) + '</td></tr>';
    }

    // -- Deep dives --
    if (deepStories.length > 0) {
        deepDivesHtml = '<tr><td style="background-color:#FBF5E8;padding:24px 36px 0">'
            + '<span style="font-family:Georgia,serif;font-size:24px;font-weight:400;color:#1F1810;border-bottom:3px solid #D14A28;padding-bottom:4px">Also worth knowing</span>'
            + '</td></tr>';
        for (var di = 0; di < deepStories.length; di++) {
            deepDivesHtml += '<tr><td style="background-color:#FBF5E8;padding:24px 36px;border-top:1px solid rgba(122,106,80,0.25)">'
                + buildDeepStory(deepStories[di]) + '</td></tr>';
        }
    }

    // -- Quick hits --
    if (quickStories.length > 0) {
        quickHitsHtml = '<tr><td style="background-color:#FBF5E8;padding:24px 36px 0">'
            + '<span style="font-family:Georgia,serif;font-size:24px;font-weight:400;color:#1F1810;border-bottom:3px solid #D14A28;padding-bottom:4px">Quick hits</span>'
            + '</td></tr>'
            + '<tr><td style="background-color:#FBF5E8;padding:8px 36px 28px">';
        for (var qhi = 0; qhi < quickStories.length; qhi++) {
            quickHitsHtml += buildQuickHit(quickStories[qhi], qhi === quickStories.length - 1);
        }
        quickHitsHtml += '</td></tr>';
    }

    // -- Events (This weekend) — renders only if events exist --
    var eventsHtml = '';
    if (events.length > 0) {
        eventsHtml = '<tr><td style="background-color:#FBF5E8;padding:24px 36px 0">'
            + '<span style="font-family:Georgia,serif;font-size:24px;font-weight:400;color:#1F1810;border-bottom:3px solid #D14A28;padding-bottom:4px">This weekend</span>'
            + '</td></tr>'
            + '<tr><td style="background-color:#FBF5E8;padding:8px 36px 28px">';
        for (var ei = 0; ei < events.length; ei++) {
            var ev = events[ei];
            var isLast = ei === events.length - 1;
            eventsHtml += '<div style="padding:16px 0' + (isLast ? '' : ';border-bottom:1px dotted rgba(122,106,80,0.4)') + '">'
                + '<div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#D14A28;margin-bottom:4px">' + escapeHtml(ev.when || '') + '</div>'
                + '<div style="font-family:Georgia,serif;font-size:18px;font-weight:400;color:#1F1810;line-height:1.2;margin-bottom:4px">' + escapeHtml(ev.title || '') + '</div>'
                + (ev.detail ? '<div style="font-size:13px;color:#5A4A30;line-height:1.5">' + escapeHtml(ev.detail) + '</div>' : '')
                + '</div>';
        }
        eventsHtml += '</td></tr>';
    }

    // -- Did You Know (dark card with optional big number) --
    var didYouKnowHtml = '';
    if (didYouKnow) {
        var bigNum = didYouKnowBig ? '<div style="font-family:Georgia,serif;font-size:64px;line-height:0.9;margin-bottom:10px;color:#FBF5E8;font-weight:400">' + escapeHtml(didYouKnowBig) + '</div>' : '';
        didYouKnowHtml = '<tr><td style="background-color:#FBF5E8;padding:0 36px;margin:24px 0">'
            + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#1F1810"><tr><td style="padding:28px 32px;color:#FBF5E8">'
            + '<div style="font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#D14A28;margin-bottom:18px">Did You Know</div>'
            + bigNum
            + '<div style="font-size:14px;line-height:1.55;color:#D0C5AE">' + escapeHtml(didYouKnow) + '</div>'
            + '</td></tr></table></td></tr>'
            + '<tr><td style="background-color:#FBF5E8;height:24px;font-size:0">&nbsp;</td></tr>';
    }

    // -- Word of the Day (cream card with red left border) --
    var wordHtml = '';
    if (word && word.german) {
        var wordMeta = '';
        if (word.literal) wordMeta += 'literal: "' + escapeHtml(word.literal) + '"';
        if (word.literal && word.meaning) wordMeta += ' · ';
        if (word.meaning) wordMeta += 'meaning: ' + escapeHtml(word.meaning);
        wordHtml = '<tr><td style="background-color:#FBF5E8;padding:0 36px">'
            + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3E9D2"><tr>'
            + '<td style="padding:24px 28px;border-left:5px solid #D14A28">'
            + '<div style="font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#D14A28;margin-bottom:10px">Word of the Day</div>'
            + '<div style="font-family:Georgia,serif;font-size:32px;font-weight:400;color:#1F1810;line-height:1;margin-bottom:6px">' + escapeHtml(word.german) + '</div>'
            + (wordMeta ? '<div style="font-size:12px;color:#7A6A50;margin-bottom:12px;font-style:italic">' + wordMeta + '</div>' : '')
            + (word.example ? '<div style="font-size:13.5px;color:#3A2E18;line-height:1.55;padding:12px 16px;background:rgba(31,24,16,0.05);border-left:3px solid #D14A28;font-style:italic">' + escapeHtml(word.example) + '</div>' : '')
            + '</td></tr></table></td></tr>'
            + '<tr><td style="background-color:#FBF5E8;height:24px;font-size:0">&nbsp;</td></tr>';
    }

    // -- Holiday countdown (subtle centered strip) --
    var holidayHtml = '';
    if (holiday && holiday.name && holiday.daysUntil) {
        holidayHtml = '<tr><td style="background-color:#FBF5E8;padding:20px 36px;text-align:center;border-top:1px solid rgba(122,106,80,0.25);border-bottom:1px solid rgba(122,106,80,0.25)">'
            + '<div style="font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#9A7E50;margin-bottom:6px">Next public holiday</div>'
            + '<div style="font-size:14px;color:#3A2E18;line-height:1.5">'
            + '<span style="font-family:Georgia,serif;font-style:italic;font-size:17px;color:#1F1810">' + escapeHtml(holiday.name) + '</span>'
            + ' in <span style="color:#D14A28;font-weight:700">' + escapeHtml(String(holiday.daysUntil)) + ' day' + (holiday.daysUntil === 1 ? '' : 's') + '</span>'
            + (holiday.dateLabel ? ' — ' + escapeHtml(holiday.dateLabel) : '')
            + '</div></td></tr>';
    }

    // -- Curated closer + V-mark --
    var closerHtml = '<tr><td style="background-color:#FBF5E8;padding:48px 36px 36px;text-align:center">'
        + '<div style="font-family:Georgia,serif;font-size:42px;line-height:1;margin-bottom:16px;color:#1F1810">V<span style="color:#D14A28">.</span></div>'
        + '<div style="font-family:Georgia,serif;font-style:italic;font-size:20px;color:#3A2E18;line-height:1.4;max-width:420px;margin:0 auto">' + escapeHtml(closer) + '</div>'
        + '</td></tr>';

    // -- Feedback row --
    var feedbackBase = 'https://verityn-backend-ten.vercel.app/api/newsletter?action=feedback&email=' + encodeURIComponent(email || '') + '&rating=';
    var feedbackHtml = '<tr><td style="background-color:#FBF5E8;padding:0 36px 28px;text-align:center">'
        + '<div style="font-size:11px;color:#9A7E50;padding-bottom:10px;letter-spacing:0.5px">How was today\'s briefing?</div>'
        + '<a href="' + feedbackBase + 'good" style="text-decoration:none;padding:8px 16px;background:#F3E9D2;border-radius:16px;font-size:13px;margin:0 4px;color:#3A2E18">&#128077; Loved it</a> &nbsp; '
        + '<a href="' + feedbackBase + 'ok" style="text-decoration:none;padding:8px 16px;background:#F3E9D2;border-radius:16px;font-size:13px;margin:0 4px;color:#3A2E18">&#129335; Okay</a> &nbsp; '
        + '<a href="' + feedbackBase + 'bad" style="text-decoration:none;padding:8px 16px;background:#F3E9D2;border-radius:16px;font-size:13px;margin:0 4px;color:#3A2E18">&#128078; Nah</a>'
        + '</td></tr>';

    return '<!DOCTYPE html>'
        + '<html lang="en"><head>'
        + '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">'
        + '<meta name="x-apple-disable-message-reformatting">'
        + '<title>Verityn Daily Brief</title>'
        + '<style>body,table,td{font-family:Karla,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1F1810}body{margin:0;padding:0;background-color:#E8DDC9}table{border-collapse:collapse}a{color:inherit}</style>'
        + '</head><body style="margin:0;padding:0;background-color:#E8DDC9">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#E8DDC9">'
        + '<tr><td align="center" style="padding:24px 16px">'
        + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#FBF5E8">'

        // STRIKE / DISRUPTION ALERT (top, conditional)
        + alertHtml

        // HEADER — logo + date stamp
        + '<tr><td style="background-color:#FBF5E8;padding:36px 36px 24px;border-bottom:3px double #1F1810;position:relative">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="vertical-align:top">'
        + '<div style="font-family:Georgia,serif;font-size:42px;line-height:1;font-weight:400;color:#1F1810;margin-bottom:4px">Verityn<span style="color:#D14A28">.</span></div>'
        + '<div style="font-size:12px;font-weight:500;letter-spacing:1px;color:#7A6A50;text-transform:uppercase">Berlin\'s daily for English speakers</div>'
        + '</td>'
        + '<td style="vertical-align:top;text-align:right;width:80px">'
        + '<div style="font-family:Georgia,serif;font-size:28px;line-height:1;color:#1F1810">' + dayNum + '</div>'
        + '<div style="font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#7A6A50;margin-top:4px">' + dayMonth + '</div>'
        + '</td>'
        + '</tr></table></td></tr>'

        // WEATHER STRIP with optional pollen
        + (weather.line1 || weather.details
            ? '<tr><td style="background-color:#F3E9D2;padding:16px 36px;font-size:13px;color:#5A4A30">'
                + (weather.line1 ? '<span style="font-family:Georgia,serif;font-size:18px;color:#1F1810">' + weather.line1 + '</span>' : '')
                + (weather.details ? ' <span style="color:#C9B98A">·</span> <span style="font-style:italic;color:#7A6A50">' + weather.details + '</span>' : '')
                + pollenHtml
                + '</td></tr>'
            : '')

        // OPENING NOTE
        + '<tr><td style="background-color:#FBF5E8;padding:32px 36px 24px;font-size:16px;line-height:1.55;color:#3A2E18;font-family:Georgia,serif;font-style:italic">'
        + '<span style="font-style:normal;font-weight:700">' + greeting + ', ' + escapeHtml(name) + '.</span> 100+ articles read this morning. The day\'s best, below.'
        + '</td></tr>'

        + leadHtml
        + deepDivesHtml
        + quickHitsHtml
        + eventsHtml
        + didYouKnowHtml
        + wordHtml
        + holidayHtml
        + closerHtml
        + feedbackHtml

        // CTA row
        + '<tr><td style="background-color:#FBF5E8;padding:0 36px 14px;text-align:center">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:rgba(31,24,16,0.04);border-radius:8px"><tr>'
        + '<td style="padding:14px 16px;text-align:center;font-size:12px;color:#7A6A50">Want Deep Dive, AI Search, and Topics? <a href="https://verityn.news" style="color:#D14A28;font-weight:600;text-decoration:none">Get the app &#8250;</a></td>'
        + '</tr></table></td></tr>'

        // FOOTER
        + '<tr><td style="background-color:#F3E9D2;padding:24px 36px 32px;text-align:center">'
        + '<div style="font-family:Georgia,serif;font-size:20px;color:#1F1810;margin-bottom:6px">Verityn<span style="color:#D14A28">.</span></div>'
        + '<div style="font-size:11px;color:#7A6A50;letter-spacing:0.5px">'
        + '<a href="' + unsubLink + '" style="color:#7A6A50;text-decoration:underline">Unsubscribe</a> &middot; '
        + '<a href="https://verityn.news" style="color:#7A6A50;text-decoration:underline">verityn.news</a> &middot; '
        + '<a href="https://instagram.com/verityn.news" style="color:#7A6A50;text-decoration:underline">Instagram</a>'
        + '</div></td></tr>'
        + '</table></td></tr></table></body></html>';
}

// Helper: render lead story (big serif headline, body, why-line, read more)
function buildLeadStory(s) {
    var src = (s.source || '').toUpperCase();
    var body = escapeHtml(s.body || s.summary || '');
    var why = escapeHtml(s.why || '');
    var headline = escapeHtml(s.headline || '');
    var url = s.sourceUrl || s.url || '#';
    return '<div style="font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#9A7E50;margin-bottom:10px">' + src + '</div>'
        + '<h1 style="font-family:Georgia,serif;font-size:30px;font-weight:400;line-height:1.15;color:#1F1810;margin:0 0 16px">' + headline + '</h1>'
        + (body ? '<p style="font-size:15px;line-height:1.65;color:#3A2E18;margin:0 0 18px">' + body + '</p>' : '')
        + (why
            ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3E9D2;margin-bottom:14px"><tr><td style="padding:18px 22px">'
                + '<div style="font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#D14A28;margin-bottom:8px">Why this matters</div>'
                + '<div style="font-size:13.5px;line-height:1.55;color:#3A2E18;font-style:italic">' + why + '</div>'
                + '</td></tr></table>'
            : '')
        + '<a href="' + url + '" style="font-size:12px;font-weight:700;color:#1F1810;text-decoration:none;letter-spacing:0.5px;text-transform:uppercase;border-bottom:2px solid #D14A28;padding-bottom:1px">Read the full story &rarr;</a>';
}

// Helper: render deep-dive story (medium headline, body, why-line, read more)
function buildDeepStory(s) {
    var src = (s.source || '').toUpperCase();
    var body = escapeHtml(s.body || s.summary || '');
    var why = escapeHtml(s.why || '');
    var headline = escapeHtml(s.headline || '');
    var url = s.sourceUrl || s.url || '#';
    return '<div style="font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#9A7E50;margin-bottom:8px">' + src + '</div>'
        + '<h2 style="font-family:Georgia,serif;font-size:22px;font-weight:400;line-height:1.2;color:#1F1810;margin:0 0 12px">' + headline + '</h2>'
        + (body ? '<p style="font-size:14px;line-height:1.6;color:#3A2E18;margin:0 0 14px">' + body + '</p>' : '')
        + (why
            ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3E9D2;margin-bottom:14px"><tr><td style="padding:16px 20px">'
                + '<div style="font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#D14A28;margin-bottom:6px">Why this matters</div>'
                + '<div style="font-size:13px;line-height:1.55;color:#3A2E18;font-style:italic">' + why + '</div>'
                + '</td></tr></table>'
            : '')
        + '<a href="' + url + '" style="font-size:11px;font-weight:700;color:#1F1810;text-decoration:none;letter-spacing:1px;text-transform:uppercase;border-bottom:2px solid #D14A28;padding-bottom:1px">Read &rarr;</a>';
}

// Helper: render quick-hit (V-mark + headline + 1-line summary)
function buildQuickHit(s, isLast) {
    var headline = escapeHtml(s.headline || '');
    var summary = s.body ? escapeHtml(truncate(s.body, 140)) : (s.summary ? escapeHtml(truncate(s.summary, 140)) : '');
    var src = (s.source || '').toUpperCase();
    var url = s.sourceUrl || s.url || '#';
    var border = isLast ? '' : 'border-bottom:1px dotted rgba(122,106,80,0.4);';
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="' + border + '"><tr>'
        + '<td style="padding:14px 0;width:24px;vertical-align:top">'
        + '<span style="font-family:Georgia,serif;font-size:18px;color:#D14A28;line-height:1.2;font-weight:400">V.</span>'
        + '</td>'
        + '<td style="padding:14px 0 14px 6px;vertical-align:top">'
        + '<div style="font-size:14px;font-weight:700;line-height:1.35;color:#1F1810;margin-bottom:4px">'
        + '<a href="' + url + '" style="color:#1F1810;text-decoration:none">' + headline + '</a>'
        + (src ? ' <span style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9A7E50;margin-left:8px">' + src + '</span>' : '')
        + '</div>'
        + (summary ? '<div style="font-size:12.5px;color:#5A4A30;line-height:1.5">' + summary + '</div>' : '')
        + '</td></tr></table>';
}

// Helper: truncate text to N chars at word boundary
function truncate(s, n) {
    if (!s) return '';
    if (s.length <= n) return s;
    var cut = s.slice(0, n);
    var sp = cut.lastIndexOf(' ');
    if (sp > n * 0.6) cut = cut.slice(0, sp);
    return cut + '…';
}

// Helper: build the picker email HTML (50 headlines + checkboxes + submit form).
// Sent to hello@verityn.news at 22:00 Berlin. User ticks 5-10 boxes, hits
// Submit, which POSTs to /api/newsletter?action=editor-select with the picked
// row ids. The form posts as application/x-www-form-urlencoded (works in
// email clients without JS).
function buildPickerEmail(rows, submitUrl, pickDate) {
    // Group by source for visual scanning
    var bySource = {};
    rows.forEach(function(r) {
        var src = (r.source || 'OTHER').toUpperCase();
        if (!bySource[src]) bySource[src] = [];
        bySource[src].push(r);
    });

    var rowsHtml = '';
    Object.keys(bySource).sort().forEach(function(src) {
        rowsHtml += '<tr><td style="padding:20px 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#D14A28;border-bottom:1px solid rgba(31,24,16,0.1)">' + escapeHtml(src) + ' &middot; ' + bySource[src].length + '</td></tr>';
        bySource[src].forEach(function(r) {
            var headline = escapeHtml(r.headline || '');
            rowsHtml += '<tr><td style="padding:10px 0;border-bottom:1px dotted rgba(122,106,80,0.3)">'
                + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
                + '<td style="width:32px;vertical-align:top;padding-top:2px">'
                + '<input type="checkbox" name="pick" value="' + r.id + '" style="width:20px;height:20px;cursor:pointer">'
                + '</td>'
                + '<td style="vertical-align:top">'
                + '<label style="font-size:14px;line-height:1.4;color:#1F1810;cursor:pointer">' + headline + '</label>'
                + '</td>'
                + '</tr></table></td></tr>';
        });
    });

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Verityn Picker</title></head>'
        + '<body style="margin:0;padding:0;background:#E8DDC9;font-family:-apple-system,Segoe UI,Roboto,sans-serif">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E8DDC9">'
        + '<tr><td align="center" style="padding:24px 16px">'
        + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FBF5E8;padding:36px">'

        + '<tr><td>'
        + '<div style="font-family:Georgia,serif;font-size:32px;color:#1F1810">Picker<span style="color:#D14A28">.</span></div>'
        + '<div style="font-size:13px;color:#7A6A50;margin-top:6px">For tomorrow\'s send — ' + escapeHtml(pickDate) + '</div>'
        + '</td></tr>'

        + '<tr><td style="padding-top:18px;padding-bottom:14px;font-size:14px;color:#3A2E18;line-height:1.55">'
        + 'Tick the stories you want in tomorrow morning\'s newsletter. Aim for <strong>7</strong> &mdash; minimum 5, or the system falls back to automated. Submit before <strong>04:00 Berlin time</strong> tomorrow.'
        + '</td></tr>'

        + '<tr><td><form action="' + submitUrl + '" method="POST">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + rowsHtml
        + '</table>'
        + '<div style="text-align:center;padding-top:28px"><button type="submit" style="background:#1F1810;color:#FBF5E8;border:none;padding:14px 36px;font-size:14px;font-weight:600;letter-spacing:0.5px;cursor:pointer;border-radius:2px">Submit picks</button></div>'
        + '</form></td></tr>'

        + '<tr><td style="padding-top:32px;font-size:11px;color:#9A7E50;text-align:center;border-top:1px solid rgba(31,24,16,0.08);padding-top:18px">'
        + 'Verityn editor &middot; ' + rows.length + ' stories shown'
        + '</td></tr>'

        + '</table></td></tr></table></body></html>';
}

async function getWeather(city) {
    // City-keyed weather (May 2026 city pivot). Adding a new city requires adding
    // coords here AND a feed in content.js AND a cityContext entry in enrichStories.
    city = city || 'berlin';
    var coords = {
        berlin: { lat: 52.52, lon: 13.41, city: 'Berlin' },
        frankfurt: { lat: 50.11, lon: 8.68, city: 'Frankfurt' },
        bonn: { lat: 50.74, lon: 7.10, city: 'Bonn' },
    };
    var c = coords[city] || coords.berlin;
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

async function generateExtras(stories, city, excludeFacts, supabase) {
    if (!stories || stories.length < 3) return { did_you_know: '', closer: '' };
    city = city || 'berlin';

    var extras = {};

    // ── 1. Did You Know (curated, cross-day dedup) ──
    var facts = require('./_facts.js');
    var factObj = facts.getRandomFact('eu', excludeFacts || []);
    var factParts = facts.factToParts(factObj);
    extras.did_you_know = factParts.text;
    extras.did_you_know_number = factParts.number;

    // ── 2. Word of the Day (curated) ──
    try {
        var words = require('./_words.js');
        extras.word_of_day = words.getRandomWord([]);
    } catch (e) {
        console.log('[newsletter] words.js missing: ' + e.message);
    }

    // ── 3. Curated closer ──
    try {
        var closers = require('./_closers.js');
        extras.closer = closers.getRandomCloser([]);
    } catch (e) {
        extras.closer = 'You\'re caught up.';
    }

    // ── 4. Holiday countdown (renders only if upcoming holiday within 14 days) ──
    try {
        var holidays = require('./_holidays.js');
        var nextHoliday = holidays.getNextHoliday(new Date(), 14);
        if (nextHoliday) extras.holiday = nextHoliday;
    } catch (e) {
        console.log('[newsletter] holidays.js missing: ' + e.message);
    }

    // ── 5. Active alerts (read from Supabase, scoped by city) ──
    // Renders the red strike-alert strip at the top of the email.
    if (supabase) {
        try {
            var alertsResp = await supabase
                .from('active_alerts')
                .select('text, expires_at')
                .eq('city', city)
                .or('expires_at.is.null,expires_at.gte.' + new Date().toISOString())
                .order('priority', { ascending: false });
            if (alertsResp.data && alertsResp.data.length > 0) {
                extras.alerts = alertsResp.data.map(function(a) { return a.text; }).filter(Boolean);
            }
        } catch (e) {
            console.log('[newsletter] alerts fetch failed (non-fatal): ' + e.message);
        }
    }

    // ── 6. Events (read from Supabase, scoped by city) ──
    // Renders the "This weekend" section. Past events auto-purged.
    if (supabase) {
        try {
            var todayStr = new Date().toISOString().slice(0, 10);
            var eventsResp = await supabase
                .from('events')
                .select('when_label, title, detail, sort_date')
                .eq('city', city)
                .gte('sort_date', todayStr)
                .order('sort_date', { ascending: true })
                .limit(5);
            if (eventsResp.data && eventsResp.data.length > 0) {
                extras.events = eventsResp.data.map(function(e) {
                    return { when: e.when_label, title: e.title, detail: e.detail };
                });
            }
        } catch (e) {
            console.log('[newsletter] events fetch failed (non-fatal): ' + e.message);
        }
    }

    return extras;
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

// ── Bucket classification (Architecture B, June 2026) ──────────────────────
// Split the candidate pool into three buckets BEFORE the briefing call.
// Each bucket gets its own specialist briefing call with one focused job.
// This guarantees the city quota structurally instead of asking Claude to
// honor it across many competing constraints.
//
// Categories:
//   PLACE   — articles ABOUT the city itself. Headline names a specific local
//             entity (neighborhood, transit line, named institution, etc.).
//   MONEY   — articles that hit the reader's wallet. Headline or summary
//             contains money/cost keywords. Can be national, EU, local.
//   CONTEXT — everything else. National policy, international, broader stories.
//             Acts as the catchall for stories that don't fit place/money.

var CITY_PLACE_PATTERNS = {
    berlin: /\b(berlin|brandenburg|kreuzberg|neuk[oö]lln|mitte|prenzlauer berg|charlottenburg|wedding|friedrichshain|lichtenberg|tempelhof|schöneberg|schoneberg|spandau|steglitz|treptow|köpenick|koepenick|pankow|marzahn|reinickendorf|moabit|wilmersdorf|grunewald|wannsee|potsdam|bvg|s-bahn|u-bahn|ringbahn|ber airport|bran[\s-]?denburger tor|alexanderplatz|tiergarten|reichstag|charit[eé]|sparkasse berlin|berliner senat|kai wegner|abgeordnetenhaus|berlinale|humboldt|tu berlin|fu berlin|olympiastadion|tegel|spree|kiez)\b/i,
    frankfurt: /\b(frankfurt|main|hessen|sachsenhausen|bornheim|bockenheim|westend|nordend|h[oö]chst|niederrad|offenbach|bad homburg|rmv|vgf|hauptbahnhof|fra airport|frankfurt flughafen|r[oö]mer|hauptwache|konstablerwache|main-taunus|messe frankfurt|frankfurter sparkasse|commerzbank|deutsche bank tower|ecb|europ[ae]ische zentralbank|goethe uni|boris rhein|hessen landtag)\b/i,
    bonn: /\b(bonn|bad godesberg|beuel|poppelsdorf|endenich|kessenich|tannenbusch|hardtberg|dottendorf|swb|vrs|stadtbahn|m[uü]nsterplatz|marktplatz|beethoven|poppelsdorfer schloss|un campus|rheinaue|kennedybr[uü]cke|sparkasse k[oö]lnbonn|universit[aä]t bonn|deutsche post|deutsche telekom|nrw landtag)\b/i,
};

// Money / cost keywords. Hits any of these and an article enters MONEY bucket.
var MONEY_PATTERN = /\b(euro|euros|cent|cents|miete|mieten|mietpreis|mietendeckel|wohngeld|b[uü]rgergeld|krankenkasse|krankenversicherung|steuer|steuern|steuererkl|tax|taxes|gehalt|salar(y|ies)|lohn|l[oö]hne|wage|wages|sparkasse|bank account|hypothek|mortgage|kredit|credit|bvg ticket|deutschlandticket|9[\s-]?euro|49[\s-]?euro|gas price|fuel price|petrol|gasoline|pump|strom|stromkosten|gaspreis|heizkosten|heizung|inflation|inflate|recession|rezession|gdp|bip|wirtschaft.*wachs|rent|rents|rental|cost of living|living cost|grocer|preis|preise|prices|cheaper|expensive|teurer|billiger|pension|rente|sozialversicherung|btw|vat|mwst|mehrwertsteuer|hartz|grundsicherung|kindergeld|elterngeld|wohnung.*preis|housing.*cost|verdienen|earn|paycheck|netto|brutto|netz.*entgelt|tariff|gehaltserh|payroll)\b/i;

function bucketArticles(articles, city) {
    var placePat = CITY_PLACE_PATTERNS[city] || CITY_PLACE_PATTERNS.berlin;
    var place = [], money = [], context = [];

    for (var i = 0; i < articles.length; i++) {
        var a = articles[i];
        var text = (a.headline || '') + ' ' + (a.summary || '');

        // PLACE: city-local OR headline names city/neighbourhood/transit/institution.
        // If isCityLocal flag is set, trust the source classification.
        var placeMatch = !!a.isCityLocal || placePat.test(text);

        // MONEY: headline or summary contains money keywords.
        var moneyMatch = MONEY_PATTERN.test(text);

        // Routing — Place wins over Money when both match (Place is rarer/more valuable).
        // Money wins over Context.
        if (placeMatch) {
            place.push(a);
        } else if (moneyMatch) {
            money.push(a);
        } else {
            context.push(a);
        }
    }

    return { place: place, money: money, context: context };
}

// Builds the candidate pool for a city — fetch RSS, translate, dedup, cap,
// city-filter. Same logic for both the automated briefing AND the editor
// picker. Pool from this function is what briefing.js would see, OR what the
// picker email shows you as headlines to choose from. Returning the exact
// same data ensures parity between auto and human-curated workflows.
async function buildCityPool(city) {
    city = city || 'berlin';
    var BASE = 'https://verityn-backend-ten.vercel.app';
    var sid = 'pool-' + city + '-' + Date.now();
    var cityLocalKey = city + '_local';

    var cityFetch = await fetch(BASE + '/api/content?action=rss&country=' + cityLocalKey + '&max=25&sessionId=' + sid)
        .then(function(r) { return r.json(); })
        .catch(function() { return { articles: [] }; });

    var cityLocalArticles = (cityFetch.articles && Array.isArray(cityFetch.articles)) ? cityFetch.articles : [];
    console.log('[pool] city=' + city + ' rawCityArticles=' + cityLocalArticles.length);

    var allArticles = [];
    if (cityLocalArticles.length > 0) {
        var translated = await translateArticles(cityLocalArticles);
        if (translated.length > 0) {
            allArticles = translated.map(function(a) {
                return Object.assign({}, a, { country: 'DE', isLocal: true, isCityLocal: true });
            });
        }
    }

    var beforeCap = allArticles.length;
    allArticles = dedupeSameEvent(allArticles);
    var afterDedup = allArticles.length;

    var singleSourceCities = { frankfurt: true };
    var sourceCapN = singleSourceCities[city] ? 8 : 5;
    allArticles = capPerSource(allArticles, sourceCapN);

    var afterCityFilter = allArticles.length;
    if (CITY_PLACE_PATTERNS[city]) {
        var placePat = CITY_PLACE_PATTERNS[city];
        var filtered = allArticles.filter(function(a) {
            return placePat.test(a.headline || '');
        });
        if (filtered.length >= 4) {
            console.log('[pool] city=' + city + ' cityFilter kept=' + filtered.length + ' dropped=' + (allArticles.length - filtered.length));
            allArticles = filtered;
            afterCityFilter = filtered.length;
        } else {
            console.log('[pool] city=' + city + ' cityFilter would leave only ' + filtered.length + ', keeping unfiltered pool');
        }
    }

    console.log('[pool] city=' + city + ' translatedCity=' + allArticles.length + ' poolBeforeCap=' + beforeCap + ' afterDedup=' + afterDedup + ' sourceCap=' + sourceCapN + ' afterCityFilter=' + afterCityFilter + ' poolAfterCap=' + allArticles.length);
    return allArticles;
}

async function generateFreshBriefing(supabase, city) {
    // City-keyed pipeline (May 2026 city pivot).
    // For Berlin: checks editor_queue first. If you (the editor) selected ≥5
    // articles for today's pick_date, those become the stories. Backfill quick
    // hits from the remaining pool. Skip the briefing.js call entirely.
    // Else: fall back to automated briefing on the pool.
    // For other cities (Frankfurt, Bonn): always automated.
    city = city || 'berlin';

    var BASE = 'https://verityn-backend-ten.vercel.app';
    var allArticles = await buildCityPool(city);

    if (allArticles.length < 3) {
        console.log('[newsletter] city=' + city + ' pool too small (' + allArticles.length + ') — no send');
        return null;
    }

    // ── Editor-loop check (Berlin only) ──
    // Look for picks where pick_date = today (UTC). The picker emails are
    // generated the evening before, so picks made between 22:00 Berlin yesterday
    // and 04:00 Berlin today are valid for this morning's send.
    if (city === 'berlin' && supabase) {
        try {
            var today = new Date().toISOString().slice(0, 10);
            var picksResp = await supabase
                .from('editor_queue')
                .select('headline, summary, source, url, image')
                .eq('city', 'berlin')
                .eq('pick_date', today)
                .eq('selected', true)
                .order('sort_order', { ascending: true });

            if (picksResp.data && picksResp.data.length >= 5) {
                console.log('[newsletter] city=berlin editor-loop ACTIVE, ' + picksResp.data.length + ' picks');
                var editorPicks = picksResp.data.map(function(p) {
                    return {
                        headline: p.headline,
                        summary: p.summary || '',
                        body: '',           // enrichStories writes this
                        why: '',            // enrichStories writes this
                        source: p.source,
                        sourceUrl: p.url,
                        image: p.image || null,
                    };
                });

                // Backfill remaining slots (up to 7) with Quick Hits from
                // unpicked pool articles, same logic as automated path.
                var pickedSet = {};
                editorPicks.forEach(function(s) {
                    if (s.headline) pickedSet[s.headline.toLowerCase().trim()] = true;
                });
                var quickHitsNeeded = 7 - editorPicks.length;
                if (quickHitsNeeded > 0) {
                    var leftover = allArticles.filter(function(a) {
                        var key = (a.headline || '').toLowerCase().trim();
                        return key && !pickedSet[key];
                    });
                    var quickHits = leftover.slice(0, quickHitsNeeded).map(function(a) {
                        return {
                            headline: a.headline,
                            summary: a.summary || a.description || '',
                            body: a.summary || a.description || '',
                            why: '',
                            source: a.source,
                            sourceUrl: a.url,
                            image: a.image || null,
                            isQuickHit: true,
                        };
                    });
                    console.log('[newsletter] city=berlin editor-loop backfilled ' + quickHits.length + ' quick hits');
                    return editorPicks.concat(quickHits);
                }
                return editorPicks;
            } else {
                console.log('[newsletter] city=berlin editor-loop INACTIVE (' + (picksResp.data ? picksResp.data.length : 0) + ' picks, need 5) — falling back to auto');
            }
        } catch (e) {
            console.log('[newsletter] editor-loop check failed (non-fatal, falling back): ' + e.message);
        }
    }

    // ── Automated fallback (or non-Berlin city) ──
    // Cross-day memory — pass recent headlines to briefing so it can deprioritise repeats.
    var memory = await getRecentMemory(supabase, city, 3);

    try {
        var r2 = await fetch(BASE + '/api/briefing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                articles: allArticles,
                countries: ['de'],
                interests: ['world', 'finance', 'tech', 'politics'],
                location: 'de',
                city: city,
                profession: 'professional',
                cityOnly: true,
                recentHeadlines: memory.headlines.slice(0, 14),
                sessionId: 'newsletter-' + city + '-' + new Date().toISOString().slice(0, 10),
            }),
        });
        var d2 = await r2.json();
        if (d2.stories && d2.stories.length >= 3) {
            console.log('[newsletter] city=' + city + ' picked=' + d2.stories.length);

            // Backfill with quick hits from remaining pool if briefing returned <7.
            // The first 4 stories (lead + 3 deep dives) come from briefing's editorial
            // picks. Slots 5-7 fill from leftover pool articles whose headlines aren't
            // already in the picked set. Cheaper than a second briefing call and
            // ensures Quick Hits section never empty.
            var picked = d2.stories;
            var pickedHeadlines = {};
            picked.forEach(function(s) {
                if (s.headline) pickedHeadlines[s.headline.toLowerCase().trim()] = true;
            });

            var quickHitsNeeded = 7 - picked.length;
            if (quickHitsNeeded > 0) {
                var pool = allArticles.filter(function(a) {
                    var key = (a.headline || '').toLowerCase().trim();
                    return key && !pickedHeadlines[key];
                });
                // Take up to N quick hits, formatted to look like briefing-picked stories
                // (briefing returns {headline, summary, source, sourceUrl, image, why?})
                var quickHits = pool.slice(0, quickHitsNeeded).map(function(a) {
                    return {
                        headline: a.headline,
                        summary: a.summary || a.description || '',
                        body: a.summary || a.description || '',  // truncated by buildQuickHit
                        why: '',                                     // intentionally empty for quick hits
                        source: a.source,
                        sourceUrl: a.url,
                        image: a.image || null,
                        isQuickHit: true,
                    };
                });
                console.log('[newsletter] city=' + city + ' backfilled ' + quickHits.length + ' quick hits');
                return picked.concat(quickHits);
            }
            return picked;
        } else if (d2.error) {
            console.log('[newsletter] city=' + city + ' briefing error: ' + d2.error);
        }
    } catch (e) {
        console.log('[newsletter] city=' + city + ' briefing fetch failed: ' + e.message);
    }

    return null;
}

async function enrichStories(stories, city) {
    if (!stories || !stories.length) return stories;
    city = city || 'berlin';

    // City-keyed voice (May 2026 city pivot). Each city has its own context
    // table with city-specific transit, neighborhoods, named institutions.
    // German terms remain untranslated in all cities (skill rule).
    var cityContext = {
        berlin: 'an English speaker living in Berlin. They care about: their rent (Miete) and Mietpreisbremse extensions, their commute (BVG, S-Bahn, U-Bahn, named lines like U7 or S41), their Kiez (Kreuzberg, Neukölln, Mitte, Prenzlauer Berg, Wedding, Friedrichshain), their health insurance (Krankenkasse), their visa or Niederlassungserlaubnis status, their Anmeldung at the Bürgeramt, their taxes (Steuererklärung), their savings at Sparkasse Berlin, their kids\' Kita waitlist, their Wohngeld eligibility, their Bürgergeld, the Senat of Berlin (Kai Wegner), Berliner Abgeordnetenhaus, BER airport, BVG strikes, Berlin housing market specifics. Could be expat, international student, remote worker, diplomat, journalist, English-fluent Berliner.',
        frankfurt: 'an English speaker living in Frankfurt. They care about: their rent (Miete) in Frankfurt\'s tight market (one of Germany\'s most expensive after Munich), their commute (RMV — Rhein-Main-Verkehrsverbund, VGF U-Bahn and tram, S-Bahn Rhein-Main, named lines, Hauptbahnhof, FRA airport), their Stadtteil (Sachsenhausen, Bornheim, Bockenheim, Westend, Nordend, Niederrad), their health insurance (Krankenkasse), their visa or Niederlassungserlaubnis status, their Anmeldung at the Bürgeramt, their taxes (Steuererklärung), their savings at Frankfurter Sparkasse, their kids\' Kita waitlist, their Wohngeld eligibility, their Bürgergeld, banking-sector job market (ECB, Deutsche Bank, Commerzbank), Hessen-level politics (Boris Rhein, Hessen Landtag), Messe Frankfurt events, Main-Taunus-Zentrum. Could be expat, finance professional, international student, remote worker, English-fluent Frankfurter. Don\'t assume banker — Frankfurt has plenty of non-finance residents too.',
        bonn: 'an English speaker living in Bonn. They care about: their rent (Miete) in Bonn\'s relatively tighter post-government-quarter market, their commute (SWB Bus und Bahn, VRS tariff zone, Stadtbahn lines 16/63/66/67, Deutsche Bahn to Köln), their Stadtteil (Bad Godesberg, Beuel, Poppelsdorf, Endenich, Kessenich, Tannenbusch, Hardtberg), their health insurance (Krankenkasse), their visa or Niederlassungserlaubnis status, their Anmeldung at the Bürgeramt, their taxes (Steuererklärung), their savings at Sparkasse KölnBonn, their kids\' Kita waitlist, their Wohngeld eligibility, their Bürgergeld, the UN campus and DAX-listed Deutsche Post DHL / Deutsche Telekom headquartered there, the former-capital institutions, Universität Bonn, Beethoven heritage and the Beethovenfest. Could be UN/NGO worker, civil servant, Telekom/Post employee, student, researcher, expat, English-fluent Bonner. Bonn is smaller and greener than Berlin/Frankfurt — more university-town and international-institution flavour.',
    };
    var cityNameTitle = city.charAt(0).toUpperCase() + city.slice(1);
    var context = cityContext[city] || cityContext.berlin;

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
                max_tokens: 4500,
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
        console.log('[newsletter] enrichStories: response did not match expected shape. enriched.length=' + (enriched && enriched.length) + ' stories.length=' + stories.length + ' raw=' + clean.slice(0, 300));
    } catch (e) {
        console.log('[newsletter] enrichStories: failed with error: ' + e.message + ' raw=' + (typeof text !== 'undefined' ? text.slice(0, 300) : 'no-text'));
    }
    return stories;
}

async function getSubscribers(supabase) {
    var result = await supabase
        .from('waitlist')
        .select('email, name, region, city')
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

        // ── Admin: alerts + events management ──
        // GET  /api/newsletter?action=admin&key=KEY                  → HTML page
        // POST /api/newsletter?action=admin&subaction=alerts&key=KEY → save alerts
        // POST /api/newsletter?action=admin&subaction=events&key=KEY → save events
        // ── Editor loop: 50/7 picker workflow (Berlin only) ──
        //
        // editor-generate (key-gated, cron-triggered at 22:00 Berlin):
        //   1. Build Berlin pool via buildCityPool
        //   2. Save up to 50 headlines to editor_queue with pick_date = tomorrow
        //   3. Email picker HTML to hello@verityn.news with checkboxes
        //
        // editor-select (key-gated, called by picker email form):
        //   Update selected=true on the chosen rows.
        //
        // editor-status (key-gated, debug):
        //   Return JSON of today/tomorrow's queue state.
        //
        // After cutoff (04:00 Berlin), morning send runs. generateFreshBriefing
        // for Berlin checks editor_queue first: if ≥5 selected for today, use
        // those. Else fall back to automated briefing.

        if (action === 'editor-generate') {
            var egKey = req.query.key || '';
            var egExpected = process.env.ADMIN_KEY;
            if (!egExpected || egKey !== egExpected) {
                res.statusCode = 401;
                return res.json({ ok: false, error: 'Unauthorized' });
            }
            if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
                return res.json({ ok: false, error: 'SMTP creds not set' });
            }

            try {
                // Pick_date is tomorrow's date in Berlin local. Compute as
                // (now + 1 day) in Berlin tz, formatted as YYYY-MM-DD.
                // Generation runs 22:00 Berlin → pick_date should be the next
                // calendar day (which the morning send will look up).
                var nowBerlin = new Date(Date.now() + (60 * 60 * 1000)); // approx Berlin offset Jun = UTC+2; tighter math below
                // Use a tz-aware computation: get today in Berlin, then add 1 day
                var todayBerlin = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' }); // YYYY-MM-DD
                var tomorrowDate = new Date(todayBerlin + 'T00:00:00Z');
                tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
                var pickDate = tomorrowDate.toISOString().slice(0, 10);

                console.log('[editor-generate] pick_date=' + pickDate);

                // Build Berlin pool — identical to what briefing would see
                var pool = await buildCityPool('berlin');
                if (!pool || pool.length < 5) {
                    return res.json({ ok: false, error: 'Pool too small (' + (pool ? pool.length : 0) + '). Cannot generate picker.' });
                }

                // Clear any existing queue rows for this pick_date (idempotent — rerun safely)
                await supabase
                    .from('editor_queue')
                    .delete()
                    .eq('city', 'berlin')
                    .eq('pick_date', pickDate);

                // Insert up to 50 articles
                var slice = pool.slice(0, 50);
                var rows = slice.map(function(a, i) {
                    return {
                        pick_date: pickDate,
                        city: 'berlin',
                        headline: a.headline || '',
                        summary: a.summary || '',
                        source: a.source || '',
                        url: a.url || '',
                        image: a.image || null,
                        selected: false,
                        sort_order: i,
                    };
                }).filter(function(r) { return r.headline; });

                var ins = await supabase.from('editor_queue').insert(rows).select('id, headline, source, sort_order');
                if (ins.error) throw new Error(ins.error.message);

                console.log('[editor-generate] saved ' + ins.data.length + ' rows');

                // Build picker HTML email
                var BASE = 'https://verityn-backend-ten.vercel.app';
                var submitUrl = BASE + '/api/newsletter?action=editor-select&key=' + encodeURIComponent(egKey) + '&pick_date=' + pickDate;
                var pickerHtml = buildPickerEmail(ins.data, submitUrl, pickDate);

                // Send to hello@verityn.news
                var pTransporter = getTransporter();
                try {
                    await pTransporter.sendMail({
                        from: FROM_NAME + ' <' + FROM_EMAIL + '>',
                        to: FROM_EMAIL,    // hello@verityn.news (you)
                        subject: 'Picker: pick 7 for ' + pickDate,
                        html: pickerHtml,
                    });
                    try { pTransporter.close(); } catch (e) {}
                } catch (e) {
                    try { pTransporter.close(); } catch (e2) {}
                    console.log('[editor-generate] picker email send failed: ' + e.message);
                    return res.json({ ok: false, error: 'Picker saved but email send failed: ' + e.message, savedRows: ins.data.length, pickDate: pickDate });
                }

                return res.json({ ok: true, savedRows: ins.data.length, pickDate: pickDate, emailedTo: FROM_EMAIL });
            } catch (e) {
                res.statusCode = 500;
                return res.json({ ok: false, error: e.message });
            }
        }

        if (action === 'editor-select') {
            var esKey = req.query.key || '';
            var esExpected = process.env.ADMIN_KEY;
            if (!esExpected || esKey !== esExpected) {
                res.statusCode = 401;
                return res.json({ ok: false, error: 'Unauthorized' });
            }

            try {
                var pickDateQ = req.query.pick_date || '';
                if (!/^\d{4}-\d{2}-\d{2}$/.test(pickDateQ)) {
                    return res.json({ ok: false, error: 'Invalid pick_date' });
                }

                // Picker submits as form-urlencoded checkboxes. Vercel parses JSON
                // automatically but NOT form bodies — we read+parse here.
                var bodyP = req.body && typeof req.body === 'object' ? req.body : {};
                var ids = [];

                // Try JSON shape first
                if (Array.isArray(bodyP.ids)) {
                    ids = bodyP.ids.map(function(x) { return parseInt(x, 10); }).filter(function(x) { return !isNaN(x); });
                } else if (typeof bodyP.ids === 'string') {
                    ids = bodyP.ids.split(',').map(function(x) { return parseInt(x.trim(), 10); }).filter(function(x) { return !isNaN(x); });
                } else if (Array.isArray(bodyP.pick)) {
                    ids = bodyP.pick.map(function(x) { return parseInt(x, 10); }).filter(function(x) { return !isNaN(x); });
                } else if (typeof bodyP.pick === 'string' || typeof bodyP.pick === 'number') {
                    ids = [parseInt(bodyP.pick, 10)].filter(function(x) { return !isNaN(x); });
                }

                // Fall back to manual parse if Vercel didn't parse (form body as raw string)
                if (ids.length === 0 && typeof req.body === 'string' && req.body.length > 0) {
                    var rawPairs = req.body.split('&');
                    rawPairs.forEach(function(pair) {
                        var eq = pair.indexOf('=');
                        if (eq < 0) return;
                        var k = decodeURIComponent(pair.slice(0, eq).replace(/\+/g, ' '));
                        var v = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
                        if (k === 'pick') {
                            var n = parseInt(v, 10);
                            if (!isNaN(n)) ids.push(n);
                        }
                    });
                }

                if (ids.length < 1) {
                    return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#FBF5E8"><h2>No picks received</h2><p>Go back and tick at least 5 boxes, then resubmit.</p></body></html>');
                }

                // Reset all picks for this date first (allows re-submission to overwrite)
                await supabase
                    .from('editor_queue')
                    .update({ selected: false })
                    .eq('city', 'berlin')
                    .eq('pick_date', pickDateQ);

                // Mark the chosen ids as selected
                var upd = await supabase
                    .from('editor_queue')
                    .update({ selected: true })
                    .in('id', ids)
                    .eq('pick_date', pickDateQ);

                if (upd.error) throw new Error(upd.error.message);

                console.log('[editor-select] pick_date=' + pickDateQ + ' picked=' + ids.length);

                // Confirmation HTML page
                var fallbackNote = ids.length < 5
                    ? '<p style="color:#A03A20"><strong>Heads up:</strong> only ' + ids.length + ' picked. The morning send needs at least 5 picks, so it will fall back to automated.</p>'
                    : '<p style="color:#3F6E3F"><strong>Picks locked.</strong> Tomorrow morning\'s briefing will use these ' + ids.length + ' stories.</p>';

                return res.send(
                    '<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#FBF5E8;color:#1F1810">'
                    + '<h2 style="font-family:Georgia,serif;font-weight:400">Saved.</h2>'
                    + fallbackNote
                    + '<p style="color:#7A6A50;font-size:13px">pick_date: ' + pickDateQ + '</p>'
                    + '</body></html>'
                );
            } catch (e) {
                res.statusCode = 500;
                return res.json({ ok: false, error: e.message });
            }
        }

        if (action === 'editor-status') {
            var stKey = req.query.key || '';
            var stExpected = process.env.ADMIN_KEY;
            if (!stExpected || stKey !== stExpected) {
                res.statusCode = 401;
                return res.json({ ok: false, error: 'Unauthorized' });
            }
            try {
                var todayB = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
                var qResp = await supabase
                    .from('editor_queue')
                    .select('id, pick_date, headline, source, selected, sort_order')
                    .eq('city', 'berlin')
                    .gte('pick_date', todayB)
                    .order('pick_date', { ascending: false })
                    .order('sort_order', { ascending: true });

                var byDate = {};
                (qResp.data || []).forEach(function(r) {
                    if (!byDate[r.pick_date]) byDate[r.pick_date] = { total: 0, selected: 0, headlines: [] };
                    byDate[r.pick_date].total++;
                    if (r.selected) byDate[r.pick_date].selected++;
                    byDate[r.pick_date].headlines.push({
                        id: r.id, sel: r.selected, head: (r.headline || '').slice(0, 80), src: r.source,
                    });
                });
                return res.json({ ok: true, today: todayB, queue: byDate });
            } catch (e) {
                res.statusCode = 500;
                return res.json({ ok: false, error: e.message });
            }
        }

        if (action === 'admin') {
            var adminKey = req.query.key || '';
            var expectedKey = process.env.ADMIN_KEY;
            if (!expectedKey || adminKey !== expectedKey) {
                res.statusCode = 401;
                return res.json({ ok: false, error: 'Unauthorized' });
            }

            var subaction = req.query.subaction || '';

            // GET → render admin page with current alerts + events loaded
            if (req.method === 'GET' && !subaction) {
                // City selector — defaults to berlin
                var SUPPORTED_CITIES = ['berlin', 'frankfurt', 'bonn'];
                var adminCity = (req.query.city || 'berlin').toLowerCase();
                if (SUPPORTED_CITIES.indexOf(adminCity) === -1) adminCity = 'berlin';

                var alertsResp, eventsResp;
                try {
                    alertsResp = await supabase
                        .from('active_alerts')
                        .select('text, expires_at')
                        .eq('city', adminCity)
                        .order('priority', { ascending: false });
                } catch (e) { alertsResp = { data: [] }; }
                try {
                    eventsResp = await supabase
                        .from('events')
                        .select('sort_date, when_label, title, detail')
                        .eq('city', adminCity)
                        .gte('sort_date', new Date().toISOString().slice(0, 10))
                        .order('sort_date', { ascending: true });
                } catch (e) { eventsResp = { data: [] }; }

                var alertLines = (alertsResp.data || []).map(function(a) { return a.text; }).join('\n');
                var eventLines = (eventsResp.data || []).map(function(e) {
                    return e.sort_date + ' | ' + (e.when_label || '') + ' | ' + (e.title || '') + ' | ' + (e.detail || '');
                }).join('\n');

                var k = adminKey;

                // City selector — radio buttons. Switching reloads the page with new ?city=
                var citySelector = '<div style="margin-bottom:24px;padding:14px 16px;background:#F3E9D2;border-radius:4px">'
                    + '<strong style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#7A6A50;display:block;margin-bottom:8px">Editing for city:</strong>';
                SUPPORTED_CITIES.forEach(function(c) {
                    var active = c === adminCity;
                    var label = c.charAt(0).toUpperCase() + c.slice(1);
                    var href = '/api/newsletter?action=admin&key=' + encodeURIComponent(adminKey) + '&city=' + c;
                    var style = active
                        ? 'background:#1F1810;color:#FBF5E8;padding:6px 14px;border-radius:14px;font-size:13px;font-weight:700;text-decoration:none;margin-right:6px'
                        : 'background:#fff;color:#1F1810;padding:6px 14px;border-radius:14px;font-size:13px;font-weight:500;text-decoration:none;margin-right:6px;border:1px solid #C9B98A';
                    citySelector += '<a href="' + href + '" style="' + style + '">' + label + '</a>';
                });
                citySelector += '</div>';

                var pageHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Verityn Admin</title>'
                    + '<style>body{font-family:-apple-system,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1F1810;background:#FBF5E8}'
                    + 'h1{font-family:Georgia,serif;font-size:28px;font-weight:400;border-bottom:3px solid #D14A28;padding-bottom:8px;margin-bottom:24px}'
                    + 'h2{font-family:Georgia,serif;font-size:20px;font-weight:400;color:#1F1810;margin-top:32px}'
                    + 'p{color:#5A4A30;font-size:14px;line-height:1.5}'
                    + 'textarea{width:100%;min-height:160px;padding:14px;border:1px solid #C9B98A;background:#fff;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5}'
                    + 'button{background:#1F1810;color:#FBF5E8;border:none;padding:10px 24px;font-size:14px;font-weight:600;letter-spacing:0.5px;cursor:pointer;margin-top:12px}'
                    + 'button:hover{background:#D14A28}'
                    + '.status{margin-top:12px;padding:10px 14px;border-radius:4px;display:none}'
                    + '.status.ok{background:#E6F2E0;color:#3F6E3F;display:block}'
                    + '.status.err{background:#FBE0DC;color:#A03A20;display:block}'
                    + '</style></head><body>'
                    + '<h1>Verityn Admin</h1>'
                    + citySelector
                    + '<h2>Active Alerts <span style="font-size:13px;color:#7A6A50;font-weight:400">— ' + adminCity + '</span></h2>'
                    + '<p>One alert per line. Renders as the red strip at the top of the email. Empty input = no alerts shown.</p>'
                    + '<p><strong>Example:</strong><br><code>S-Bahn S1 partial closure Wannsee&ndash;Potsdam until 18:00</code></p>'
                    + '<textarea id="alerts" placeholder="One alert per line">' + escapeHtml(alertLines) + '</textarea>'
                    + '<div><button onclick="save(\'alerts\')">Save alerts for ' + adminCity + '</button></div>'
                    + '<div class="status" id="alerts-status"></div>'
                    + '<h2>Events <span style="font-size:13px;color:#7A6A50;font-weight:400">— ' + adminCity + '</span></h2>'
                    + '<p>One event per line, pipe-separated: <code>YYYY-MM-DD | when_label | title | detail</code>. Past events auto-purged.</p>'
                    + '<p><strong>Example:</strong><br><code>2026-06-07 | Sat 7 June &middot; 13:00 &middot; Kreuzberg | Karneval der Kulturen | Free entry.</code></p>'
                    + '<textarea id="events" placeholder="YYYY-MM-DD | when_label | title | detail (one per line)">' + escapeHtml(eventLines) + '</textarea>'
                    + '<div><button onclick="save(\'events\')">Save events for ' + adminCity + '</button></div>'
                    + '<div class="status" id="events-status"></div>'
                    + '<script>'
                    + 'var key=' + JSON.stringify(k) + ';'
                    + 'var city=' + JSON.stringify(adminCity) + ';'
                    + 'async function save(kind){'
                    + '  var text=document.getElementById(kind).value;'
                    + '  var st=document.getElementById(kind+"-status");'
                    + '  st.className="status";st.textContent="Saving\u2026";'
                    + '  try{'
                    + '    var r=await fetch("/api/newsletter?action=admin&subaction="+kind+"&key="+encodeURIComponent(key)+"&city="+encodeURIComponent(city),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:text})});'
                    + '    var d=await r.json();'
                    + '    if(d.ok){st.className="status ok";st.textContent="Saved "+d.count+" rows for "+city+".";}'
                    + '    else{st.className="status err";st.textContent="Error: "+(d.error||"unknown");}'
                    + '  }catch(e){st.className="status err";st.textContent="Error: "+e.message;}'
                    + '}'
                    + '</script></body></html>';
                res.setHeader('Content-Type', 'text/html');
                return res.send(pageHtml);
            }

            // POST alerts
            if (req.method === 'POST' && subaction === 'alerts') {
                try {
                    var SUPPORTED_CITIES_A = ['berlin', 'frankfurt', 'bonn'];
                    var alertsCity = (req.query.city || 'berlin').toLowerCase();
                    if (SUPPORTED_CITIES_A.indexOf(alertsCity) === -1) alertsCity = 'berlin';

                    var b1 = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
                    var text1 = (b1.text || '').trim();
                    var lines1 = text1.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);

                    // Delete only THIS city's rows. Other cities' alerts remain.
                    await supabase.from('active_alerts').delete().eq('city', alertsCity);

                    if (lines1.length > 0) {
                        var rows1 = lines1.map(function(line, i) {
                            return { text: line, priority: lines1.length - i, expires_at: null, city: alertsCity };
                        });
                        var ins1 = await supabase.from('active_alerts').insert(rows1);
                        if (ins1.error) throw new Error(ins1.error.message);
                    }
                    return res.json({ ok: true, count: lines1.length, city: alertsCity });
                } catch (e) {
                    res.statusCode = 500;
                    return res.json({ ok: false, error: e.message });
                }
            }

            // POST events
            if (req.method === 'POST' && subaction === 'events') {
                try {
                    var SUPPORTED_CITIES_E = ['berlin', 'frankfurt', 'bonn'];
                    var eventsCity = (req.query.city || 'berlin').toLowerCase();
                    if (SUPPORTED_CITIES_E.indexOf(eventsCity) === -1) eventsCity = 'berlin';

                    var b2 = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
                    var text2 = (b2.text || '').trim();
                    var lines2 = text2.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
                    var parsed = lines2.map(function(line) {
                        var parts = line.split('|').map(function(p) { return p.trim(); });
                        if (parts.length < 3) return null;
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) return null;
                        return {
                            sort_date: parts[0],
                            when_label: parts[1] || '',
                            title: parts[2] || '',
                            detail: parts[3] || '',
                            city: eventsCity,
                        };
                    }).filter(Boolean);

                    // Delete only THIS city's events. Other cities' events remain.
                    await supabase.from('events').delete().eq('city', eventsCity);

                    if (parsed.length > 0) {
                        var ins2 = await supabase.from('events').insert(parsed);
                        if (ins2.error) throw new Error(ins2.error.message);
                    }
                    return res.json({ ok: true, count: parsed.length, city: eventsCity });
                } catch (e) {
                    res.statusCode = 500;
                    return res.json({ ok: false, error: e.message });
                }
            }

            res.statusCode = 400;
            return res.json({ ok: false, error: 'Unknown admin subaction' });
        }

        if (action === 'subscribe') {
            var body = req.body || {};
            var email = (body.email || '').trim().toLowerCase();
            if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

            var name = (body.name || email.split('@')[0]).trim();
            var timezone = body.timezone || '';
            // Germany pivot (May 2026): region stays 'de' (legacy column, may be deprecated later).
            var region = 'de';

            // City-keyed pipeline (May 2026): subscribers get their city's newsletter.
            // Read Vercel's IP-geolocation header. Normalise to a supported city slug.
            // Supported cities: berlin, frankfurt. New cities require adding feeds +
            // context in content.js, weather coords, and enrichStories cityContext.
            // Anything else falls back to berlin (largest subscriber base by default).
            var SUPPORTED_CITIES = ['berlin', 'frankfurt', 'bonn'];
            var ipCityRaw = (req.headers['x-vercel-ip-city'] || '').toLowerCase();
            var ipCity = decodeURIComponent(ipCityRaw).replace(/[^a-z]/g, '');
            // Handle common variants: "frankfurt am main" -> "frankfurt"
            if (ipCity.indexOf('frankfurt') !== -1) ipCity = 'frankfurt';
            if (ipCity.indexOf('berlin') !== -1) ipCity = 'berlin';
            if (ipCity.indexOf('bonn') !== -1) ipCity = 'bonn';
            var city = SUPPORTED_CITIES.indexOf(ipCity) !== -1 ? ipCity : 'berlin';

            // Allow explicit override from request body (manual subscribe form may
            // expose city picker later).
            if (body.city && SUPPORTED_CITIES.indexOf(body.city.toLowerCase()) !== -1) {
                city = body.city.toLowerCase();
            }

            var existing = await supabase.from('waitlist').select('id, unsubscribed').eq('email', email).limit(1);
            if (existing.data && existing.data.length > 0) {
                if (existing.data[0].unsubscribed) {
                    await supabase.from('waitlist').update({ unsubscribed: false, name: name, timezone: timezone, region: region, city: city }).eq('email', email);
                    return res.json({ ok: true, resubscribed: true, city: city });
                }
                return res.json({ ok: true, already: true });
            }

            var { error } = await supabase.from('waitlist').insert({ email: email, name: name, unsubscribed: false, timezone: timezone, region: region, city: city });
            if (error) return res.status(500).json({ error: error.message });
            return res.json({ ok: true, subscribed: true, city: city });
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
            // City-keyed pipeline (May 2026 city pivot). Use ?city=berlin or ?city=frankfurt
            // to preview that city's edition. Defaults to berlin.
            var SUPPORTED_CITIES = ['berlin', 'frankfurt', 'bonn'];
            var previewCity = (req.query.city || 'berlin').toLowerCase();
            if (SUPPORTED_CITIES.indexOf(previewCity) === -1) previewCity = 'berlin';

            var stories = await generateFreshBriefing(supabase, previewCity);
            if (!stories) return res.json({ error: 'No briefing available yet.', city: previewCity });
            stories = await enrichStories(stories, previewCity);
            var pvMemory = await getRecentMemory(supabase, previewCity, 7);
            var extras = await generateExtras(stories, previewCity, pvMemory.facts, supabase);
            extras.weather = await getWeather(previewCity);
            res.setHeader('Content-Type', 'text/html');
            return res.send(buildEmailHTML(stories, 'Reader', 'preview@example.com', extras));
        }

        if (action === 'test') {
            var testEmail = req.query.email;
            if (!testEmail) return res.json({ error: 'Add &email=your@email.com' });
            if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return res.json({ error: 'SMTP creds not set' });

            // City-keyed pipeline (May 2026): test send uses the subscriber's stored city,
            // falling back to ?city= override, then berlin.
            var SUPPORTED_CITIES = ['berlin', 'frankfurt', 'bonn'];
            var testCity = 'berlin';
            var testName = testEmail.split('@')[0];
            try {
                var lookup = await supabase.from('waitlist').select('name, city').eq('email', testEmail.toLowerCase()).limit(1);
                if (lookup.data && lookup.data.length > 0) {
                    testName = lookup.data[0].name || testName;
                    if (lookup.data[0].city && SUPPORTED_CITIES.indexOf(lookup.data[0].city) !== -1) {
                        testCity = lookup.data[0].city;
                    }
                }
            } catch (e) { }
            // Query override wins
            if (req.query.city && SUPPORTED_CITIES.indexOf(req.query.city.toLowerCase()) !== -1) {
                testCity = req.query.city.toLowerCase();
            }

            var stories2 = await generateFreshBriefing(supabase, testCity);
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
                            city: testCity,
                            interests: ['world'],
                        }),
                    });
                    var dd2 = await dr2.json();
                    return res.json({
                        error: 'Full pipeline failed. Debug info:',
                        city: testCity,
                        articlesFound: articleCount,
                        briefingResponse: dd2.error || dd2.stories ? 'got ' + (dd2.stories || []).length + ' stories' : 'unknown',
                        briefingRaw: JSON.stringify(dd2).slice(0, 500),
                    });
                } catch (debugErr) {
                    return res.json({ error: 'Full pipeline failed. Debug also failed: ' + debugErr.message, city: testCity });
                }
            }

            stories2 = await enrichStories(stories2, testCity);
            var tMemory = await getRecentMemory(supabase, testCity, 7);
            var extras2 = await generateExtras(stories2, testCity, tMemory.facts, supabase);
            extras2.weather = await getWeather(testCity);

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
                var cityLocalCount = stories2.filter(function(s) { return s.isCityLocal; }).length;
                var srcCounts = {};
                for (var sci = 0; sci < stories2.length; sci++) {
                    var sk = (stories2[sci].source || '').toLowerCase()
                        .replace(/^(www\.|feeds\.|rss\.|news\.)/, '')
                        .replace(/\.(com|org|net|co\.uk|co|io|de|fr|eu|uk|in|at|ch|jp|au|sg|ae|es|it|nl)$/, '')
                        .replace(/[-_\s]+/g, '').trim();
                    srcCounts[sk] = (srcCounts[sk] || 0) + 1;
                }
                return res.json({ ok: true, messageId: result.messageId, subject: subject, to: testEmail, name: testName, city: testCity, stories: stories2.length, localStories: localCount, cityLocalStories: cityLocalCount, sourceCounts: srcCounts });
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

            // City-keyed pipeline (May 2026 city pivot). Group subscribers by city,
            // run the briefing+enrich+extras+weather pipeline once per city present,
            // then send each subscriber their city's edition. Log one newsletter_log
            // row per city. Subscribers with unsupported/null city fall back to berlin.
            var SUPPORTED_CITIES = ['berlin', 'frankfurt', 'bonn'];
            var groups = {};
            for (var g = 0; g < subscribers.length; g++) {
                var sCity = (subscribers[g].city || 'berlin').toLowerCase();
                if (SUPPORTED_CITIES.indexOf(sCity) === -1) sCity = 'berlin';
                if (!groups[sCity]) groups[sCity] = [];
                groups[sCity].push(subscribers[g]);
            }
            var citiesPresent = Object.keys(groups);
            console.log('[newsletter] send cities=' + JSON.stringify(citiesPresent) + ' subs=' + subscribers.length);

            var totalSent = 0, totalFailed = 0;
            var resultByCity = {};
            var transporter2 = getTransporter();

            for (var ci = 0; ci < citiesPresent.length; ci++) {
                var cCity = citiesPresent[ci];
                var cSubs = groups[cCity];

                // Per-city pipeline run
                var cStories = await generateFreshBriefing(supabase, cCity);
                if (!cStories) {
                    console.log('[newsletter] city=' + cCity + ' briefing failed, skipping ' + cSubs.length + ' subscribers');
                    resultByCity[cCity] = { error: 'briefing failed', subs: cSubs.length };
                    continue;
                }
                cStories = await enrichStories(cStories, cCity);
                // Fetch recently-served facts for this city so we don't repeat one
                var cMemory = await getRecentMemory(supabase, cCity, 7);
                var cExtras = await generateExtras(cStories, cCity, cMemory.facts, supabase);
                cExtras.weather = await getWeather(cCity);
                var cSubject = buildSubjectLine(cStories);

                try { await supabase.from('newsletter_cache').insert({ stories: cStories }); } catch (e) { }

                var cSent = 0, cFailed = 0, cErrors = [];
                for (var i = 0; i < Math.min(cSubs.length, BATCH_SIZE); i++) {
                    var sub = cSubs[i];
                    try {
                        await transporter2.sendMail({
                            from: FROM_NAME + ' <' + FROM_EMAIL + '>',
                            to: sub.email,
                            subject: cSubject,
                            html: buildEmailHTML(cStories, sub.name || sub.email.split('@')[0], sub.email, cExtras),
                        });
                        cSent++;
                    } catch (e) {
                        cFailed++;
                        cErrors.push({ email: sub.email, error: e.message });
                    }
                    if (i > 0 && i % 5 === 0) await new Promise(function(r) { setTimeout(r, 2000); });
                }

                totalSent += cSent;
                totalFailed += cFailed;
                resultByCity[cCity] = { sent: cSent, failed: cFailed, subject: cSubject };

                // One log row per city — subject prefixed [city] for grep-ability
                try {
                    await supabase.from('newsletter_log').insert({
                        sent_count: cSent, failed_count: cFailed,
                        errors: cErrors.length > 0 ? cErrors : null,
                        subject: '[' + cCity + '] ' + cSubject,
                        story_count: cStories.length,
                    });
                } catch (e) { }

                // Write to memory so tomorrow's send can dedup against today.
                // Only record if we actually sent something.
                if (cSent > 0) {
                    await writeMemory(supabase, cCity, cStories, cExtras.did_you_know || '');
                }
            }

            try { transporter2.close(); } catch (e) { }

            return res.json({
                ok: true,
                sent: totalSent,
                failed: totalFailed,
                total: subscribers.length,
                cities: resultByCity,
            });
        }

        return res.json({ actions: 'subscribe, unsubscribe, preview, test, send' });
    } catch (e) {
        return res.json({ error: e.message });
    }
};
