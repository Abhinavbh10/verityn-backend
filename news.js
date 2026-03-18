// ============================================================
// FILE: api/news.js
// PURPOSE: Fetches real news from GNews and sends it to the app
// UPLOAD THIS TO: GitHub → verityn-backend → api/news.js
// ============================================================

export default async function handler(request, response) {

  // Allow your app to talk to this server (CORS)
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET');

  // Read what the app is asking for
  const { country = 'us', category = 'general', lang = 'en', max = 10 } = request.query;

  // Your GNews API key — stored safely in Vercel, never in the code
  const GNEWS_API_KEY = process.env.GNEWS_API_KEY;

  if (!GNEWS_API_KEY) {
    return response.status(500).json({ 
      error: 'API key not configured. Add GNEWS_API_KEY in Vercel environment variables.' 
    });
  }

  try {
    // Build the GNews URL
    const gnewsUrl = `https://gnews.io/api/v4/top-headlines?category=${category}&lang=${lang}&country=${country}&max=${max}&apikey=${GNEWS_API_KEY}`;
    
    // Fetch the news
    const gnewsResponse = await fetch(gnewsUrl);
    const gnewsData = await gnewsResponse.json();

    if (!gnewsResponse.ok) {
      throw new Error(gnewsData.errors?.[0] || 'GNews API error');
    }

    // Transform the articles into Verityn's format
    const articles = gnewsData.articles.map((article, index) => ({
      id: `${country}-${category}-${index}-${Date.now()}`,
      headline: article.title,
      summary: article.description || 'Tap to read the full story.',
      source: article.source?.name || 'Unknown Source',
      sourceUrl: article.url,
      image: article.image,
      publishedAt: article.publishedAt,
      time: getRelativeTime(article.publishedAt),
      topic: mapCategoryToTopic(category),
      topicLabel: capitalise(category === 'general' ? 'World' : category),
      breaking: isBreaking(article.publishedAt),
      country: country.toUpperCase(),
      // These will be enhanced by AI in the next step
      velocity: estimateVelocity(index),
      bookmarked: false,
    }));

    // Return the articles to the app
    return response.status(200).json({
      success: true,
      country: country.toUpperCase(),
      category,
      totalArticles: articles.length,
      articles,
    });

  } catch (error) {
    console.error('News fetch error:', error.message);
    return response.status(500).json({ 
      error: 'Failed to fetch news. Please try again.',
      details: error.message 
    });
  }
}

// ── Helper functions ─────────────────────────────────────────────

// Turns a published date into "8m ago", "2h ago" etc.
function getRelativeTime(dateString) {
  const now = new Date();
  const published = new Date(dateString);
  const diffMs = now - published;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// Maps GNews categories to Verityn's topic IDs
function mapCategoryToTopic(category) {
  const map = {
    general: 'world',
    technology: 'tech',
    business: 'business',
    sports: 'sports',
    science: 'science',
    health: 'science',
    politics: 'politics',
    entertainment: 'world',
  };
  return map[category] || 'world';
}

// Capitalises first letter
function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Articles published in last 30 minutes get the "Breaking" badge
function isBreaking(dateString) {
  const now = new Date();
  const published = new Date(dateString);
  const diffMins = (now - published) / 60000;
  return diffMins < 30;
}

// Top articles get higher velocity (simplified — real logic uses view counts)
function estimateVelocity(index) {
  if (index < 2) return { label: 'Top story', level: 'high' };
  if (index < 5) return { label: 'Trending', level: 'med' };
  return { label: 'In the news', level: 'low' };
}
