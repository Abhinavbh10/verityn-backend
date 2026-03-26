// ============================================================
// FILE: api/user.js
// REPLACES: follow.js, streak.js, auth.js, preferences.js
// ROUTE via: ?action=follow | streak | auth | preferences
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const GNEWS_KEY    = process.env.GNEWS_API_KEY;
  const supabase     = createClient(SUPABASE_URL, SUPABASE_KEY);

  const action = req.query.action || 'follow';
  const body   = req.body || {};
  const query  = req.query;

  // ── ACTION: follow ────────────────────────────────────────────
  if (action === 'follow') {
    if (req.method === 'POST') {
      const { article, sessionId } = body;
      if (!article || !sessionId) return res.status(400).json({ error: 'article and sessionId required' });
      const { error } = await supabase.from('followed_stories').upsert({
        session_id: sessionId, article_id: article.id,
        headline: article.headline, summary: article.summary,
        topic: article.topic, topic_label: article.topicLabel,
        source: article.source, source_url: article.sourceUrl,
        country: article.country, followed_at: new Date().toISOString(), is_active: true,
      }, { onConflict: 'session_id,article_id' });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      const { articleId, sessionId } = query;
      const { error } = await supabase.from('followed_stories')
        .update({ is_active: false })
        .eq('session_id', sessionId).eq('article_id', articleId);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (req.method === 'GET') {
      const { sessionId, checkUpdates } = query;
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
      const { data: followed, error } = await supabase.from('followed_stories')
        .select('*').eq('session_id', sessionId).eq('is_active', true)
        .order('followed_at', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true, followed: followed || [], updates: [] });
    }
  }

  // ── ACTION: streak ────────────────────────────────────────────
  if (action === 'streak') {
    const sessionId = body.sessionId || query.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    const today    = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const { data: existing } = await supabase.from('reading_streaks')
      .select('*').eq('session_id', sessionId).single().catch(() => ({ data: null }));

    if (!existing) {
      await supabase.from('reading_streaks').insert({
        session_id: sessionId, streak: 1, last_read: today, longest_streak: 1,
      }).catch(() => {});
      return res.status(200).json({ streak: 1, lastRead: today, longestStreak: 1, isNew: true });
    }

    if (existing.last_read === today) {
      return res.status(200).json({ streak: existing.streak, lastRead: today, longestStreak: existing.longest_streak });
    }

    const newStreak  = existing.last_read === yesterday ? existing.streak + 1 : 1;
    const longest    = Math.max(newStreak, existing.longest_streak || 1);
    await supabase.from('reading_streaks')
      .update({ streak: newStreak, last_read: today, longest_streak: longest })
      .eq('session_id', sessionId).catch(() => {});

    return res.status(200).json({ streak: newStreak, lastRead: today, longestStreak: longest });
  }

  // ── ACTION: auth (migration only — Supabase handles actual auth) ──
  if (action === 'auth') {
    const { deviceId, userId } = body;
    if (!deviceId || !userId) return res.status(400).json({ error: 'deviceId and userId required' });
    const tables = ['followed_stories', 'reading_streaks', 'bookmarks'];
    for (const table of tables) {
      await supabase.from(table)
        .update({ session_id: userId })
        .eq('session_id', deviceId)
        .catch(() => {});
    }
    return res.status(200).json({ success: true, migrated: tables });
  }

  // ── ACTION: preferences ───────────────────────────────────────
  if (action === 'preferences') {
    const { sessionId } = body.sessionId ? body : query;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    if (req.method === 'POST') {
      const { preferences } = body;
      await supabase.from('profiles').upsert({
        session_id: sessionId,
        topics:     preferences?.interests || [],
        country:    preferences?.countries?.[0] || 'us',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'session_id' }).catch(() => {});
      return res.status(200).json({ success: true });
    }

    const { data } = await supabase.from('profiles')
      .select('*').eq('session_id', sessionId).single().catch(() => ({ data: null }));
    return res.status(200).json({ success: true, preferences: data || {} });
  }

  // ── ACTION: threads ─────────────────────────────────────────
  if (action === 'threads') {
    const { topicKey, days = '4' } = query;
    if (!topicKey) return res.status(400).json({ error: 'topicKey required' });
    const cutoff = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const { data: events, error } = await supabase
      .from('topic_threads')
      .select('event_date, event_text, sources, topic_label')
      .eq('topic_key', topicKey)
      .gte('event_date', cutoff)
      .order('event_date', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, topicKey, events: events || [] });
  }

  // ── ACTION: hot-topics ───────────────────────────────────────
  if (action === 'hot-topics') {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('topic_threads')
      .select('topic_key, topic_label')
      .gte('event_date', cutoff)
      .order('event_date', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const seen = new Set();
    const unique = (data || []).filter(d => {
      if (seen.has(d.topic_key)) return false;
      seen.add(d.topic_key); return true;
    });
    return res.status(200).json({ success: true, topics: unique });
  }

  return res.status(400).json({ error: `Unknown action: ${action}. Use: follow | streak | auth | preferences | threads | hot-topics` });
};
