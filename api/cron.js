// ============================================================
// FILE: api/cron.js
// PURPOSE: Cache warming + topic thread generation + cleanup
// Runs: GitHub Actions every 3h + Vercel cron 5am UTC daily
//
// GERMANY-ONLY: Verityn is now focused on news for English speakers
// living in Germany. Multi-country fetching has been removed.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { cleanupRateLimits, logError } = require('./_helpers');

// Single-country product. Kept as array for code-shape compatibility with
// existing /api/content?country=de calls.
const COUNTRIES = ['de'];

// Fix #23: Defensive VERCEL_URL — strip protocol if accidentally included
const rawUrl = process.env.VERCEL_URL || 'verityn-backend-ten.vercel.app';
const VERCEL_URL = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;

// Non-English headline filter (same logic as content.js)
const NON_LATIN_SCRIPT = /[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;
const GERMAN_MARKER = /\b(der|die|das|und|ist|für|mit|nicht|auch|sich|sind|wurde|werden|einen|einer|eines|schon|zwischen|während|beschlüsse|koalition|wirtschaft|regierung)\b/i;
const FRENCH_MARKER = /\b(les|des|une|est|sont|pour|dans|avec|cette|par|sur|aux|qui|ont|ses|mais|leur|selon|après|avant|lors|entre|plus|vers|peut|fait|été|très|tous|dont|sans|comme|depuis|nous|vous|aussi|deux|sous|encore|autre|même|chez)\b/i;
const SPANISH_MARKER = /\b(los|las|una|del|por|con|para|más|pero|como|está|son|han|fue|desde|entre|sobre|todo|esta|ese|otro|puede|tiene|también|según)\b/i;
function isEnglishHeadline(title) {
  if (!title) return false;
  if (NON_LATIN_SCRIPT.test(title)) return false;
  const germanHits = (title.match(new RegExp(GERMAN_MARKER.source, 'gi')) || []).length;
  if (germanHits >= 2) return false;
  const frenchHits = (title.match(new RegExp(FRENCH_MARKER.source, 'gi')) || []).length;
  if (frenchHits >= 2) return false;
  const spanishHits = (title.match(new RegExp(SPANISH_MARKER.source, 'gi')) || []).length;
  if (spanishHits >= 2) return false;
  return true;
}

// ── Germany-relevance filter ────────────────────────────────
// Drops articles that are clearly about another country with no German angle.
// Applied before clustering to keep topic_threads focused on Germany expat life.
const GERMANY_KEYWORDS = /\b(germany|german|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|düsseldorf|leipzig|dresden|bremen|hannover|bundestag|bundesrat|bundesregierung|bundesbank|bundesliga|bundeswehr|cdu|csu|spd|fdp|grünen|gruene|greens|afd|merz|scholz|habeck|lindner|baerbock|wagenknecht|weidel|söder|soeder|deutsche bahn|lufthansa|volkswagen|bmw|mercedes|siemens|sap|bayer|allianz|dax|krankenkasse|bürgergeld|buergergeld|mietpreisbremse|heizungsgesetz|energiewende|tagesschau|tagesspiegel|spiegel|faz|sueddeutsche|süddeutsche|the local|dw|deutsche welle|euro|ezb|ecb|european central bank|eu|european union|brussels|strasbourg)\b/i;
const STRONG_FOREIGN = /\b(india|indian|delhi|mumbai|bangalore|chennai|kolkata|sensex|nifty|rupee|modi|bjp|china|chinese|beijing|shanghai|xi jinping|japan|japanese|tokyo|nikkei|yen|korea|korean|seoul|saudi arabia|riyadh|dubai|abu dhabi|emirates|brazil|brazilian|mexico|mexican|argentina|chile|nigeria|kenya|south africa|australia|sydney|melbourne|asx|new zealand|wellington)\b/i;

function isGermanyRelevant(title, summary) {
  const text = ((title || '') + ' ' + (summary || '')).toLowerCase();
  // Strong Germany/EU signal — keep
  if (GERMANY_KEYWORDS.test(text)) return true;
  // Otherwise check if it's primarily about a foreign country
  if (STRONG_FOREIGN.test(text)) return false;
  // Generic global stories (Trump, Iran, war, climate, AI, Ukraine, Russia, US Fed, Israel, Gaza, NATO)
  // — pass through; clustering will pair them with Germany-relevant entities if they have one
  return true;
}

// ── Entity map for topic clustering ──────────────────────────
const ENTITY_MAP = {
  // ── German political institutions ──
  'bundestag':'bundestag','bundesrat':'bundesrat',
  'bundesregierung':'germany','bundeskanzler':'germany','chancellor':'germany',
  'bundeswehr':'bundeswehr',

  // ── German parties ──
  'cdu':'cdu','csu':'csu','spd':'spd','fdp':'fdp',
  'grünen':'greens','greens':'greens','gruene':'greens',
  'afd':'afd','linke':'linke','die linke':'linke','bsw':'bsw',

  // ── German politicians ──
  'merz':'merz','scholz':'scholz','habeck':'habeck','lindner':'lindner',
  'baerbock':'baerbock','wagenknecht':'wagenknecht','weidel':'weidel',
  'söder':'soeder','soeder':'soeder','steinmeier':'steinmeier',

  // ── German policy / law ──
  'bürgergeld':'buergergeld','buergergeld':'buergergeld',
  'mietpreisbremse':'housing-policy','mietendeckel':'housing-policy',
  'heizungsgesetz':'heizungsgesetz','wärmepumpe':'energy','waermepumpe':'energy',
  'energiewende':'energy','klimageld':'climate-policy',
  'mindestlohn':'mindestlohn','tarifvertrag':'tarif','tarif':'tarif',
  'kurzarbeit':'kurzarbeit','elterngeld':'elterngeld','kindergeld':'kindergeld',

  // ── Bureaucracy / paperwork ──
  'anmeldung':'anmeldung','bürgeramt':'buergeramt','buergeramt':'buergeramt',
  'krankenkasse':'krankenkasse','krankenversicherung':'krankenkasse',
  'gkv':'krankenkasse','tk':'krankenkasse','aok':'krankenkasse','barmer':'krankenkasse',
  'rentenversicherung':'rente','rente':'rente','altersvorsorge':'rente',
  'finanzamt':'tax','steuer':'tax','steuererklärung':'tax','steuererklaerung':'tax',
  'gez':'gez','rundfunkbeitrag':'gez',

  // ── Visa / residency ──
  'aufenthaltstitel':'visa','niederlassungserlaubnis':'visa','niederlassung':'visa',
  'einbürgerung':'visa','einbuergerung':'visa','naturalization':'visa',
  'aufenthalt':'visa','arbeitserlaubnis':'visa',

  // ── German cities ──
  'berlin':'berlin','münchen':'munich','munich':'munich','muenchen':'munich',
  'hamburg':'hamburg','frankfurt':'frankfurt',
  'köln':'cologne','cologne':'cologne','koeln':'cologne',
  'stuttgart':'stuttgart','düsseldorf':'duesseldorf','duesseldorf':'duesseldorf',
  'leipzig':'leipzig','dresden':'dresden','bremen':'bremen','hannover':'hannover',
  'nürnberg':'nuremberg','nuremberg':'nuremberg',

  // ── German transport ──
  'bahn':'db','autobahn':'autobahn',
  'bvg':'bvg','s-bahn':'s-bahn','u-bahn':'u-bahn',
  'lufthansa':'lufthansa','flixbus':'flixbus',

  // ── German unions / strikes ──
  'verdi':'verdi','ver.di':'verdi',
  'ig metall':'ig-metall','igmetall':'ig-metall',
  'streik':'strike','strike':'strike','gdl':'gdl',

  // ── German companies ──
  'volkswagen':'volkswagen','vw':'volkswagen',
  'bmw':'bmw','mercedes':'mercedes','mercedes-benz':'mercedes',
  'siemens':'siemens','sap':'sap','bayer':'bayer',
  'allianz':'allianz','deutsche bank':'deutsche-bank','commerzbank':'commerzbank',
  'porsche':'porsche','adidas':'adidas','puma':'puma',

  // ── German economy terms ──
  'dax':'dax','mittelstand':'mittelstand','bundesbank':'bundesbank',

  // ── EU ──
  'eu':'eu','european union':'eu','europäische union':'eu',
  'ezb':'ecb','ecb':'ecb','european central bank':'ecb',
  'european commission':'eu-commission','european parliament':'eu-parliament',
  'brussels':'eu','strasbourg':'eu',

  // ── Bundesliga / football clubs ──
  'bundesliga':'bundesliga','bayern':'bayern','dortmund':'dortmund','bvb':'dortmund',
  'leverkusen':'leverkusen','schalke':'schalke','rb leipzig':'leipzig-fc',

  // ── Existing global entities (kept — they pair with German entities) ──
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
  'japan':'japan','japanese':'japan',
  'pakistan':'pakistan','saudi':'saudi',
  'europe':'europe','european':'europe',
  'nato':'nato','gaza':'gaza','hamas':'hamas',
  'trump':'trump','biden':'biden','putin':'putin','zelensky':'zelensky',
  'netanyahu':'netanyahu','xi':'xi','macron':'macron',
  'congress':'congress','parliament':'parliament','senate':'senate',
  'election':'election','elections':'election',
  'fed':'fed',
  'inflation':'inflation','recession':'recession','gdp':'gdp',
  'oil':'oil','opec':'opec','crude':'oil',
  'rate':'rates','rates':'rates','interest':'rates',
  'market':'markets','markets':'markets','stocks':'stocks',
  'dollar':'dollar','euro':'euro',
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
  'tesla':'tesla','spacex':'spacex','amazon':'amazon',
  'ryanair':'ryanair',
};

// ── Entities too broad to stand alone — must be paired with a secondary ──
// Includes country-only entities (germany, france, etc.) and very generic
// concepts (markets, banking) — these need a specific secondary entity to
// form a meaningful topic cluster.
const BROAD_ENTITIES = new Set([
  'germany','france','india','china','japan','korea','saudi',
  'australia','uk','europe','america','pakistan','russia',
  'markets','banking','europe','eu',
]);

function getEntities(headline) {
  const text = (headline || '').toLowerCase();
  const found = new Set();

  // Multi-word entities checked first (e.g. "deutsche bahn", "ig metall")
  // before single-word tokenization so they're not split apart.
  for (const [key, val] of Object.entries(ENTITY_MAP)) {
    if (key.includes(' ') || key.includes('-') || key.includes('.')) {
      if (text.includes(key)) found.add(val);
    }
  }

  // Single-word matches via tokenization
  const words = text.replace(/[^a-zäöüß0-9\s]/g, ' ').split(/\s+/);
  for (const w of words) {
    if (ENTITY_MAP[w]) found.add(ENTITY_MAP[w]);
  }

  return [...found].sort();
}

function makeTopicLabel(entities) {
  const labelMap = {
    // German labels
    'bundestag':'Bundestag','bundesrat':'Bundesrat','bundeswehr':'Bundeswehr',
    'cdu':'CDU','csu':'CSU','spd':'SPD','fdp':'FDP',
    'greens':'Grüne','afd':'AfD','linke':'Die Linke','bsw':'BSW',
    'merz':'Merz','scholz':'Scholz','habeck':'Habeck','lindner':'Lindner',
    'baerbock':'Baerbock','wagenknecht':'Wagenknecht','weidel':'Weidel',
    'soeder':'Söder','steinmeier':'Steinmeier',
    'buergergeld':'Bürgergeld','housing-policy':'Rent Cap',
    'heizungsgesetz':'Heating Law','energy':'Energy',
    'mindestlohn':'Minimum Wage','tarif':'Wage Talks','kurzarbeit':'Kurzarbeit',
    'elterngeld':'Elterngeld','kindergeld':'Kindergeld',
    'anmeldung':'Anmeldung','buergeramt':'Bürgeramt',
    'krankenkasse':'Krankenkasse','rente':'Pension','tax':'Tax & Finanzamt','gez':'Rundfunkbeitrag',
    'visa':'Visa & Residency',
    'berlin':'Berlin','munich':'Munich','hamburg':'Hamburg','frankfurt':'Frankfurt',
    'cologne':'Cologne','stuttgart':'Stuttgart','duesseldorf':'Düsseldorf',
    'leipzig':'Leipzig','dresden':'Dresden','bremen':'Bremen','hannover':'Hannover','nuremberg':'Nuremberg',
    'db':'Deutsche Bahn','autobahn':'Autobahn','bvg':'BVG','s-bahn':'S-Bahn','u-bahn':'U-Bahn',
    'lufthansa':'Lufthansa','flixbus':'FlixBus',
    'verdi':'Verdi','ig-metall':'IG Metall','strike':'Strike','gdl':'GDL',
    'volkswagen':'Volkswagen','bmw':'BMW','mercedes':'Mercedes','siemens':'Siemens',
    'sap':'SAP','bayer':'Bayer','allianz':'Allianz','porsche':'Porsche',
    'deutsche-bank':'Deutsche Bank','commerzbank':'Commerzbank','adidas':'Adidas','puma':'Puma',
    'dax':'DAX','mittelstand':'Mittelstand','bundesbank':'Bundesbank',
    'eu':'EU','ecb':'ECB','eu-commission':'EU Commission','eu-parliament':'EU Parliament',
    'bundesliga':'Bundesliga','bayern':'Bayern Munich','dortmund':'Dortmund',
    'leverkusen':'Leverkusen','schalke':'Schalke','leipzig-fc':'RB Leipzig',
    'climate-policy':'Climate Policy',

    // Global (kept)
    'iran':'Iran','israel':'Israel','ukraine':'Ukraine','russia':'Russia',
    'china':'China','india':'India','germany':'Germany','france':'France',
    'america':'United States','trump':'Trump','biden':'Biden','putin':'Putin',
    'nato':'NATO','gaza':'Gaza','hamas':'Hamas','pakistan':'Pakistan','uk':'UK',
    'oil':'Oil Prices','rates':'Interest Rates','markets':'Markets',
    'chips':'Semiconductors','ai':'Artificial Intelligence','climate':'Climate',
    'trade':'Trade','tariffs':'Tariffs','ceasefire':'Ceasefire','nuclear':'Nuclear',
    'sanctions':'Sanctions','banking':'Banking','dollar':'US Dollar','euro':'Euro',
    'google':'Google','nvidia':'Nvidia','openai':'OpenAI','microsoft':'Microsoft',
    'apple':'Apple','meta':'Meta','tesla':'Tesla','amazon':'Amazon','ryanair':'Ryanair',
    'cyber':'Cybersecurity','election':'Elections','zelensky':'Zelensky','netanyahu':'Netanyahu',
    'saudi':'Saudi Arabia','europe':'Europe','japan':'Japan','korea':'Korea',
    'inflation':'Inflation','fed':'Federal Reserve','recession':'Recession','gdp':'GDP',
    'macron':'Macron','xi':'Xi','war':'War','conflict':'Conflict','spacex':'SpaceX',
  };
  return entities.slice(0, 3)
    .map(e => labelMap[e] || e.charAt(0).toUpperCase() + e.slice(1))
    .join(' & ');
}

// ── Cluster articles by entity-pair signature ────────────────
// Broad entities (countries, "markets") MUST be paired with a specific
// secondary entity, otherwise the article is dropped from clustering.
function clusterArticles(articles) {
  const ENTITY_PRIORITY = [
    // Germany-specific (highest priority — these are the stories we want)
    'buergergeld','housing-policy','heizungsgesetz','energy','mindestlohn',
    'krankenkasse','visa','strike','tax','rente','anmeldung','tarif',
    'bundestag','bundesrat','cdu','spd','fdp','greens','afd','linke','bsw',
    'merz','scholz','habeck','lindner','weidel','soeder','wagenknecht',
    // Cities (specific city-level stories)
    'berlin','munich','hamburg','frankfurt','cologne','stuttgart','leipzig',
    'duesseldorf','dresden','bremen','hannover',
    // German transport
    'db','bvg','s-bahn','lufthansa','verdi','ig-metall','gdl',
    // German companies
    'volkswagen','bmw','mercedes','siemens','sap','bayer','allianz','porsche',
    'deutsche-bank','adidas',
    // German football
    'bundesliga','bayern','dortmund','leverkusen','leipzig-fc',
    // EU
    'eu','ecb','eu-commission',
    // Existing global priorities (lower)
    'iran','israel','ukraine','russia','china','india','germany','france',
    'trump','putin','modi','zelensky','netanyahu',
    'fed','oil','ai','chips','markets','rates','inflation','tariffs','trade',
    'nato','nuclear','sanctions','war','ceasefire',
    'climate','election','congress','america','uk','japan','korea',
    'tesla','spacex','nvidia','openai','google','apple','microsoft','meta','amazon','ryanair',
  ];

  function rankedTop(entities, n) {
    const ranked = [];
    for (const p of ENTITY_PRIORITY) {
      if (entities.includes(p) && !ranked.includes(p)) ranked.push(p);
      if (ranked.length >= n) break;
    }
    for (const e of entities) {
      if (!ranked.includes(e)) ranked.push(e);
      if (ranked.length >= n) break;
    }
    return ranked;
  }

  const tagged = articles
    .map(a => ({ article: a, entities: getEntities(a.headline) }))
    .filter(ae => ae.entities.length > 0);

  const clusters = {};
  for (const ae of tagged) {
    const top = rankedTop(ae.entities, 2);
    const dominant = top[0];
    const secondary = top[1] || null;
    if (!dominant) continue;

    let key;
    if (BROAD_ENTITIES.has(dominant)) {
      // Broad entity — drop article unless we have a specific secondary
      if (!secondary || BROAD_ENTITIES.has(secondary)) continue;
      key = [dominant, secondary].sort().join('+');
    } else {
      // Specific entity — pair with secondary if available, else stand alone
      key = secondary && !BROAD_ENTITIES.has(secondary)
        ? [dominant, secondary].sort().join('+')
        : dominant;
    }

    if (!clusters[key]) {
      clusters[key] = {
        key,
        label: makeTopicLabel(key.split('+')),
        articles: [],
        sources: new Set(),
      };
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
    const desc = (item.match(/<description[^>]*>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/description>/) || [])[1] || '';
    return {
      headline: title.trim(),
      summary: desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
      source: sourceName,
      url: '',
    };
  }).filter(a => a.headline.length > 10);
}

// ── Detect "while X while Y" fusion in generated text ────────
function isFusedSentence(text) {
  if (!text) return false;
  const whileCount = (text.match(/\bwhile\b/gi) || []).length;
  if (whileCount >= 2) return true;
  if (/\bwhile\b[\s\S]{1,80}\bas\b/i.test(text) && /\bwhile\b/i.test(text)) {
    const words = text.split(/\s+/);
    const whileIdx = words.findIndex(w => /while/i.test(w));
    const asIdx = words.findIndex(w => /^as$/i.test(w));
    if (whileIdx !== -1 && asIdx !== -1 && Math.abs(whileIdx - asIdx) < 12) return true;
  }
  return false;
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

  const results = { cacheWarmed: [], threadsGenerated: [], threadsSkipped: [], errors: [], debug: {} };

  // ── Step 0: Cleanup old rate limits ────────────────────────
  try {
    await cleanupRateLimits(supabase);
  } catch (e) {
    results.errors.push('rate-limit-cleanup: ' + e.message);
  }

  // ── Step 1: Cache warming (Germany only) ───────────────────
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
  // Sources: Germany-focused English outlets (The Local DE, Berlin Spectator,
  // POLITICO Europe, DW), plus global wires (NYT/Guardian/Reuters/BBC) where
  // Germany-relevant stories surface. German-language outlets translated
  // happen via the newsletter pipeline, not here.
  try {
    const headlineFetches = [
      // GNews — Germany-specific English headlines
      fetch(`https://gnews.io/api/v4/top-headlines?category=general&lang=en&country=de&max=10&apikey=${GNEWS_KEY}`)
        .then(r => r.json())
        .then(d => (d.articles || []).map(a => ({
          headline: (a.title || '').replace(/<[^>]+>/g, '').trim(),
          summary: (a.description || '').replace(/<[^>]+>/g, '').trim().slice(0, 300),
          source: a.source?.name || 'Unknown', url: a.url,
        }))).catch(() => []),

      // NYT Europe section + general world (for Germany-relevant global stories)
      ...(NYT_KEY ? ['world', 'business'].map(section =>
        fetch(`https://api.nytimes.com/svc/topstories/v2/${section}.json?api-key=${NYT_KEY}`)
          .then(r => r.json())
          .then(d => (d.results || []).slice(0, 15).map(a => ({
            headline: (a.title || '').trim(),
            summary: (a.abstract || '').trim().slice(0, 300),
            source: 'New York Times', url: a.url,
          }))).catch(() => [])
      ) : []),

      // Guardian Europe + business
      ...(GUARDIAN_KEY ? ['world', 'business'].map(section =>
        fetch(`https://content.guardianapis.com/${section}?api-key=${GUARDIAN_KEY}&page-size=15`)
          .then(r => r.json())
          .then(d => (d.response?.results || []).map(a => ({
            headline: (a.webTitle || '').trim(),
            summary: '',
            source: 'The Guardian', url: a.webUrl,
          }))).catch(() => [])
      ) : []),

      // BBC Europe RSS — better Germany coverage than BBC World
      fetch('https://feeds.bbci.co.uk/news/world/europe/rss.xml', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'BBC')).catch(() => []),

      // DW (Deutsche Welle) English — flagship German news in English
      fetch('https://rss.dw.com/xml/rss-en-all', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'Deutsche Welle')).catch(() => []),

      // The Local DE — direct expat-life coverage in English
      fetch('https://feeds.thelocal.de/rss/de', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'The Local')).catch(() => []),

      // Berlin Spectator — English-language Berlin & Germany news
      fetch('https://berlinspectator.com/feed/', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'Berlin Spectator')).catch(() => []),

      // POLITICO Europe — EU politics and policy that affects Germany
      fetch('https://www.politico.eu/feed/', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'POLITICO Europe')).catch(() => []),

      // Reuters Top News — global wire with Germany stories
      fetch('https://feeds.reuters.com/reuters/topNews', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'Reuters')).catch(() => []),
    ];

    const allResults = await Promise.all(headlineFetches);
    let allArticles = allResults.flat();

    // Filter non-English headlines
    allArticles = allArticles.filter(a => isEnglishHeadline(a.headline));

    // Filter for Germany-relevance — drop articles primarily about other countries
    const beforeRelevance = allArticles.length;
    allArticles = allArticles.filter(a => isGermanyRelevant(a.headline, a.summary));

    results.debug.sourceCounts = {
      total: allArticles.length,
      droppedNonGermany: beforeRelevance - allArticles.length,
    };

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
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Pre-fetch yesterday's threads for dedup context
    const yesterdayMap = {};
    try {
      const { data: yesterdayThreads } = await supabase
        .from('topic_threads').select('topic_key, event_text')
        .eq('event_date', yesterday);
      for (const t of (yesterdayThreads || [])) {
        yesterdayMap[t.topic_key] = t.event_text;
      }
    } catch (e) {
      // non-fatal
    }

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

        const yesterdayText = yesterdayMap[cluster.key] || null;

        const systemPrompt = `You write one crisp past-tense sentence about a specific news story affecting people living in Germany. Under 22 words. Specific facts.

CRITICAL RULES:
- The sentence describes ONE event only. NEVER fuse two unrelated events with "while", "as", or "and".
- If the headlines cover multiple unrelated stories, pick the single most important one and ignore the rest.
- If today's headlines don't materially advance the story (i.e. they restate yesterday's news), respond with exactly: SKIP
- Frame the event for someone living in Germany. If a global story (e.g. Iran, Trump, China), make the German angle clear if there is one — otherwise skip.

Output the sentence directly OR the word SKIP. Nothing else.`;

        const userMsg = yesterdayText
          ? `Topic: ${cluster.label}

Yesterday's update:
"${yesterdayText}"

Today's headlines:
${headlines}

One sentence on the single most important new development today. If today doesn't add new information beyond yesterday, respond SKIP:`
          : `Topic: ${cluster.label}

Today's headlines:
${headlines}

One sentence on the single most important development:`;

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
            system: systemPrompt,
            messages: [{ role: 'user', content: userMsg }],
          }),
        });

        const claudeData = await claudeRes.json();
        const eventText = claudeData.content?.[0]?.text?.trim();

        if (!eventText) continue;

        if (eventText === 'SKIP' || /^SKIP[\s.!]/.test(eventText)) {
          results.threadsSkipped.push(`${cluster.label} (no progress)`);
          continue;
        }
        if (/I don't see|I cannot|I couldn't|no .+-related news/i.test(eventText)) {
          results.threadsSkipped.push(`${cluster.label} (claude refused)`);
          continue;
        }
        if (isFusedSentence(eventText)) {
          results.threadsSkipped.push(`${cluster.label} (fused output rejected)`);
          continue;
        }

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
