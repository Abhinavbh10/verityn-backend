// ============================================================
// FILE: api/bookmarks.js  (NEW FILE)
// Handles saving and fetching user bookmarks
// Upload to GitHub → api/bookmarks.js
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') return response.status(200).end();

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  // Get user's auth token from request header
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    return response.status(401).json({ error: 'Not logged in.' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } }
  });

  // Verify the user is logged in
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return response.status(401).json({ error: 'Invalid session. Please log in again.' });
  }

  // ── GET — fetch all bookmarks for this user ───────────────
  if (request.method === 'GET') {
    const { data, error } = await supabase
      .from('bookmarks')
      .select('*')
      .eq('user_id', user.id)
      .order('saved_at', { ascending: false });

    if (error) return response.status(500).json({ error: error.message });
    return response.status(200).json({ success: true, bookmarks: data });
  }

  // ── POST — save a new bookmark ────────────────────────────
  if (request.method === 'POST') {
    const article = request.body;

    if (!article || !article.id) {
      return response.status(400).json({ error: 'Article data required.' });
    }

    const { data, error } = await supabase
      .from('bookmarks')
      .upsert({
        user_id:     user.id,
        article_id:  article.id,
        headline:    article.headline,
        summary:     article.summary,
        source:      article.source,
        source_url:  article.sourceUrl,
        image:       article.image,
        topic:       article.topic,
        topic_label: article.topicLabel,
        country:     article.country,
        published_at: article.publishedAt,
      }, { onConflict: 'user_id,article_id' });

    if (error) return response.status(500).json({ error: error.message });
    return response.status(200).json({ success: true, message: 'Bookmarked!' });
  }

  // ── DELETE — remove a bookmark ────────────────────────────
  if (request.method === 'DELETE') {
    const { article_id } = request.query;

    if (!article_id) {
      return response.status(400).json({ error: 'article_id required.' });
    }

    const { error } = await supabase
      .from('bookmarks')
      .delete()
      .eq('user_id', user.id)
      .eq('article_id', article_id);

    if (error) return response.status(500).json({ error: error.message });
    return response.status(200).json({ success: true, message: 'Removed.' });
  }

  return response.status(405).json({ error: 'Method not allowed.' });
};
