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
  // Countries & regions
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
  // Leaders
  'trump':'trump','biden':'biden','modi':'modi','putin':'putin',
  'zelensky':'zelensky','netanyahu':'netanyahu','xi':'xi',
  'macron':'macron','scholz':'scholz',
  // Institutions
  'congress':'congress','parliament':'parliament','senate':'senate',
  'election':'election','elections':'election',
  // Finance & Economy
  'fed':'fed','rbi':'rbi','ecb':'ecb',
  'inflation':'inflation','inflationary':'inflation',
  'recession':'recession','gdp':'gdp',
  'oil':'oil','opec':'opec','crude':'oil',
  'rate':'rates','rates':'rates','interest':'rates',
  'market':'markets','markets':'markets','stocks':'stocks',
  'dollar':'dollar','rupee':'rupee','euro':'euro',
  'bank':'banking','banking':'banking',
  'tariff':'tariffs','tariffs':'tariffs','trade':'trade',
  // Tech
  'ai':'ai','artificial':'ai',
  'chip':'chips','chips':'chips','semiconductor':'chips',
  'nvidia':'nvidia','openai':'openai','google':'google',
  'apple':'apple','microsoft':'microsoft','meta':'meta',
  'cyber':'cyber','cybersecurity':'cyber',
  // Climate & Energy
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
    'oil':        'Oil Prices', 'rates':      'Interest Rates',
    'markets':    'Markets', 'chips':       'Semiconductors',
    'ai':         'Artificial Intelligence', 'climate':    'Climate',
    'trade':      'Trade', 'tariffs':     'Tariffs',
    'hormuz':     'Strait of Hormuz', 'ceasefire':  'Ceasefire Talks',
    'nuclear':    'Nuclear', 'sanctions':   'Sanctions',
    'banking':    'Banking', 'dollar':      'US Dollar',
    'google':     'Google', 'nvidia':       'Nvidia',
    'openai':     'OpenAI', 'microsoft':    'Microsoft',
    'cyber':      'Cybersecurity', 'energy':      'Energy',
    'election':   'Elections', 'zelensky':    'Zelensky',
    'netanyahu':  'Netanyahu', 'saudi':       'Saudi Arabia',
    'australia':  'Australia', 'europe':      'Europe',
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
  // ── Union-Find clustering — articles sharing any entity belong to same story ──
  const articleEntities = articles.map(a => ({
    article: a,
    entities: getEntities(a.headline),
  })).filter(ae => ae.entities.length > 0);

  // Union-Find helpers
  const parent = articleEntities.map((_, i) => i);
  function find(i) { return parent[i] === i ? i : (parent[i] = find(parent[i])); }
  function union(i, j) { parent[find(i)] = find(j); }

  // Merge articles that share any entity into the same cluster
  for (let i = 0; i < articleEntities.length; i++) {
    for (let j = i + 1; j < articleEntities.length; j++) {
      const shared = articleEntities[i].entities.filter(e => articleEntities[j].entities.includes(e));
      if (shared.length >= 1) union(i, j);
    }
  }

  // Group articles by cluster root
  const groups = {};
  for (let i = 0; i < articleEntities.length; i++) {
    const root = find(i);
    if (!groups[root]) groups[root] = [];
    groups[root].push(articleEntities[i]);
  }

  // Priority list — first matching entity becomes the cluster label
  const ENTITY_PRIORITY = [
    'iran','israel','ukraine','russia','china','india','germany','france',
    'trump','putin','modi','zelensky','netanyahu',
    'fed','oil','ai','chips','markets','rates','inflation','tariffs','trade',
    'nato','nuclear','sanctions','war','ceasefire','hormuz',
    'climate','energy','election'
  ];

  function dominantEntity(entities) {
    for (const p of ENTITY_PRIORITY) { if (entities.includes(p)) return p; }
    return entities[0] || 'world';
  }

  // Build final clusters keyed by dominant entity
  const clusters = {};
  for (const group of Object.values(groups)) {
    const allEntities = [...new Set(group.flatMap(ae => ae.entities))];
    const dominant    = dominantEntity(allEntities);
    const key         = dominant;
    if (!clusters[key]) {
      clusters[key] = { key, label: makeTopicLabel([dominant]), articles: [], sources: new Set() };
    }
    for (const ae of group) {
      if (!clusters[key].articles.find(a => a.headline === ae.article.headline)) {
        clusters[key].articles.push(ae.article);
        clusters[key].sources.add(ae.article.source || 'Unknown');
      }
    }
  }

  // Return clusters with 2+ articles (genuine momentum), sorted by volume
  return Object.values(clusters)
    .filter(c => c.articles.length >= 2)
    .sort((a, b) => b.articles.length - a.articles.length);
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
    const NYT_KEY      = process.env.NYT_API_KEY;
    const GUARDIAN_KEY = process.env.GUARDIAN_API_KEY;

    const countries   = ['us', 'gb', 'in', 'de', 'au', 'sg', 'ae'];
    const headlineFetches = [
      // GNews per country
      ...countries.map(c =>
        fetch(`https://gnews.io/api/v4/top-headlines?category=general&lang=en&country=${c}&max=10&apikey=${GNEWS_KEY}`)
          .then(r => r.json())
          .then(d => (d.articles || []).map(a => ({
            headline: (a.title || '').replace(/<[^>]+>/g, '').trim(),
            source:   a.source?.name || 'Unknown',
            url:      a.url,
          })))
          .catch(() => [])
      ),
      // NYT world section — rich source for global topics
      NYT_KEY ? fetch(`https://api.nytimes.com/svc/topstories/v2/world.json?api-key=${NYT_KEY}`)
        .then(r => r.json())
        .then(d => (d.results || []).slice(0, 20).map(a => ({
          headline: (a.title || '').trim(),
          source:   'New York Times',
          url:      a.url,
        })))
        .catch(() => []) : Promise.resolve([]),
      // Guardian world section
      GUARDIAN_KEY ? fetch(`https://content.guardianapis.com/world?api-key=${GUARDIAN_KEY}&show-fields=trailText&page-size=20`)
        .then(r => r.json())
        .then(d => (d.response?.results || []).map(a => ({
          headline: (a.webTitle || '').trim(),
          source:   'The Guardian',
          url:      a.webUrl,
        })))
        .catch(() => []) : Promise.resolve([]),
    ];

    const allResults  = await Promise.all(headlineFetches);
    const allArticles = allResults.flat();
    // Debug: count per source
    const gNewsCount    = allResults.slice(0, countries.length).flat().length;
    const nytCount      = NYT_KEY ? (allResults[countries.length] || []).length : 0;
    const guardianCount = GUARDIAN_KEY ? (allResults[countries.length + (NYT_KEY ? 1 : 0)] || []).length : 0;
    results.debug.sourceCounts = { gnews: gNewsCount, nyt: nytCount, guardian: guardianCount };

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
    results.debug.allClusters = clusterArticles(unique).map(c => ({ key: c.key, label: c.label, count: c.articles.length }));
    results.debug.sampleHeadlines = unique.slice(0, 5).map(a => a.headline);
    results.debug.clustersFound = clusters.map(c => ({
      key: c.key,
      label: c.label,
      count: c.articles.length,
      sample: c.articles[0]?.headline?.slice(0, 50),
    }));
    const today    = new Date().toISOString().slice(0, 10);

    for (const cluster of clusters.slice(0, 20)) { // max 20 topics per run
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
      // Filter to substantive topics only before summarising
      const SUMMARY_TOPICS = ['world','politics','finance','tech','climate'];
      function inferBasicTopic(headline) {
        const t = headline.toLowerCase();
        if (/\biran\b|\bisrael\b|\bwar\b|\bstrike\b|\bcrisis\b|\bconflict\b|\bnato\b|\belection\b|\bminister\b|\bpresident\b|\bparliament\b|\bsanction\b/.test(t)) return 'politics';
        if (/\bmarket\b|\bstock\b|\bfed\b|\binflation\b|\bgdp\b|\brate\b|\bbank\b|\boil\b|\beconom\b|\btrade\b|\bbudget\b/.test(t)) return 'finance';
        if (/\bai\b|\btech\b|\bchip\b|\bsoftware\b|\bcyber\b|\bdigital\b|\bstartup\b/.test(t)) return 'tech';
        if (/\bclimate\b|\benergy\b|\bemission\b|\brenewable\b|\benvironment\b/.test(t)) return 'climate';
        if (/\bsport\b|\bcar\b|\bfilm\b|\bmusic\b|\bcelebrit\b|\brecipe\b|\btravel\b|\bfashion\b|\bfootball\b|\bcricket\b|\bnba\b|\bnfl\b/.test(t)) return 'skip';
        return 'world';
      }
      const substantive = unique
        .filter(a => inferBasicTopic(a.headline) !== 'skip')
        .slice(0, 8);
      const topHeadlines = (substantive.length > 0 ? substantive : unique.slice(0, 8))
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
          system:     'Write one sharp editorial sentence summarising the most important world, political, or economic developments. Confident, intelligent tone. Under 25 words. No sports, entertainment, or lifestyle. No "today" or "this morning". Start with the dominant serious theme.',
          messages:   [{ role: 'user', content: `Headlines: ${topHeadlines}\n\nOne sentence:` }],
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
