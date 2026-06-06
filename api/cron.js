// ============================================================
// FILE: api/cron.js
// PURPOSE: Cache warming + topic thread generation + cleanup + newsletter send
// Runs: GitHub Actions every 3h + Vercel cron 5am UTC daily
//
// GERMANY-ONLY (May 2026): Verityn is focused on news for English speakers
// living in Germany. Multi-country fetching has been removed.
//
// CITY TAGGING (May 2026): Each source is tagged with a `city` field.
// Berlin/Munich/Hamburg/Frankfurt come from city-specific Local DE feeds;
// everything else is `nationwide`. Articles inherit their source's city tag.
//
// NEWSLETTER SEND (Jun 2026): At the end, this cron POSTs to
// /api/newsletter?action=send. The send endpoint has same-day idempotency
// (won't double-send within a single UTC day) and requires
// NEWSLETTER_ENABLED=true (safety guard).
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { cleanupRateLimits, logError } = require('./_helpers');

const COUNTRIES = ['de'];

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

// ── Germany-relevance filter (v2 — tighter) ──────────────────
const STRONG_GERMANY = /\b(germany|german|berlin|munich|münchen|muenchen|hamburg|frankfurt|cologne|köln|koeln|stuttgart|düsseldorf|duesseldorf|leipzig|dresden|bremen|hannover|nürnberg|nuremberg|bundestag|bundesrat|bundesregierung|bundesbank|bundesliga|bundeswehr|cdu|csu|spd|fdp|grünen|gruene|afd|merz|scholz|habeck|lindner|baerbock|wagenknecht|weidel|söder|soeder|steinmeier|deutsche bahn|lufthansa|volkswagen|bmw|mercedes|siemens|sap|bayer|allianz|porsche|adidas|dax|krankenkasse|bürgergeld|buergergeld|mietpreisbremse|heizungsgesetz|energiewende|wärmepumpe|waermepumpe|tagesschau|tagesspiegel|spiegel|faz|sueddeutsche|süddeutsche|bvg|s-bahn|u-bahn|autobahn|verdi|ig metall|gdl|mindestlohn|kurzarbeit|tarifvertrag|bürgeramt|buergeramt|anmeldung|finanzamt|niederlassungserlaubnis|aufenthaltstitel|einbürgerung|einbuergerung)\b/i;

const EU_INSTITUTIONAL = /\b(european central bank|ecb|european commission|european parliament|eurozone|eurogroup|eu council)\b/i;

const HARD_GLOBAL = /\b(iran|iranian|israel|israeli|gaza|hamas|hezbollah|netanyahu|trump|harris|biden|putin|russia|russian|kremlin|moscow|ukraine|ukrainian|zelensky|kyiv|china|chinese|beijing|shanghai|xi jinping|jinping|modi|delhi|mumbai|bangalore|sensex|nifty|rupee|japan|japanese|tokyo|nikkei|yen|south korea|korean|seoul|saudi arabia|riyadh|dubai|abu dhabi|emirates|qatar|brazil|brazilian|mexico|mexican|argentina|chile|nigeria|kenya|south africa|sydney|melbourne|asx|new zealand|wellington|venezuela|colombia|peru|pakistan|pakistani|islamabad|afghanistan|kabul|taliban|syria|syrian|libya|egypt|cairo|turkey|turkish|ankara|erdogan)\b/i;

const UK_DOMESTIC = /\b(britain|british|england|sunak|starmer|labour party|tory party|tories|conservative party|downing street|westminster|whitehall|brexit|chancellor of the exchequer)\b/i;

function isGermanyRelevant(title, summary) {
  const text = ((title || '') + ' ' + (summary || '')).toLowerCase();
  if (STRONG_GERMANY.test(text)) return true;
  if (EU_INSTITUTIONAL.test(text)) return true;
  if (HARD_GLOBAL.test(text)) return false;
  if (UK_DOMESTIC.test(text)) return false;
  return true;
}

