// ============================================================
// FILE: api/digest.js
// PURPOSE: Takes today's top headlines and generates an
//          AI-powered narrative digest using Claude
// UPLOAD THIS TO: GitHub → verityn-backend → api/digest.js
// ============================================================

export default async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, GET');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GNEWS_API_KEY = process.env.GNEWS_API_KEY;

  if (!ANTHROPIC_API_KEY || !GNEWS_API_KEY) {
    return response.status(500).json({ error: 'API keys not configured in Vercel.' });
  }

  try {
    const { country = 'us', topics = ['general', 'technology', 'business'] } = request.query;

    // Step 1 — Fetch top headlines from multiple categories
    const allArticles = [];
    for (const topic of topics.slice(0, 3)) { // Max 3 categories to stay within free tier
      const gnewsUrl = `https://gnews.io/api/v4/top-headlines?category=${topic}&lang=en&country=${country}&max=5&apikey=${GNEWS_API_KEY}`;
      const res = await fetch(gnewsUrl);
      const data = await res.json();
      if (data.articles) allArticles.push(...data.articles.slice(0, 3));
    }

    // Step 2 — Format headlines for Claude
    const headlinesList = allArticles
      .map((a, i) => `${i + 1}. [${a.source?.name}] ${a.title} — ${a.description || ''}`)
      .join('\n');

    // Step 3 — Ask Claude to generate the digest
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: `You are Verityn's AI editor. You create sharp, insightful news digests. 
Your tone is that of a smart, well-informed journalist — clear, direct, never sensationalist.
Always respond with valid JSON only. No preamble, no markdown, no explanation outside the JSON.`,
        messages: [{
          role: 'user',
          content: `Here are today's top headlines:

${headlinesList}

Create a digest of the 4 most important stories. For each story return:
- headline: A sharp, rewritten headline (not copied from source)
- topic: One of: Politics, Economy, Tech, Climate, Business, World, Science, Sports
- narrative: 2-3 sentences explaining the story so far and why it matters now
- trend: A 6-8 word phrase describing the current direction of this story
- whyItMatters: One sentence on real-world impact for ordinary people
- velocity: "high" or "med" based on how fast this story is developing

Return ONLY a JSON array of 4 objects with these exact keys. No other text.`
        }]
      })
    });

    const claudeData = await claudeResponse.json();
    const rawText = claudeData.content?.[0]?.text || '[]';

    // Step 4 — Parse and return the digest
    let digestItems = [];
    try {
      digestItems = JSON.parse(rawText);
    } catch (e) {
      // If Claude returns something unexpected, fall back gracefully
      digestItems = [];
    }

    return response.status(200).json({
      success: true,
      country: country.toUpperCase(),
      generatedAt: new Date().toISOString(),
      digest: digestItems,
    });

  } catch (error) {
    console.error('Digest generation error:', error.message);
    return response.status(500).json({ 
      error: 'Failed to generate digest.',
      details: error.message 
    });
  }
}
