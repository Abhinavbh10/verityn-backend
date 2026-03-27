// ============================================================
// FILE: api/cron.js
// PURPOSE: Cache warming + topic thread generation
// Runs: 5am UTC and 5pm UTC daily
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const COUNTRIES     = ['in', 'us', 'gb', 'de', 'au', 'sg', 'ae', 'jp'];
const VERCEL_URL    = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://verityn-backend-ten.vercel.app';

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
  'america':'america','american':'america',
  'trump':'trump','biden':'biden','modi':'modi','putin':'putin',
  'nato':'nato','gaza':'gaza','hamas':'hamas',
  'pakistan':'pakistan','britain':'uk','british':'uk',
  'japan':'japan','japanese':'japan',
  'korea':'korea','korean':'korea',
  'taiwan':'taiwan','taiwanese':'taiwan',
  'congress':'congress','parliament':'parliament',
  'election':'election','elections':'election',
  'fed':'fed','rbi':'rbi','inflation':'inflation',
};

function getEntities(headline) {
  const words = (headline || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  return [...new Set(words.map(w => ENTITY_MAP[w]).filter(Boolean))].sort();
}

function makeTopicKey(entities) {
  return entities.slice(0, 3).join('+');
}

function makeTopicLabel(entities) {
  const labelMap = {
    'iran':       'Iran', 'israel':     'Israel',
    'ukraine':    'Ukraine', 'russia':  'Russia',
    'china':      'China', 'india':     'India',
    'germany':    'Germany', 'france':  'France',
    'america':    'United States', 'trump': 'Trump',
    'biden':      'Biden', 'modi':      'Modi',
    'putin':      'Putin', 'nato':      'NATO',
    'gaza':       'Gaza', 'hamas':      'Hamas',
    'pakistan':   'Pakistan', 'uk':      'UK',
    'japan':      'Japan', 'korea':     'Korea',
    'taiwan':     'Taiwan', 'election':  'Elections',
    'inflation':  'Inflation', 'fed':    'Federal Reserve',
    'rbi':        'RBI',
  };
  return entities.slice(0, 3)
    .map(e => labelMap[e] || e.charAt(0).toUpperCase() + e.slice(1))
    .join(' & ');
}

// ── Cluster articles by topic ─────────────────────────────────
function clusterArticles(articles) {
  const clusters = {};
  for (const article of articles) {
    const entities = getEntities(article.headline);
    if (entities.length < 2) continue; // need at least 2 entities
    const key = makeTopicKey(entities);
    if (!clusters[key]) {
      clusters[key] = {
        key,
        label:    makeTopicLabel(entities),
        articles: [],
        sources:  new Set(),
      };
    }
    clusters[key].articles.push(article);
    clusters[key].sources.add(article.source || 'Unknown');
  }
  // Only return clusters with 3+ articles (genuinely hot)
  return Object.values(clusters).filter(c => c.articles.length >= 2);
}

// ── Main handler ─────────────────────────────────────────────
module.exports = async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');

  const cronSecret    = process.env.CRON_SECRET;
  const authBearer    = request.headers.authorization;
  const xCronSecret   = request.headers['x-cron-secret'];
  const validBearer   = authBearer === `Bearer ${cronSecret}`;
  const validXHeader  = xCronSecret === cronSecret;
  if (cronSecret && !validBearer && !validXHeader) {
    return response.status(401).json({ error: 'Unauthorized' });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const GNEWS_KEY     = process.env.GNEWS_API_KEY;
  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY;
  const supabase      = createClient(SUPABASE_URL, SUPABASE_KEY);

  const results = { cacheWarmed: [], threadsGenerated: [], errors: [], debug: {} };

  // ── Step 1: Cache warming ─────────────────────────────────
  try {
    for (const country of COUNTRIES) {
      try {
        await fetch(`${VERCEL_URL}/api/content?action=news&country=${country}&category=general&max=10`);
        await fetch(`${VERCEL_URL}/api/content?action=rss&country=${country}&category=general&max=15`);
        results.cacheWarmed.push(country);
      } catch (e) {
        results.errors.push(`cache-${country}: ${e.message}`);
      }
    }
  } catch (e) {
    results.errors.push(`cache-warming: ${e.message}`);
  }

  // ── Step 2: Topic thread generation ──────────────────────
  try {
    // Fetch headlines from key countries
    // Fetch directly from GNews — don't call own API (unreliable in serverless)
    const countries   = ['us', 'gb', 'in', 'de', 'au', 'sg', 'ae'];
    const headlineFetches = countries.map(c =>
      fetch(`https://gnews.io/api/v4/top-headlines?category=general&lang=en&country=${c}&max=10&apikey=${GNEWS_KEY}`)
        .then(r => r.json())
        .then(d => (d.articles || []).map(a => ({
          headline: (a.title || '').replace(/<[^>]+>/g, '').trim(),
          source:   a.source?.name || 'Unknown',
          url:      a.url,
        })))
        .catch(() => [])
    );

    const allResults  = await Promise.all(headlineFetches);
    const allArticles = allResults.flat();

    // Deduplicate headlines
    const seen    = new Set();
    const unique  = allArticles.filter(a => {
      const k = (a.headline || '').slice(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!k || seen.has(k)) return false;
      seen.add(k); return true;
    });

    // Cluster into hot topics
    const clusters = clusterArticles(unique);
    results.debug.totalArticles = unique.length;
    results.debug.sampleHeadlines = unique.slice(0, 5).map(a => a.headline);
    results.debug.clustersFound = clusters.map(c => ({
      key: c.key,
      label: c.label,
      count: c.articles.length,
      sample: c.articles[0]?.headline?.slice(0, 50),
    }));
    const today    = new Date().toISOString().slice(0, 10);

    for (const cluster of clusters.slice(0, 15)) { // max 15 topics per run
      try {
        // Check if already generated today
        let existing = null;
        try {
          const { data } = await supabase
            .from('topic_threads')
            .select('id')
            .eq('topic_key', cluster.key)
            .eq('event_date', today)
            .single();
          existing = data;
        } catch (e) {}

        if (existing) continue; // already done today

        // Generate one-sentence event description via Claude
        const headlines = cluster.articles.slice(0, 5)
          .map(a => `- ${a.headline} (${a.source || 'Unknown'})`)
          .join('\n');

        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method:  'POST',
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model:      'claude-sonnet-4-20250514',
            max_tokens: 80,
            system:     'Write one crisp sentence describing what happened today with this news topic. Past tense. Specific. No fluff. Under 20 words.',
            messages:   [{
              role:    'user',
              content: `Topic: ${cluster.label}\n\nToday's headlines:\n${headlines}\n\nOne sentence — what happened today:`,
            }],
          }),
        });

        const claudeData = await claudeRes.json();
        const eventText  = claudeData.content?.[0]?.text?.trim();

        if (!eventText) continue;

        // Store in Supabase
        await supabase.from('topic_threads').upsert({
          topic_key:   cluster.key,
          topic_label: cluster.label,
          event_date:  today,
          event_text:  eventText,
          sources:     [...cluster.sources].slice(0, 5),
        }, { onConflict: 'topic_key,event_date' });

        results.threadsGenerated.push(cluster.label);

      } catch (e) {
        results.errors.push(`thread-${cluster.key}: ${e.message}`);
      }
    }

    // Clean up entries older than 7 days
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    try {
      await supabase.from('topic_threads')
        .delete()
        .lt('event_date', cutoff);
    } catch (e) {}

    // ── Generate "Today in Brief" summary sentence ───────────
    try {
      const topHeadlines = unique.slice(0, 8)
        .map(a => a.headline).join('; ');
      const summaryRes = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      'claude-sonnet-4-20250514',
          max_tokens: 80,
          system:     'Write one editorial sentence summarising the mood of today\'s news. Confident, intelligent tone. Under 25 words. No clichés. No "today" or "this morning". Start with the most important theme.',
          messages:   [{ role: 'user', content: `Top headlines: ${topHeadlines}\n\nOne sentence:` }],
        }),
      });
      const summaryData = await summaryRes.json();
      const summaryText = summaryData.content?.[0]?.text?.trim();
      if (summaryText) {
        await supabase.from('digest_cache').upsert({
          cache_key:  'daily-summary',
          digest:     { summary: summaryText },
          fetched_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'cache_key' });
        results.threadsGenerated.push('daily-summary');
      }
    } catch (e) {
      results.errors.push('daily-summary: ' + e.message);
    }

  } catch (e) {
    results.errors.push(`thread-generation: ${e.message}`);
  }

  return response.status(200).json({
    success: true,
    runAt:   new Date().toISOString(),
    debug:   results.debug || {},
    ...results,
  });
};