// ── Entity map for topic clustering (Germany-focused) ────────
const ENTITY_MAP = {
  'bundestag':'bundestag','bundesrat':'bundesrat',
  'bundesregierung':'germany','bundeskanzler':'germany','chancellor':'germany',
  'bundeswehr':'bundeswehr',
  'cdu':'cdu','csu':'csu','spd':'spd','fdp':'fdp',
  'grünen':'greens','greens':'greens','gruene':'greens',
  'afd':'afd','linke':'linke','die linke':'linke','bsw':'bsw',
  'merz':'merz','scholz':'scholz','habeck':'habeck','lindner':'lindner',
  'baerbock':'baerbock','wagenknecht':'wagenknecht','weidel':'weidel',
  'söder':'soeder','soeder':'soeder','steinmeier':'steinmeier',
  'bürgergeld':'buergergeld','buergergeld':'buergergeld',
  'mietpreisbremse':'housing-policy','mietendeckel':'housing-policy',
  'heizungsgesetz':'heizungsgesetz','wärmepumpe':'energy','waermepumpe':'energy',
  'energiewende':'energy','klimageld':'climate-policy',
  'mindestlohn':'mindestlohn','tarifvertrag':'tarif','tarif':'tarif',
  'kurzarbeit':'kurzarbeit','elterngeld':'elterngeld','kindergeld':'kindergeld',
  'anmeldung':'anmeldung','bürgeramt':'buergeramt','buergeramt':'buergeramt',
  'krankenkasse':'krankenkasse','krankenversicherung':'krankenkasse',
  'gkv':'krankenkasse','tk':'krankenkasse','aok':'krankenkasse','barmer':'krankenkasse',
  'rentenversicherung':'rente','rente':'rente','altersvorsorge':'rente',
  'finanzamt':'tax','steuer':'tax','steuererklärung':'tax','steuererklaerung':'tax',
  'gez':'gez','rundfunkbeitrag':'gez',
  'aufenthaltstitel':'visa','niederlassungserlaubnis':'visa','niederlassung':'visa',
  'einbürgerung':'visa','einbuergerung':'visa','naturalization':'visa',
  'aufenthalt':'visa','arbeitserlaubnis':'visa',
  'berlin':'berlin','münchen':'munich','munich':'munich','muenchen':'munich',
  'hamburg':'hamburg','frankfurt':'frankfurt',
  'köln':'cologne','cologne':'cologne','koeln':'cologne',
  'stuttgart':'stuttgart','düsseldorf':'duesseldorf','duesseldorf':'duesseldorf',
  'leipzig':'leipzig','dresden':'dresden','bremen':'bremen','hannover':'hannover',
  'nürnberg':'nuremberg','nuremberg':'nuremberg',
  'bahn':'db','autobahn':'autobahn',
  'bvg':'bvg','s-bahn':'s-bahn','u-bahn':'u-bahn',
  'lufthansa':'lufthansa','flixbus':'flixbus',
  'verdi':'verdi','ver.di':'verdi',
  'ig metall':'ig-metall','igmetall':'ig-metall',
  'streik':'strike','strike':'strike','gdl':'gdl',
  'volkswagen':'volkswagen','vw':'volkswagen',
  'bmw':'bmw','mercedes':'mercedes','mercedes-benz':'mercedes',
  'siemens':'siemens','sap':'sap','bayer':'bayer',
  'allianz':'allianz','deutsche bank':'deutsche-bank','commerzbank':'commerzbank',
  'porsche':'porsche','adidas':'adidas','puma':'puma',
  'dax':'dax','mittelstand':'mittelstand','bundesbank':'bundesbank',
  'eu':'eu','european union':'eu','europäische union':'eu',
  'ezb':'ecb','ecb':'ecb','european central bank':'ecb',
  'european commission':'eu-commission','european parliament':'eu-parliament',
  'brussels':'eu','strasbourg':'eu',
  'bundesliga':'bundesliga','bayern':'bayern','dortmund':'dortmund','bvb':'dortmund',
  'leverkusen':'leverkusen','schalke':'schalke','rb leipzig':'leipzig-fc',
  'germany':'germany','german':'germany',
  'france':'france','europe':'europe','european':'europe',
  'nato':'nato',
  'inflation':'inflation','recession':'recession','gdp':'gdp',
  'oil':'oil','crude':'oil',
  'rate':'rates','rates':'rates','interest':'rates',
  'market':'markets','markets':'markets','stocks':'stocks',
  'dollar':'dollar','euro':'euro',
  'tariff':'tariffs','tariffs':'tariffs','trade':'trade',
  'ai':'ai','artificial':'ai',
  'chip':'chips','chips':'chips','semiconductor':'chips',
  'nvidia':'nvidia','openai':'openai','google':'google',
  'apple':'apple','microsoft':'microsoft','meta':'meta',
  'cyber':'cyber','cybersecurity':'cyber',
  'climate':'climate','emissions':'climate','carbon':'climate',
  'energy':'energy','solar':'energy','renewable':'energy',
  'tesla':'tesla','spacex':'spacex','amazon':'amazon',
  'ryanair':'ryanair',
};

const BROAD_ENTITIES = new Set([
  'germany','france','europe','eu',
  'markets','banking',
]);

