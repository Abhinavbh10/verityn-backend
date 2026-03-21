// ============================================================
// FILE: api/search.js  (NEW)
// PURPOSE: Full-text news search via GNews
// ============================================================

const { createClient } = require('@supabase/supabase-js');

function getRelativeTime(d) {
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  const h = Math.floor(m / 60);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

module.exports = async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const { q = '', country = 'us', max = 20 } = request.query;

  if (!q.trim()) {
    return response.status(400).json({ error: 'Query required.' });
  }

  const GNEWS_KEY         = process.env.GNEWS_API_KEY;
  const MEDIASTACK_KEY    = process.env.MEDIASTACK_KEY;

  try {
    const allRaw = [];

    // GNews search
    if (GNEWS_KEY) {
      try {
        const url  = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=en&country=${country}&max=10&apikey=${GNEWS_KEY}`;
        const res  = await fetch(url);
        const data = await res.json();
        if (data.articles) {
          allRaw.push(...data.articles.map(a => ({
            headline:    a.title,
            summary:     a.description || '',
            source:      a.source?.name || 'Unknown',
            sourceUrl:   a.url,
            image:       a.image,
            publishedAt: a.publishedAt,
            time:        getRelativeTime(a.publishedAt),
          })));
        }
      } catch (e) {}
    }

    // MediaStack search
    if (MEDIASTACK_KEY) {
      try {
        const url  = `http://api.mediastack.com/v1/news?access_key=${MEDIASTACK_KEY}&keywords=${encodeURIComponent(q)}&languages=en&limit=10`;
        const res  = await fetch(url);
        const data = await res.json();
        if (data.data) {
          allRaw.push(...data.data
            .filter(a => a.title && a.url)
            .map(a => ({
              headline:    a.title,
              summary:     a.description || '',
              source:      a.source || 'Unknown',
              sourceUrl:   a.url,
              image:       a.image,
              publishedAt: a.published_at,
              time:        getRelativeTime(a.published_at),
            }))
          );
        }
      } catch (e) {}
    }

    // Deduplicate
    const seen    = new Set();
    const deduped = allRaw.filter(a => {
      const key = a.headline?.slice(0, 50).toLowerCase().replace(/[^a-z]/g, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    const articles = deduped.slice(0, parseInt(max)).map((a, i) => ({
      id:      `search-${i}-${Date.now()}`,
      topic:   'world',
      topicLabel: 'World',
      country: country.toUpperCase(),
      breaking: false,
      velocity: { label: 'Search result', level: 'low' },
      bookmarked: false,
      sourceCount: 1,
      ...a,
    }));

    return response.status(200).json({
      success: true, query: q,
      totalArticles: articles.length,
      articles,
    });

  } catch (error) {
    return response.status(500).json({ error: 'Search failed.', details: error.message });
  }
};
