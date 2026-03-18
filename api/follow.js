// ============================================================
// FILE: api/follow.js  (NEW FILE)
// PURPOSE: Follow a story — track updates, check for new devs
// Upload to GitHub → api/follow.js
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') return response.status(200).end();

  const SUPABASE_URL       = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY  = process.env.SUPABASE_ANON_KEY;
  const GNEWS_API_KEY      = process.env.GNEWS_API_KEY;
  const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ── POST — Follow a story ─────────────────────────────────
  if (request.method === 'POST') {
    const { article, sessionId } = request.body;

    if (!article || !sessionId) {
      return response.status(400).json({ error: 'article and sessionId required.' });
    }

    const { data, error } = await supabase
      .from('followed_stories')
      .upsert({
        session_id:  sessionId,
        article_id:  article.id,
        headline:    article.headline,
        summary:     article.summary,
        topic:       article.topic,
        topic_label: article.topicLabel,
        source:      article.source,
        source_url:  article.sourceUrl,
        country:     article.country,
        followed_at: new Date().toISOString(),
        is_active:   true,
      }, { onConflict: 'session_id,article_id' });

    if (error) return response.status(500).json({ error: error.message });
    return response.status(200).json({ success: true, message: 'Story followed!' });
  }

  // ── DELETE — Unfollow a story ─────────────────────────────
  if (request.method === 'DELETE') {
    const { articleId, sessionId } = request.query;

    const { error } = await supabase
      .from('followed_stories')
      .update({ is_active: false })
      .eq('session_id', sessionId)
      .eq('article_id', articleId);

    if (error) return response.status(500).json({ error: error.message });
    return response.status(200).json({ success: true, message: 'Unfollowed.' });
  }

  // ── GET — Get followed stories + check for updates ────────
  if (request.method === 'GET') {
    const { sessionId, checkUpdates } = request.query;

    if (!sessionId) {
      return response.status(400).json({ error: 'sessionId required.' });
    }

    // Fetch all active followed stories
    const { data: followed, error } = await supabase
      .from('followed_stories')
      .select('*')
      .eq('session_id', sessionId)
      .eq('is_active', true)
      .order('followed_at', { ascending: false });

    if (error) return response.status(500).json({ error: error.message });
    if (!followed || followed.length === 0) {
      return response.status(200).json({ success: true, followed: [], updates: [] });
    }

    // If not checking for updates, just return the list
    if (checkUpdates !== 'true') {
      return response.status(200).json({ success: true, followed });
    }

    // ── Check for updates on each followed story ──────────
    const allUpdates = [];

    for (const story of followed.slice(0, 5)) { // max 5 to stay within API limits

      // Search GNews for new articles about this story
      const searchQuery = encodeURIComponent(
        story.headline.split(' ').slice(0, 5).join(' ') // first 5 words as search
      );
      const gnewsUrl = `https://gnews.io/api/v4/search?q=${searchQuery}&lang=en&max=3&apikey=${GNEWS_API_KEY}`;

      try {
        const gnewsRes  = await fetch(gnewsUrl);
        const gnewsData = await gnewsRes.json();
        const newArticles = gnewsData.articles || [];

        if (newArticles.length === 0) continue;

        // Ask Claude to assess if these are significant updates
        const articlesList = newArticles
          .map((a, i) => `${i + 1}. [${a.source?.name}] ${a.title}`)
          .join('\n');

        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 300,
            system: 'You assess whether news articles represent significant updates to a story being followed. Respond only with valid JSON.',
            messages: [{
              role: 'user',
              content: `Original story being followed:
"${story.headline}"

New articles found:
${articlesList}

Does any of these represent a significant new development in this story?
Return JSON: { "hasUpdate": true/false, "headline": "most significant new headline or null", "significance": "high/med/low", "updateType": "development/resolution/escalation", "summary": "one sentence describing what changed or null" }`
            }]
          })
        });

        const claudeData = await claudeRes.json();
        const raw = claudeData.content?.[0]?.text || '{}';

        let assessment = {};
        try { assessment = JSON.parse(raw); } catch (e) { continue; }

        if (assessment.hasUpdate && assessment.headline) {
          // Save the update to Supabase
          await supabase.from('story_updates').insert({
            article_id:  story.article_id,
            headline:    assessment.headline,
            summary:     assessment.summary,
            source:      newArticles[0]?.source?.name,
            source_url:  newArticles[0]?.url,
            update_type: assessment.updateType || 'development',
            significance: assessment.significance || 'med',
          });

          // Update the follow record
          await supabase
            .from('followed_stories')
            .update({
              last_checked: new Date().toISOString(),
              update_count: (story.update_count || 0) + 1,
            })
            .eq('id', story.id);

          allUpdates.push({
            followedStory: story.headline,
            topic: story.topic,
            topicLabel: story.topic_label,
            ...assessment,
            sourceUrl: newArticles[0]?.url,
          });
        }

      } catch (e) {
        console.error('Update check failed for:', story.headline, e.message);
      }
    }

    return response.status(200).json({
      success: true,
      followed,
      updates: allUpdates,
      checkedAt: new Date().toISOString(),
    });
  }

  return response.status(405).json({ error: 'Method not allowed.' });
};
