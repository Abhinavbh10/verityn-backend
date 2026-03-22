// ============================================================
// FILE: api/briefing.js  (UPDATED)
// PURPOSE: Morning brief with Verityn ranking
//          Scores articles by: recency + velocity + city + topics
//          Returns paragraph + ranked source articles
// ============================================================

const { createClient } = require('@supabase/supabase-js');

// ── Verityn ranking score ─────────────────────────────────────
function scoreArticle(article, { city, interests, now }) {

  let score = 0;

  // 1. RECENCY — articles from last 6 hours score highest
  const ageMinutes = (now - new Date(article.publishedAt)) / 60000;
  if      (ageMinutes < 30)  score += 40;
  else if (ageMinutes < 120) score += 30;
  else if (ageMinutes < 360) score += 20;
  else if (ageMinutes < 720) score += 10;
  // older than 12h scores 0 for recency

  // 2. VELOCITY — sourceCount signals trending
  const sc = article.sourceCount || 1;
  if      (sc >= 5) score += 30;
  else if (sc >= 3) score += 20;
  else if (sc >= 2) score += 10;

  // 3. CITY RELEVANCE — article mentions user's city
  if (city) {
    const cityLower = city.toLowerCase();
    const text      = ((article.headline || '') + ' ' + (article.summary || '')).toLowerCase();
    if (text.includes(cityLower)) score += 25;
  }

  // 4. TOPIC MATCH — user's interest topics
  const TOPIC_KEYWORDS = {
    tech:      ['tech', 'ai', 'software', 'digital', 'startup', 'app', 'cyber'],
    finance:   ['economy', 'market', 'bank', 'inflation', 'gdp', 'finance', 'trade', 'rupee', 'euro', 'dollar'],
    politics:  ['election', 'parliament', 'minister', 'government', 'vote', 'policy', 'party'],
    sports:    ['football', 'cricket', 'match', 'league', 'tournament', 'player', 'team', 'goal'],
    climate:   ['climate', 'energy', 'renewable', 'emission', 'environment', 'solar', 'green'],
    expat:     ['visa', 'immigration', 'expat', 'migrant', 'residence', 'permit', 'foreigner'],
    realestate:['housing', 'property', 'rent', 'mortgage', 'construction', 'apartment'],
  };

  if (interests?.length) {
    const text = ((article.headline || '') + ' ' + (article.summary || '')).toLowerCase();
    for (const interest of interests) {
      const keywords = TOPIC_KEYWORDS[interest] || [];
      if (keywords.some(kw => text.includes(kw))) {
        score += 15;
        break; // one interest match is enough
      }
    }
  }

  // 5. BREAKING bonus
  if (article.breaking) score += 10;

  return score;
}

// ── Trusted source quality filter ────────────────────────────
const TRUSTED_SOURCES = [
  'bbc', 'reuters', 'ap ', 'associated press', 'the hindu', 'times of india',
  'ndtv', 'hindustan times', 'indian express', 'the guardian', 'nyt', 'new york times',
  'washington post', 'deutsche welle', 'dw', 'straits times', 'channel news asia',
  'the national', 'gulf news', 'japan times', 'nhk', 'abc australia', 'sydney morning herald',
  'financial times', 'bloomberg', 'economist', 'wall street journal', 'wsj',
];