const CITY_ENTITIES = ['berlin','munich','hamburg','frankfurt','cologne','stuttgart','duesseldorf','leipzig','dresden','bremen','hannover','nuremberg'];

function getEntities(headline) {
  const text = (headline || '').toLowerCase();
  const found = new Set();
  for (const [key, val] of Object.entries(ENTITY_MAP)) {
    if (key.includes(' ') || key.includes('-') || key.includes('.')) {
      if (text.includes(key)) found.add(val);
    }
  }
  const words = text.replace(/[^a-zäöüß0-9\s]/g, ' ').split(/\s+/);
  for (const w of words) {
    if (ENTITY_MAP[w]) found.add(ENTITY_MAP[w]);
  }
  return [...found].sort();
}

function makeTopicLabel(entities) {
  const labelMap = {
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
    'germany':'Germany','france':'France','europe':'Europe',
    'nato':'NATO',
    'oil':'Oil Prices','rates':'Interest Rates','markets':'Markets',
    'chips':'Semiconductors','ai':'Artificial Intelligence','climate':'Climate',
    'trade':'Trade','tariffs':'Tariffs','nuclear':'Nuclear',
    'banking':'Banking','dollar':'US Dollar','euro':'Euro',
    'google':'Google','nvidia':'Nvidia','openai':'OpenAI','microsoft':'Microsoft',
    'apple':'Apple','meta':'Meta','tesla':'Tesla','amazon':'Amazon','ryanair':'Ryanair',
    'cyber':'Cybersecurity',
    'inflation':'Inflation','recession':'Recession','gdp':'GDP','spacex':'SpaceX',
  };
  return entities.slice(0, 3)
    .map(e => labelMap[e] || e.charAt(0).toUpperCase() + e.slice(1))
    .join(' & ');
}

function deriveClusterCity(entities, articles) {
  for (const e of entities) {
    if (CITY_ENTITIES.includes(e)) return e;
  }
  const sourceCityCounts = {};
  for (const a of articles) {
    const sc = a.sourceCity || 'nationwide';
    sourceCityCounts[sc] = (sourceCityCounts[sc] || 0) + 1;
  }
  let bestCity = 'nationwide';
  let bestCount = 0;
  for (const [c, n] of Object.entries(sourceCityCounts)) {
    if (c === 'nationwide') continue;
    if (n > bestCount) { bestCity = c; bestCount = n; }
  }
  if (bestCount / articles.length >= 0.6) return bestCity;
  return 'nationwide';
}

