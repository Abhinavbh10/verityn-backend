// api/briefing.js — Standalone briefing endpoint
// Bypasses ai.js entirely. Self-contained. No _helpers dependency.
const { createClient } = require('@supabase/supabase-js');

const COUNTRY_NAMES = {
    de: 'Germany', in: 'India', us: 'United States', gb: 'United Kingdom',
    au: 'Australia', sg: 'Singapore', ae: 'UAE', jp: 'Japan',
};

const COUNTRY_KEYWORDS = {
    de: 'germany german berlin frankfurt dax bundesbank scholz merz',
    in: 'india indian delhi mumbai rbi sensex nifty rupee modi',
    us: 'america american united states washington fed nasdaq trump',
    gb: 'britain british uk england london ftse sterling pound',
    au: 'australia australian sydney melbourne asx reserve bank',
    sg: 'singapore singaporean mas',
    ae: 'uae dubai abu dhabi emirates gulf',
    jp: 'japan japanese tokyo nikkei yen',
};

function escapeForLog(obj) {
    try { return JSON.stringify(obj).slice(0, 500); } catch (e) { return String(obj); }
}

function parseJSON(raw) {
    try { return JSON.parse(raw); } catch (e) {}
    try { return JSON.parse(raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()); } catch (e) {}
    try { var m = raw.match(/[\[{][\s\S]*[\]}]/); if (m) return JSON.parse(m[0]); } catch (e) {}
    return null;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        var ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
        if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

        var params = req.method === 'POST' ? (req.body || {}) : {};
        var articles = params.articles || [];
        var countries = params.countries || ['de'];
        var interests = params.interests || [];
        var location = params.location || null;
        var profession = params.profession || null;
        var sessionId = params.sessionId || 'anonymous';

        if (!Array.isArray(articles)) articles = [];
        if (!Array.isArray(countries)) countries = [countries];
        if (!Array.isArray(interests)) interests = typeof interests === 'string' ? interests.split(',') : [];

        var pool = articles.slice(0, 40);
        if (pool.length === 0) return res.status(400).json({ error: 'No articles provided.' });

        var locationStr = location
            ? (COUNTRY_NAMES[location] || location)
            : countries.map(function(c) { return COUNTRY_NAMES[c] || c.toUpperCase(); }).join(', ');
        var interestStr = interests.length ? interests.join(', ') : 'world news';
        var professionStr = profession || null;

        // Tag articles
        var GLOBAL_RE = /\bwar\b|\bnuclear\b|\bsanctions\b|\bnato\b|\bopec\b|\bg7\b|\bg20\b|\bun\b|\bclimate summit\b|\bglobal\b|\bworld\b/i;
        var userKeywords = countries.map(function(c) { return (COUNTRY_KEYWORDS[c] || '').split(' '); })
            .reduce(function(a, b) { return a.concat(b); }, [])
            .filter(function(k) { return k.length > 0; });

        var headlinesList = pool.map(function(a, i) {
            var text = ((a.headline || '') + ' ' + (a.summary || '').slice(0, 200)).toLowerCase();
            var matchesUser = userKeywords.some(function(kw) { return kw.length > 2 && text.indexOf(kw) >= 0; });
            var isGlobal = GLOBAL_RE.test(text);
            var tag = matchesUser ? 'RELEVANT' : isGlobal ? 'GLOBAL' : 'CHECK_RELEVANCE';
            return (i + 1) + '. [' + tag + '] ' + (a.headline || 'No headline') + ' | ' + (a.source || 'Unknown') + ' | ' + (a.image ? 'HAS_IMAGE' : 'NO_IMAGE');
        }).join('\n');

        var system = 'You are a news editor creating a personalised intelligence briefing. '
            + 'You write as a knowledgeable friend explaining events to a fellow professional. '
            + 'Use plain, direct English. No passive voice. No definitive predictions. '
            + 'Never state future outcomes as certain facts. Never give financial, legal, or medical advice. '
            + 'Always attribute specific numbers to their source.';

        var prompt = 'You are editing a personal briefing for a professional living in ' + locationStr
            + ', interested in ' + interestStr
            + (professionStr ? ', working in ' + professionStr : '') + '.\n\n'
            + 'RELEVANCE RULES:\n'
            + '1. At least 4 of the 7 stories MUST directly involve or meaningfully affect ' + locationStr + '.\n'
            + '2. The remaining stories may be global but must connect to ' + interestStr + '.\n'
            + '3. NEVER include celebrity news, sports scores, lifestyle, or entertainment unless the user follows those topics.\n\n'
            + 'Select exactly 7 stories. All 7 carry equal weight.\n'
            + 'DIVERSITY: Cover at least 3 different topic areas.\n'
            + 'SOURCE DIVERSITY: Max 2 stories from the same source.\n'
            + 'PREFER articles marked HAS_IMAGE.\n\n'
            + 'For each story write a "why" — EXACTLY 2 sentences, 25-35 words total:\n'
            + 'Sentence 1: The specific impact on YOU — the reader living in ' + locationStr
            + (professionStr ? ' working in ' + professionStr : '')
            + '. Use "your" not "this affects." Use a number, timeframe, or concrete consequence. NEVER restate the headline.\n'
            + 'Sentence 2: What YOU should watch or do — a forward-looking signal, date, or decision point.\n'
            + 'Never give financial, legal, or investment advice.\n\n'
            + 'Also write a "mood" sentence (under 20 words) summarising today\'s news tone.\n\n'
            + 'Respond ONLY with valid JSON — no markdown, no explanation:\n'
            + '{"mood":"one sentence","stories":[{"index":1,"why":"2-sentence why-line"},{"index":3,"why":"..."}]}\n\n'
            + 'Articles:\n' + headlinesList;

        // Call Claude
        var claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 800,
                system: system,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        var claudeData = await claudeRes.json();

        if (claudeData.error) {
            return res.status(500).json({ error: 'Claude error: ' + (claudeData.error.message || JSON.stringify(claudeData.error)) });
        }

        var rawText = (claudeData.content && claudeData.content[0] && claudeData.content[0].text) || '';
        var parsed = parseJSON(rawText);

        if (!parsed || !parsed.stories || parsed.stories.length < 7) {
            return res.status(500).json({
                error: 'Insufficient stories from Claude',
                storiesCount: parsed ? (parsed.stories ? parsed.stories.length : 0) : 0,
                rawPreview: rawText.slice(0, 300),
            });
        }

        // Map why-lines back to articles
        var briefingStories = parsed.stories
            .filter(function(s) { return s.index >= 1 && s.index <= pool.length && s.why; })
            .map(function(s) {
                var article = pool[s.index - 1];
                return {
                    id: article.id || ('story-' + s.index),
                    headline: article.headline,
                    summary: article.summary,
                    source: article.source,
                    sourceUrl: article.sourceUrl,
                    image: article.image,
                    publishedAt: article.publishedAt,
                    time: article.time,
                    topic: article.topic,
                    country: article.country,
                    why: s.why,
                };
            })
            .filter(function(s) { return s && s.headline; });

        // Cache in Supabase
        try {
            var supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
            var cacheResult = { mood: parsed.mood, stories: briefingStories };
            await supabase.from('newsletter_cache').insert({ stories: briefingStories, mood: parsed.mood });
        } catch (e) {}

        return res.status(200).json({
            success: true,
            fromCache: false,
            mood: parsed.mood,
            stories: briefingStories,
        });

    } catch (e) {
        return res.status(500).json({
            error: 'Briefing error: ' + (e.message || String(e)),
            stack: (e.stack || '').split('\n').slice(0, 4),
        });
    }
};
