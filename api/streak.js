// ============================================================
// FILE: api/streak.js  (NEW FILE)
// PURPOSE: Track daily reading streaks per user/session
// Upload to GitHub → api/streak.js
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') return response.status(200).end();

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const supabase          = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { sessionId }     = request.query;

  if (!sessionId) return response.status(400).json({ error: 'sessionId required.' });

  // ── POST — Record today's visit ───────────────────────────
  if (request.method === 'POST') {
    const today     = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // Check if already visited today
    const { data: existing } = await supabase
      .from('reading_streaks')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    const now = new Date().toISOString();

    if (!existing) {
      // First ever visit — start streak at 1
      await supabase.from('reading_streaks').insert({
        session_id:    sessionId,
        current_streak: 1,
        longest_streak: 1,
        last_visit:     today,
        total_days:     1,
        created_at:     now,
      });
      return response.status(200).json({ success: true, streak: 1, longestStreak: 1, totalDays: 1, isNew: true });
    }

    // Already visited today — just return current streak
    if (existing.last_visit === today) {
      return response.status(200).json({
        success: true,
        streak:        existing.current_streak,
        longestStreak: existing.longest_streak,
        totalDays:     existing.total_days,
        isNew:         false,
      });
    }

    // Visited yesterday — extend streak
    let newStreak = existing.last_visit === yesterday
      ? existing.current_streak + 1
      : 1; // streak broken — reset to 1

    const newLongest  = Math.max(newStreak, existing.longest_streak || 1);
    const newTotal    = (existing.total_days || 0) + 1;

    await supabase
      .from('reading_streaks')
      .update({
        current_streak: newStreak,
        longest_streak: newLongest,
        last_visit:     today,
        total_days:     newTotal,
      })
      .eq('session_id', sessionId);

    return response.status(200).json({
      success:       true,
      streak:        newStreak,
      longestStreak: newLongest,
      totalDays:     newTotal,
      isNew:         existing.last_visit !== today,
      streakExtended: existing.last_visit === yesterday,
    });
  }

  // ── GET — Fetch current streak ────────────────────────────
  if (request.method === 'GET') {
    const { data, error } = await supabase
      .from('reading_streaks')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (error || !data) {
      return response.status(200).json({ streak: 0, longestStreak: 0, totalDays: 0 });
    }

    // Check if streak is still alive
    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const streakAlive = data.last_visit === today || data.last_visit === yesterday;

    return response.status(200).json({
      success:       true,
      streak:        streakAlive ? data.current_streak : 0,
      longestStreak: data.longest_streak || 0,
      totalDays:     data.total_days     || 0,
      lastVisit:     data.last_visit,
    });
  }

  return response.status(405).json({ error: 'Method not allowed.' });
};