function clusterArticles(articles) {
  const ENTITY_PRIORITY = [
    'buergergeld','housing-policy','heizungsgesetz','energy','mindestlohn',
    'krankenkasse','visa','strike','tax','rente','anmeldung','tarif',
    'bundestag','bundesrat','cdu','spd','fdp','greens','afd','linke','bsw',
    'merz','scholz','habeck','lindner','weidel','soeder','wagenknecht',
    'berlin','munich','hamburg','frankfurt','cologne','stuttgart','leipzig',
    'duesseldorf','dresden','bremen','hannover',
    'db','bvg','s-bahn','lufthansa','verdi','ig-metall','gdl',
    'volkswagen','bmw','mercedes','siemens','sap','bayer','allianz','porsche',
    'deutsche-bank','adidas',
    'bundesliga','bayern','dortmund','leverkusen','leipzig-fc',
    'eu','ecb','eu-commission',
    'germany','france',
    'fed','oil','ai','chips','markets','rates','inflation','tariffs','trade',
    'nato','climate',
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
      if (!secondary || BROAD_ENTITIES.has(secondary)) continue;
      key = [dominant, secondary].sort().join('+');
    } else {
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
    .map(c => ({
      ...c,
      city: deriveClusterCity(c.key.split('+'), c.articles),
    }))
    .sort((a, b) => b.articles.length - a.articles.length);
}

function parseRssHeadlines(xml, sourceName, sourceCity = 'nationwide') {
  const items = xml.match(/<item[^>]*>[\s\S]*?<\/item>/g) || [];
  return items.slice(0, 15).map(item => {
    const title = (item.match(/<title[^>]*>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/title>/) || [])[1] || '';
    const desc = (item.match(/<description[^>]*>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/description>/) || [])[1] || '';
    return {
      headline: title.trim(),
      summary: desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
      source: sourceName,
      sourceCity,
      url: '',
    };
  }).filter(a => a.headline.length > 10);
}

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
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const results = { cacheWarmed: [], threadsGenerated: [], threadsSkipped: [], errors: [], debug: {}, newsletterSend: null };

  try {
    await cleanupRateLimits(supabase);
  } catch (e) {
    results.errors.push('rate-limit-cleanup: ' + e.message);
  }

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

  // ── Topic thread generation ────────────────────────────────
  try {
    const GERMANY_SEARCH_QUERIES = [
      'Germany Bundestag OR Scholz OR Merz OR Habeck',
      'Berlin OR Munich OR Frankfurt housing OR rent OR transport',
      'Germany Bürgergeld OR Krankenkasse OR Mietpreisbremse OR Heizungsgesetz',
      'Germany visa OR naturalization OR Blue Card OR residence permit',
      'Bundesliga OR Bayern Munich OR Borussia Dortmund',
    ];

    const headlineFetches = [
      fetch(`https://gnews.io/api/v4/top-headlines?category=general&lang=en&country=de&max=10&apikey=${GNEWS_KEY}`)
        .then(r => r.json())
        .then(d => (d.articles || []).map(a => ({
          headline: (a.title || '').replace(/<[^>]+>/g, '').trim(),
          summary: (a.description || '').replace(/<[^>]+>/g, '').trim().slice(0, 300),
          source: a.source?.name || 'Unknown', sourceCity: 'nationwide', url: a.url,
        }))).catch(() => []),

      ...(GNEWS_KEY ? GERMANY_SEARCH_QUERIES.map(q =>
        fetch(`https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=en&max=8&apikey=${GNEWS_KEY}`)
          .then(r => r.json())
          .then(d => (d.articles || []).map(a => ({
            headline: (a.title || '').replace(/<[^>]+>/g, '').trim(),
            summary: (a.description || '').replace(/<[^>]+>/g, '').trim().slice(0, 300),
            source: a.source?.name || 'Unknown', sourceCity: 'nationwide', url: a.url,
          }))).catch(() => [])
      ) : []),

      fetch('https://feeds.bbci.co.uk/news/world/europe/rss.xml', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'BBC', 'nationwide')).catch(() => []),

      fetch('https://rss.dw.com/xml/rss-en-all', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'Deutsche Welle', 'nationwide')).catch(() => []),

      fetch('https://feeds.thelocal.com/rss/de', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'The Local', 'nationwide')).catch(() => []),

      fetch('https://feeds.thelocal.com/rss/de/politics', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'The Local Politics', 'nationwide')).catch(() => []),

      fetch('https://feeds.thelocal.com/rss/de/berlin', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'The Local Berlin', 'berlin')).catch(() => []),

      fetch('https://feeds.thelocal.com/rss/de/munich', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'The Local Munich', 'munich')).catch(() => []),

      fetch('https://feeds.thelocal.com/rss/de/hamburg', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'The Local Hamburg', 'hamburg')).catch(() => []),

      fetch('https://feeds.thelocal.com/rss/de/frankfurt', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'The Local Frankfurt', 'frankfurt')).catch(() => []),

      fetch('https://www.iamexpat.de/rss/news-germany', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'IamExpat', 'nationwide')).catch(() => []),

      fetch('https://www.politico.eu/feed/', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.text()).then(x => parseRssHeadlines(x, 'POLITICO Europe', 'nationwide')).catch(() => []),
    ];

    const allResults = await Promise.all(headlineFetches);
    let allArticles = allResults.flat();

    const beforeFilters = allArticles.length;
    const sourceBreakdownPreFilter = {};
    const cityBreakdownPreFilter = {};
    for (const a of allArticles) {
      const s = a.source || 'Unknown';
      const c = a.sourceCity || 'nationwide';
      sourceBreakdownPreFilter[s] = (sourceBreakdownPreFilter[s] || 0) + 1;
      cityBreakdownPreFilter[c] = (cityBreakdownPreFilter[c] || 0) + 1;
    }

    allArticles = allArticles.filter(a => isEnglishHeadline(a.headline));
    const afterEnglish = allArticles.length;

    allArticles = allArticles.filter(a => isGermanyRelevant(a.headline, a.summary));

    results.debug.sourceCounts = {
      fetched: beforeFilters,
      droppedNonEnglish: beforeFilters - afterEnglish,
      droppedNonGermany: afterEnglish - allArticles.length,
      total: allArticles.length,
      sourceBreakdownPreFilter,
      cityBreakdownPreFilter,
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
      key: c.key, label: c.label, count: c.articles.length, city: c.city,
      sample: c.articles[0]?.headline?.slice(0, 50),
    }));

    const today = new Date().toISOString().slice(0, 10);

    const historyMap = {};
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data: recentThreads } = await supabase
        .from('topic_threads').select('topic_key, event_text, event_date')
        .gte('event_date', sevenDaysAgo)
        .order('event_date', { ascending: false });
      for (const t of (recentThreads || [])) {
        if (!historyMap[t.topic_key]) historyMap[t.topic_key] = [];
        historyMap[t.topic_key].push(t.event_text);
      }
    } catch (e) {}

    function tokenize(s) {
      const STOP = new Set(['the','a','an','and','or','but','of','to','in','on','for','at','by','with','from','as','is','was','are','were','will','would','said','says','has','have','had','this','that','these','those','his','her','its','their','it']);
      return (s || '').toLowerCase()
        .replace(/[^a-zäöüß0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP.has(w));
    }
    function isTooSimilar(newText, history) {
      const newTokens = new Set(tokenize(newText));
      if (newTokens.size === 0) return false;
      for (const past of history) {
        const pastTokens = new Set(tokenize(past));
        if (pastTokens.size === 0) continue;
        let overlap = 0;
        for (const t of newTokens) if (pastTokens.has(t)) overlap++;
        const ratio = overlap / Math.min(newTokens.size, pastTokens.size);
        if (ratio >= 0.6) return true;
      }
      return false;
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

        const history = historyMap[cluster.key] || [];
        const recentText = history.length > 0
          ? history.slice(0, 5).map((t, i) => `${i + 1}. "${t}"`).join('\n')
          : null;

        const systemPrompt = `You write one crisp past-tense sentence about a specific news story affecting people living in Germany. Under 22 words. Specific facts.

CRITICAL RULES:
- The sentence describes ONE event only. NEVER fuse two unrelated events with "while", "as", or "and".
- If the headlines cover multiple unrelated stories, pick the single most important one and ignore the rest.
- If today's headlines don't materially advance the story beyond what was already covered in recent days, respond with exactly: SKIP
- "Materially advance" means a NEW fact, action, vote, ruling, or development. A restatement of the same situation with different wording does NOT qualify — respond SKIP.
- Frame the event for someone living in Germany. If a global story (e.g. Iran, Trump, China), make the German angle clear if there is one — otherwise skip.

Output the sentence directly OR the word SKIP. Nothing else.`;

        const userMsg = recentText
          ? `Topic: ${cluster.label}

Recent coverage of this topic (newest first):
${recentText}

Today's headlines:
${headlines}

One sentence on the single most important NEW development today. If today's headlines only restate what's already been covered above, respond SKIP:`
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

        if (history.length > 0 && isTooSimilar(eventText, history)) {
          results.threadsSkipped.push(`${cluster.label} (too similar to recent entries)`);
          continue;
        }

        await supabase.from('topic_threads').upsert({
          topic_key: cluster.key,
          topic_label: cluster.label,
          event_date: today,
          event_text: eventText,
          sources: [...cluster.sources].slice(0, 5),
          city: cluster.city,
        }, { onConflict: 'topic_key,event_date' });

        results.threadsGenerated.push(`${cluster.label} [${cluster.city}]`);

      } catch (e) {
        results.errors.push(`thread-${cluster.key}: ${e.message}`);
        await logError(supabase, { endpoint: 'cron', action: `thread-${cluster.key}`, error: e });
      }
    }

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    try { await supabase.from('topic_threads').delete().lt('event_date', cutoff); } catch (e) {}

  } catch (e) {
    results.errors.push(`thread-generation: ${e.message}`);
    await logError(supabase, { endpoint: 'cron', action: 'thread-generation', error: e });
  }

  // ── Newsletter send (Jun 2026) ──────────────────────────────
  // POST to /api/newsletter?action=send after cache + threads complete.
  // The send endpoint has same-day idempotency (won't double-send within a
  // single UTC day), so GitHub Actions 3h runs are safe — only the first
  // call each day actually fires the send.
  // NEWSLETTER_ENABLED env var must = 'true' for it to actually send.
  try {
    const sendResp = await fetch(`${VERCEL_URL}/api/newsletter?action=send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const sendJson = await sendResp.json().catch(() => ({ ok: false, error: 'invalid JSON response' }));
    results.newsletterSend = sendJson;
    console.log('[cron] newsletter send result:', JSON.stringify(sendJson).slice(0, 300));
  } catch (e) {
    results.errors.push(`newsletter-send: ${e.message}`);
    results.newsletterSend = { ok: false, error: e.message };
  }

  return response.status(200).json({
    success: true,
    runAt: new Date().toISOString(),
    debug: results.debug || {},
    ...results,
  });
};
