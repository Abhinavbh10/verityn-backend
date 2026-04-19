// ============================================================
// FILE: api/cron.js
// PURPOSE: Cache warming + topic thread generation + cleanup
// Runs: GitHub Actions every 3h + Vercel cron 5am UTC daily
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { cleanupRateLimits, logError } = require('./_helpers');

const COUNTRIES = ['in', 'us', 'gb', 'de', 'au', 'sg', 'ae', 'jp'];

// Fix #23: Defensive VERCEL_URL — strip protocol if accidentally included
const rawUrl = process.env.VERCEL_URL || 'verityn-backend-ten.vercel.app';
const VERCEL_URL = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;

// Fix #20: Non-English headline filter (same logic as content.js)
const NON_LATIN_SCRIPT = /[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;
const GERMAN_MARKER = /\b(der|die|das|und|ist|für|mit|nicht|auch|sich|sind|wurde|werden|einen|einer|eines|schon|zwischen|während|beschlüsse|koalition|wirtschaft|regierung)\b/i;
function isEnglishHeadline(title) {
  if (!title) return false;
  if (NON_LATIN_SCRIPT.test(title)) return false;
  const germanHits = (title.match(new RegExp(GERMAN_MARKER.source, 'gi')) || []).length;
  if (germanHits >= 2) return false;
  return true;
}

// ── Entity map for topic clustering ──────────────────────────
const ENTITY_MAP = {
  'iran':'iran','iranian':'iran','irans':'iran',
  'israel':'israel','israeli':'israel','israelis':'israel',
  'ukraine':'ukraine','ukrainian':'ukraine',
  'russia':'russia','russian':'russia',
  'china':'china','chinese':'china',
  'india':'india','indian':'india',
  'germany':'germany','german':'germany',
  'france':'france','french':'france',
  'america':'america','american':'america','us':'america',
  'britain':'uk','british':'uk','england':'uk',
  'australia':'australia','australian':'australia',
  'japan':'japan','japanese':'japan',
  'korea':'korea','korean':'korea',
  'taiwan':'taiwan','taiwanese':'taiwan',
  'pakistan':'pakistan','saudi':'saudi',
  'europe':'europe','european':'europe',
  'nato':'nato','gaza':'gaza','hamas':'hamas',
  'trump':'trump','biden':'biden','modi':'modi','putin':'putin',
  'zelensky':'zelensky','netanyahu':'netanyahu','xi':'xi',
  'macron':'macron','scholz':'scholz',
  'congress':'congress','parliament':'parliament','senate':'senate',
  'election':'election','elections':'election',
  'fed':'fed','rbi':'rbi','ecb':'ecb',
  'inflation':'inflation','inflationary':'inflation',
  'recession':'recession','gdp':'gdp',
  'oil':'oil','opec':'opec','crude':'oil',
  'rate':'rates','rates':'rates','interest':'rates',
  'market':'markets','markets':'markets','stocks':'stocks',
  'dollar':'dollar','rupee':'rupee','euro':'euro',
  'bank':'banking','banking':'banking',
  'tariff':'tariffs','tariffs':'tariffs','trade':'trade',
  'ai':'ai','artificial':'ai',
  'chip':'chips','chips':'chips','semiconductor':'chips',
  'nvidia':'nvidia','openai':'openai','google':'google',
  'apple':'apple','microsoft':'microsoft','meta':'meta',
  'cyber':'cyber','cybersecurity':'cyber',
  'climate':'climate','emissions':'climate','carbon':'climate',
  'energy':'energy','solar':'energy','renewable':'energy',
  'war':'war','conflict':'conflict','ceasefire':'ceasefire',
  'sanctions':'sanctions','nuclear':'nuclear',
  'strait':'hormuz','hormuz':'hormuz',
};

function getEntities(headline) {
  const words = (headline || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  return [...new Set(words.map(w => ENTITY_MAP[w]).filter(Boolean))].sort();
}

function makeTopicLabel(entities) {
  const labelMap = {
    'iran':'Iran','israel':'Israel','ukraine':'Ukraine','russia':'Russia',
    'china':'China','india':'India','germany':'Germany','france':'France',
    'america':'United States','trump':'Trump','biden':'Biden','modi':'Modi',
    'putin':'Putin','nato':'NATO','gaza':'Gaza','hamas':'Hamas',
    'pakistan':'Pakistan','uk':'UK','oil':'Oil Prices','rates':'Interest Rates',
    'markets':'Markets','chips':'Semiconductors','ai':'Artificial Intelligence',
    'climate':'Climate','trade':'Trade','tariffs':'Tariffs','hormuz':'Strait of Hormuz',
    'ceasefire':'Ceasefire Talks','nuclear':'Nuclear','sanctions':'Sanctions',
    'banking':'Banking','dollar':'US Dollar','google':'Google','nvidia':'Nvidia',
    'openai':'OpenAI','microsoft':'Microsoft','cyber':'Cybersecurity','energy':'Energy',
    'election':'Elections','zelensky':'Zelensky','netanyahu':'Netanyahu',
    'saudi':'Saudi Arabia','australia':'Australia','europe':'Europe',
    'japan':'Japan','korea':'Korea','taiwan':'Taiwan','inflation':'Inflation',
    'fed':'Federal Reserve','rbi':'RBI',
  };
  return entities.slice(0, 3)
    .map(e => labelMap[e] || e.charAt(0).toUpperCase() + e.slice(1))
    .join(' & ');
}

function clusterArticles(articles) {
  const ENTITY_PRIORITY = [
    'iran','israel','ukraine','russia','china','india','germany','france',
    'trump','putin','modi','zelensky','netanyahu',
    'fed','oil','ai','chips','markets','rates','inflation','tariffs','trade',
    'nato','nuclear','sanctions','war','ceasefire','hormuz',
    'climate','energy','election','congress','america','uk','australia','japan','korea'
  ];
  function dominantEntity(entities) {
    for (const p of ENTITY_PRIORITY) { if (entities.includes(p)) return p; }
    return entities[0] || null;
  }
  const tagged = articles
    .map(a => ({ article: a, entities: getEntities(a.headline) }))
    .filter(ae => ae.entities.length > 0)
    .map(ae => ({ ...ae, dominant: dominantEntity(ae.entities) }))
    .filter(ae => ae.dominant);
  const clusters = {};
  for (const ae of tagged) {
    const key = ae.dominant;
    if (!clusters[key]) {
      clusters[key] = { key, label: makeTopicLabel([key]), articles: [], sources: new Set() };
    }
    if (!clusters[key].articles.find(a => a.headline === ae.article.headline)) {
      clusters[key].articles.push(ae.article);
      clusters[key].sources.add(ae.article.source || 'Unknown');
    }
  }
  return Object.values(clusters)
    .filter(c => c.articles.length >= 2)
    .sort((a, b) => b.articles.length - a.articles.length);
}

function parseRssHeadlines(xml, sourceName) {
  const items = xml.match(/<item[^>]*>[\s\S]*?<\/item>/g) || [];
  return items.slice(0, 15).map(item => {
    const title = (item.match(/<title[^>]*>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/title>/) || [])[1] || '';
    return { headline: title.trim(), source: sourceName, url: '' };
  }).filter(a => a.headline.length > 10);
}

// ── Main handler ─────────────────────────────────────────────
module.exports = async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');

  const cronSecret = process.env.CRON_SECRET;
  const authBearer = request.headers.authorization;
  const xCronSecret = request.headers['x-cron-secret'];
  if (cronSecret && authBearer !== `Bearer ${cronSecret}` && xCronSecret !== cronSecret) {
    return response.status(401).json({ error: 'Unauthorized' });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const GNEWS_KEY = process.env.GNEWS_API_KEY;
  const NYT_KEY = process.env.NYT_API_KEY;
  const GUARDIAN_KEY = process.env.GUARDIAN_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const results = { cacheWarmed: [], threadsGenerated: [], errors: [], debug: {} };

  // ── Step 0: Cleanup old rate limits (Fix #17) ──────────────
  try {
    await cleanupRateLimits(supabase);
  } catch (e) {
    results.errors.push('rate-limit-cleanup: ' + e.message);
  }

  // ── Step 1: Cache warming ─────────────────────────────────
  // Fix #19: Use 'cron' as sessionId so it doesn't compete with user rate limits
  try {
    for (const country of COUNTRIES) {
      try {
        await fetch(`${VERCEL_URL}/api/content?action=news&country=${country}&category=general&max=10&sessionId=cron`);
        await fetch(`${VERCEL_URL}/api/content?action=rss&country=${country}&category=general&max=15&sessionId=cron`);
        results.cacheWarmed.push(country);
      } catch (e) {
        results.errors.push(`cache-${country}: ${e.message}`);
      }
    }
  } catch (e) {
    results.errors.push(`cache-warming: ${e.message}`);
    await logError(supabase, { endpoint: 'cron', action: 'cache-warming', error: e });
  }

  // ── Step 2: Topic thread generation ──────────────────────
  try {
    const countries = ['us', 'gb', 'in', 'de', 'au', 'sg', 'ae'];

    const headlineFetches = [
      ...countries.map(c =>
        fetch(`https://gnews.io/api/v4/top-headlines?category=general&lang=en&country=${c}&max=10&apikey=${GNEWS_KEY}`)
          .then(r => r.json())
          .then(d => (d.articles || []).map(a => ({
            headline: (a.title || '').replace(/<[^>]+>/g, '').trim(),
            source: a.source?.name || 'Unknown', url: a.url,
          }))).catch(() => [])
      ),
      ...(NYT_KEY ? ['world', 'politics', 'business', 'technology'].map(section =>
        fetch(`https://api.nytimes.com/svc/topstories/v2/${section}.json?api-key=${NYT_KEY}`)
          .then(r => r.json())
          .then(d => (d.results || []).slice(0, 15).map(a => ({
            headline: (a.title || '').trim(),
            source: 'New York Times', url: a.url,
          }))).catch(() => [])
      ) : []),
      ...(GUARDIAN_KEY ? ['world', 'politics', 'business', 'technology'].map(section =>
        fetch(`https://content.guardianapis.com/${section}?api-key=${GUARDIAN_KEY}&page-size=15`)
          .then(r => r.json())
          .then(d => (d.response?.results || []).map(a => ({
            headline: (a.webTitle || '').trim(),
            source: 'The Guardian', url: a.webUrl,
          }))).catch(() => [])
      ) : []),
      fetch('https://feeds.bbci.co.uk/news/world/rss.xml', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }, signal: AbortSignal.timeout(8000) })
        .then(r => r.text()).then(x => parseRssHeadlines(x, 'BBC')).catch(() => []),
      fetch('https://rss.dw.com/xml/rss-en-all', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }, signal: AbortSignal.timeout(8000) })
        .then(r => r.text()).then(x => parseRssHeadlines(x, 'DW')).catch(() => []),
      fetch('https://www.aljazeera.com/xml/rss/all.xml', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }, signal: AbortSignal.timeout(8000) })
        .then(r => r.text()).then(x => parseRssHeadlines(x, 'Al Jazeera')).catch(() => []),
      fetch('https://feeds.reuters.com/reuters/topNews', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }, signal: AbortSignal.timeout(8000) })
        .then(r => r.text()).then(x => parseRssHeadlines(x, 'Reuters')).catch(() => []),
      fetch('https://economictimes.indiatimes.com/rssfeedstopstories.cms', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }, signal: AbortSignal.timeout(8000) })
        .then(r => r.text()).then(x => parseRssHeadlines(x, 'Economic Times')).catch(() => []),
    ];

    const allResults = await Promise.all(headlineFetches);
    let allArticles = allResults.flat();

    // Fix #20: Filter non-English headlines before clustering
    allArticles = allArticles.filter(a => isEnglishHeadline(a.headline));

    results.debug.sourceCounts = { total: allArticles.length };

    const seen = new Set();
    const unique = allArticles.filter(a => {
      const k = (a.headline || '').slice(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!k || seen.has(k)) return false;
      seen.add(k); return true;
    });

    const clusters = clusterArticles(unique);
    results.debug.totalArticles = unique.length;
    results.debug.clustersFound = clusters.map(c => ({
      key: c.key, label: c.label, count: c.articles.length,
      sample: c.articles[0]?.headline?.slice(0, 50),
    }));

    const today = new Date().toISOString().slice(0, 10);

    for (const cluster of clusters.slice(0, 20)) {
      try {
        let existing = null;
        try {
          const { data } = await supabase
            .from('topic_threads').select('id')
            .eq('topic_key', cluster.key).eq('event_date', today).single();
          existing = data;
        } catch (e) {}

        if (existing) continue;

        const headlines = cluster.articles.slice(0, 5)
          .map(a => `- ${a.headline} (${a.source || 'Unknown'})`)
          .join('\n');

        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 80,
            system: 'Write one crisp sentence describing what happened today with this news topic. Past tense. Specific. No fluff. Under 20 words.',
            messages: [{
              role: 'user',
              content: `Topic: ${cluster.label}\n\nToday's headlines:\n${headlines}\n\nOne sentence — what happened today:`,
            }],
          }),
        });

        const claudeData = await claudeRes.json();
        const eventText = claudeData.content?.[0]?.text?.trim();

        if (!eventText) continue;

        await supabase.from('topic_threads').upsert({
          topic_key: cluster.key,
          topic_label: cluster.label,
          event_date: today,
          event_text: eventText,
          sources: [...cluster.sources].slice(0, 5),
        }, { onConflict: 'topic_key,event_date' });

        results.threadsGenerated.push(cluster.label);

      } catch (e) {
        results.errors.push(`thread-${cluster.key}: ${e.message}`);
        await logError(supabase, { endpoint: 'cron', action: `thread-${cluster.key}`, error: e });
      }
    }

    // Clean up entries older than 7 days
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    try { await supabase.from('topic_threads').delete().lt('event_date', cutoff); } catch (e) {}

    // Fix #21: Daily summary generation REMOVED — mood bar no longer exists in the app

  } catch (e) {
    results.errors.push(`thread-generation: ${e.message}`);
    await logError(supabase, { endpoint: 'cron', action: 'thread-generation', error: e });
  }

  return response.status(200).json({
    success: true,
    runAt: new Date().toISOString(),
    debug: results.debug || {},
    ...results,
  });
};
