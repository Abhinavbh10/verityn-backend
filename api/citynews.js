// ============================================================
// FILE: api/citynews.js
// PURPOSE: Return city-specific articles for the Home briefing.
// Fetches from The Local DE city feeds. Caches 1h in Supabase to avoid
// hammering Local DE on every app open.
//
// USAGE:
//   GET /api/citynews?city=berlin&max=15
//
// Returns: { success, articles: [...], fromCache }
// Each article carries sourceCity = the requested city. HomeScreen mixes
// these with nationwide articles before sending to briefing.js.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { logError } = require('./_helpers');

// Map app city ids → The Local DE city feed URLs.
// Düsseldorf, Cologne, Stuttgart, Leipzig — Local DE has no dedicated feed
// for these. We accept the request but return empty (HomeScreen falls back
// to nationwide-only for those users until we add more sources).
const CITY_FEEDS = {
    berlin: 'https://feeds.thelocal.com/rss/de/berlin',
    munich: 'https://feeds.thelocal.com/rss/de/munich',
    hamburg: 'https://feeds.thelocal.com/rss/de/hamburg',
    frankfurt: 'https://feeds.thelocal.com/rss/de/frankfurt',
};

const SOURCE_NAMES = {
    berlin: 'The Local Berlin',
    munich: 'The Local Munich',
    hamburg: 'The Local Hamburg',
    frankfurt: 'The Local Frankfurt',
};

function parseRss(xml) {
    const items = xml.match(/<item[^>]*>[\s\S]*?<\/item>/g) || [];
    return items.slice(0, 25).map((item) => {
        const title = (item.match(/<title[^>]*>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/title>/) || [])[1] || '';
        const desc = (item.match(/<description[^>]*>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/description>/) || [])[1] || '';
        const link = (item.match(/<link[^>]*>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/link>/) || [])[1] || '';
        const pubDate = (item.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/) || [])[1] || '';
        const enclosure = (item.match(/<enclosure[^>]*url="([^"]+)"/) || [])[1] || '';
        let publishedAt;
        try { publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(); }
        catch (e) { publishedAt = new Date().toISOString(); }
        return {
            headline: title.trim(),
            summary: desc.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
            sourceUrl: link.trim(),
            image: enclosure || null,
            publishedAt,
        };
    }).filter(a => a.headline.length > 10);
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { city = '', max = '15' } = req.query;
    const cityKey = String(city).toLowerCase().trim();
    const maxN = Math.min(25, Math.max(1, parseInt(max) || 15));
    const feedUrl = CITY_FEEDS[cityKey];

    // Unknown city or 'all' — return empty, HomeScreen falls back to nationwide
    if (!feedUrl) {
        return res.status(200).json({
            success: true,
            articles: [],
            reason: cityKey ? 'no_feed_for_city' : 'no_city_provided',
        });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const cacheKey = `citynews-${cityKey}`;

    // Try cache first (1h TTL)
    try {
        const { data: cached } = await supabase
            .from('digest_cache')
            .select('digest')
            .eq('cache_key', cacheKey)
            .gt('expires_at', new Date().toISOString())
            .single();
        if (cached?.digest?.articles?.length) {
            return res.status(200).json({
                success: true,
                fromCache: true,
                articles: cached.digest.articles.slice(0, maxN),
            });
        }
    } catch (e) {}

    // Fetch fresh
    try {
        const r = await fetch(feedUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
            signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) {
            return res.status(200).json({ success: true, articles: [], reason: `feed_${r.status}` });
        }
        const xml = await r.text();
        const parsed = parseRss(xml);
        const sourceName = SOURCE_NAMES[cityKey] || 'The Local';

        const articles = parsed.map((a, i) => ({
            id: `city-${cityKey}-${Date.now()}-${i}`,
            headline: a.headline,
            summary: a.summary,
            source: sourceName,
            sourceUrl: a.sourceUrl,
            image: a.image,
            publishedAt: a.publishedAt,
            time: '',
            country: 'DE',
            sourceCity: cityKey,
            isLocal: true,
            topic: 'world',
        }));

        // Cache 1h
        try {
            const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
            await supabase.from('digest_cache').upsert({
                cache_key: cacheKey,
                digest: { articles },
                expires_at: expiresAt,
            }, { onConflict: 'cache_key' });
        } catch (e) {}

        return res.status(200).json({
            success: true,
            fromCache: false,
            articles: articles.slice(0, maxN),
        });
    } catch (e) {
        await logError(supabase, { endpoint: 'citynews', action: 'fetch', error: e, sessionId: 'system' });
        return res.status(200).json({ success: true, articles: [], error: e.message });
    }
};
