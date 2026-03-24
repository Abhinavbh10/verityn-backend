// ============================================================
// FILE: api/auth.js  (NEW FILE)
// PURPOSE: User signup, login, logout, session management
// Upload to GitHub → api/auth.js
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(request, response) {

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') return response.status(200).end();

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const supabase          = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { action } = request.query;

  // ── SIGNUP ────────────────────────────────────────────────
  if (action === 'signup') {
    const { email, password, fullName, country, topics } = request.body;

    if (!email || !password) {
      return response.status(400).json({ error: 'Email and password required.' });
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name:  fullName || '',
          country:    country  || 'in',
          topics:     topics   || ['world', 'tech', 'markets', 'politics'],
        }
      }
    });

    if (error) return response.status(400).json({ error: error.message });

    return response.status(200).json({
      success: true,
      message: 'Account created! Check your email to verify.',
      user: {
        id:       data.user?.id,
        email:    data.user?.email,
        verified: data.user?.email_confirmed_at ? true : false,
      },
      session: data.session ? {
        accessToken:  data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt:    data.session.expires_at,
      } : null,
    });
  }

  // ── LOGIN ─────────────────────────────────────────────────
  if (action === 'login') {
    const { email, password } = request.body;

    if (!email || !password) {
      return response.status(400).json({ error: 'Email and password required.' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) return response.status(401).json({ error: 'Invalid email or password.' });

    // Load user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    return response.status(200).json({
      success: true,
      user: {
        id:       data.user.id,
        email:    data.user.email,
        fullName: profile?.full_name || '',
        country:  profile?.country  || 'in',
        topics:   profile?.topics   || ['world', 'tech', 'markets', 'politics'],
        readerMode:    profile?.reader_mode || 'read',
        darkMode:      profile?.dark_mode   ?? true,
        notifications: profile?.notifications ?? true,
      },
      session: {
        accessToken:  data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt:    data.session.expires_at,
      },
    });
  }

  // ── LOGOUT ────────────────────────────────────────────────
  if (action === 'logout') {
    const authHeader = request.headers.authorization;
    if (authHeader) {
      const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } }
      });
      await userSupabase.auth.signOut();
    }
    return response.status(200).json({ success: true, message: 'Logged out.' });
  }

  // ── VERIFY SESSION ────────────────────────────────────────
  if (action === 'verify') {
    const authHeader = request.headers.authorization;
    if (!authHeader) return response.status(401).json({ error: 'No session.' });

    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error } = await userSupabase.auth.getUser();
    if (error || !user) return response.status(401).json({ error: 'Session expired.' });

    const { data: profile } = await userSupabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    return response.status(200).json({
      success: true,
      user: {
        id:            user.id,
        email:         user.email,
        fullName:      profile?.full_name || '',
        country:       profile?.country   || 'in',
        topics:        profile?.topics    || ['world', 'tech', 'markets', 'politics'],
        readerMode:    profile?.reader_mode || 'read',
        darkMode:      profile?.dark_mode   ?? true,
        notifications: profile?.notifications ?? true,
      },
    });
  }

  // ── Migrate anonymous device data to user account ────────────
  if (action === 'migrate' && request.body?.deviceId && request.body?.userId) {
    const { deviceId, userId } = request.body;
    const tables = ['followed_stories', 'reading_streaks', 'bookmarks'];
    for (const table of tables) {
      try {
        await supabase.from(table)
          .update({ session_id: userId })
          .eq('session_id', deviceId);
      } catch (e) {}
    }
    return response.status(200).json({ success: true, migrated: tables });
  }

  return response.status(400).json({ error: 'Invalid action.' });
};