function isTrustedSource(article) {
  const src = (article.source || article.sourceName || '').toLowerCase();
  return TRUSTED_SOURCES.some(t => src.includes(t));
}

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const ANTHROPIC_KEY     = process.env.ANTHROPIC_API_KEY;
  const GNEWS_KEY         = process.env.GNEWS_API_KEY;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const supabase          = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const {
    country   = 'us',
    city      = '',
    interests = '',  // comma-separated: "tech,finance,expat"
  } = request.query;

  const interestList = interests ? interests.split(',').map(i => i.trim()) : [];

  // Cache key — daily per country+city
  const today    = new Date().toISOString().slice(0, 10);
  const cacheKey = `briefing-${country}-${city}-${today}`.slice(0, 80);

  // Check cache — briefing is valid all day
  try {
    const { data: cached } = await supabase
      .from('digest_cache')
      .select('digest, fetched_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();
    if (cached?.digest?.paragraph) {
      return response.status(200).json({
        success: true, fromCache: true,
        ...cached.digest,
      });
    }
  } catch (e) {}

  try {
    // ── Fetch articles from both sources ─────────────────────
    const now         = Date.now();
    let allArticles   = [];

    // GNews general headlines
    if (GNEWS_KEY) {
      try {
        const res  = await fetch(
          `https://gnews.io/api/v4/top-headlines?category=general&lang=en&country=${country}&max=10&apikey=${GNEWS_KEY}`
        );
        const data = await res.json();
        if (data.articles) {
          allArticles.push(...data.articles.map(a => ({
            headline:    a.title,
            summary:     a.description || '',
            source:      a.source?.name || 'Unknown',
            sourceUrl:   a.url,
            image:       a.image || null,
            publishedAt: a.publishedAt,
            sourceCount: 1,
            breaking:    false,
            topic:       'world',
            topicLabel:  'World',
          })));
        }
      } catch (e) {}

      // Also fetch city-specific if city provided
      if (city) {
        try {
          const res  = await fetch(
            `https://gnews.io/api/v4/search?q=${encodeURIComponent(city)}&lang=en&max=5&apikey=${GNEWS_KEY}`
          );
          const data = await res.json();
          if (data.articles) {
            allArticles.push(...data.articles.map(a => ({
              headline:    a.title,
              summary:     a.description || '',
              source:      a.source?.name || 'Unknown',
              sourceUrl:   a.url,
              image:       a.image || null,
              publishedAt: a.publishedAt,
              sourceCount: 2, // city-specific = higher velocity signal
              breaking:    false,
              topic:       'world',
              topicLabel:  'World',
            })));
          }
        } catch (e) {}
      }
    }

    if (allArticles.length === 0) {
      return response.status(500).json({ error: 'No articles fetched.' });
    }

    // ── Deduplicate ───────────────────────────────────────────
    const seen    = new Set();
    const unique  = allArticles.filter(a => {
      const k = a.headline?.slice(0, 50).toLowerCase().replace(/[^a-z]/g, '');
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    // ── Verityn ranking ───────────────────────────────────────
    const scored = unique
      .filter(a => a.headline && a.headline.length > 15)
      .map(a => ({
        ...a,
        _score:   scoreArticle(a, { city, interests: interestList, now }),
        _trusted: isTrustedSource(a),
      }));

    // Sort: trusted sources first within score bands,
    // then by score descending
    scored.sort((a, b) => {
      const scoreDiff = b._score - a._score;
      if (Math.abs(scoreDiff) > 5) return scoreDiff;
      if (a._trusted && !b._trusted) return -1;
      if (!a._trusted && b._trusted) return 1;
      return scoreDiff;
    });

    // Top 5 ranked articles
    const top5 = scored.slice(0, 5);

    // ── Determine topic for each article ─────────────────────
    function inferTopic(article) {
      const text = ((article.headline || '') + ' ' + (article.summary || '')).toLowerCase();
      if (/tech|ai|software|digital|cyber|startup/.test(text))      return { topic: 'tech',     label: 'Tech'     };
      if (/economy|market|bank|inflation|finance|trade/.test(text)) return { topic: 'finance',  label: 'Finance'  };
      if (/election|parliament|minister|government|vote/.test(text))return { topic: 'politics', label: 'Politics' };
      if (/football|cricket|match|league|tournament/.test(text))    return { topic: 'sports',   label: 'Sports'   };
      if (/climate|energy|renewable|environment/.test(text))        return { topic: 'climate',  label: 'Climate'  };
      return { topic: 'world', label: 'World' };
    }

    const articlesWithTopics = top5.map(a => ({
      ...a,
      ...inferTopic(a),
    }));

    // ── Build Claude context ──────────────────────────────────
    const countryNames = {
      in: 'India', us: 'United States', gb: 'United Kingdom',
      au: 'Australia', de: 'Germany', sg: 'Singapore',
      ae: 'UAE', jp: 'Japan',
    };
    const locationStr   = city ? `${city}, ${countryNames[country] || country}` : (countryNames[country] || country);
    const interestLabel = interestList.length ? interestList.join(', ') : 'general news';
    const headlinesList = articlesWithTopics
      .map((a, i) => `${i + 1}. [${a.label}] ${a.headline}`)
      .join('\n');

    // ── Call Claude ───────────────────────────────────────────
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 200,
        system:     `You write sharp, intelligent morning briefings for busy professionals in ${locationStr} interested in ${interestLabel}. One sentence, editorial voice, no clichés. Make it feel like a smart colleague summarising the morning.`,
        messages: [{
          role:    'user',
          content: `Today's top stories for ${locationStr}:\n${headlinesList}\n\nWrite ONE sentence that captures the mood/theme of today's news. No quotes around it. Direct, intelligent, specific. Under 30 words.`,
        }],
      }),
    });

    const claudeData = await claudeRes.json();
    const paragraph  = claudeData.content?.[0]?.text?.trim() || "Today's briefing is ready.";

    // ── Format response ───────────────────────────────────────
    const briefingData = {
      paragraph,
      articles: articlesWithTopics.map(a => ({
        headline:    a.headline,
        source:      a.source,
        sourceUrl:   a.sourceUrl,
        topic:       a.topic,
        topicLabel:  a.label,
        time:        getRelativeTime(a.publishedAt),
        score:       a._score,
      })),
      location:  locationStr,
      generatedAt: new Date().toISOString(),
    };

    // Cache until end of day
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    try {
      await supabase.from('digest_cache').upsert({
        cache_key:  cacheKey,
        digest:     briefingData,
        fetched_at: new Date().toISOString(),
        expires_at: endOfDay.toISOString(),
      }, { onConflict: 'cache_key' });
    } catch (e) {}

    return response.status(200).json({
      success: true, fromCache: false,
      ...briefingData,
    });

  } catch (error) {
    return response.status(500).json({ error: 'Briefing failed.', details: error.message });
  }
};

function getRelativeTime(d) {
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  const h = Math.floor(m / 60);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
