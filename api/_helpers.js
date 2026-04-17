// ============================================================
// FILE: api/_helpers.js
// Shared utilities: rate limiting (A5) + error logging (A2)
// Not exposed as an endpoint (underscore prefix)
// ============================================================

// ── A5: Rate Limiting ─────────────────────────────────────────
// Per-session, per-endpoint, hourly sliding window.
// Stored in Supabase `rate_limits` table.
//
// Table schema (create once in Supabase):
//   CREATE TABLE rate_limits (
//     id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
//     session_id  TEXT NOT NULL,
//     endpoint    TEXT NOT NULL,
//     window_start TIMESTAMPTZ NOT NULL,
//     request_count INT NOT NULL DEFAULT 1,
//     UNIQUE(session_id, endpoint, window_start)
//   );
//   CREATE INDEX idx_rate_limits_lookup ON rate_limits(session_id, endpoint, window_start);
//
// Limits per endpoint per session per hour:
const RATE_LIMITS = {
  gnews:     30,   // GNews free tier is 100/day — 30/hr leaves headroom
  briefing:  10,   // Claude briefing calls are expensive
  rank:      15,   // OpenAI embedding calls
  oneliner:  15,   // Claude oneliner calls
  aisearch:  10,   // Claude search synthesis
  digest:    10,   // Claude deep dive reports
  rss:       60,   // RSS fetches are cheap but still worth capping
  image:     40,   // Unsplash has 50/hr free
};

async function checkRateLimit(supabase, sessionId, endpoint) {
  const limit = RATE_LIMITS[endpoint];
  if (!limit || !sessionId) return { allowed: true };

  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0); // Round to current hour
  const windowKey = windowStart.toISOString();

  try {
    // Try to increment existing counter
    const { data: existing } = await supabase
      .from('rate_limits')
      .select('request_count')
      .eq('session_id', sessionId)
      .eq('endpoint', endpoint)
      .eq('window_start', windowKey)
      .single();

    if (existing) {
      if (existing.request_count >= limit) {
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetAt: new Date(windowStart.getTime() + 3600000).toISOString(),
        };
      }
      await supabase
        .from('rate_limits')
        .update({ request_count: existing.request_count + 1 })
        .eq('session_id', sessionId)
        .eq('endpoint', endpoint)
        .eq('window_start', windowKey);
      return { allowed: true, remaining: limit - existing.request_count - 1 };
    }

    // First request in this window — insert
    await supabase.from('rate_limits').insert({
      session_id: sessionId,
      endpoint,
      window_start: windowKey,
      request_count: 1,
    });
    return { allowed: true, remaining: limit - 1 };
  } catch (e) {
    // If rate limit check itself fails, allow the request (fail open)
    // but log the error
    return { allowed: true, error: e.message };
  }
}

// Clean up old rate limit entries (call from cron)
async function cleanupRateLimits(supabase) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    await supabase.from('rate_limits').delete().lt('window_start', cutoff);
  } catch (e) { }
}


// ── A2: Error Logging ─────────────────────────────────────────
// Lightweight structured error logging to Supabase.
// No Sentry, no external service — just a queryable table.
//
// Table schema (create once in Supabase):
//   CREATE TABLE error_log (
//     id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
//     endpoint    TEXT NOT NULL,
//     action      TEXT,
//     error_msg   TEXT NOT NULL,
//     context     JSONB,
//     session_id  TEXT,
//     created_at  TIMESTAMPTZ DEFAULT NOW()
//   );
//   CREATE INDEX idx_error_log_time ON error_log(created_at DESC);
//   CREATE INDEX idx_error_log_endpoint ON error_log(endpoint, action);

async function logError(supabase, { endpoint, action, error, context, sessionId }) {
  try {
    await supabase.from('error_log').insert({
      endpoint:   endpoint || 'unknown',
      action:     action || null,
      error_msg:  typeof error === 'string' ? error : (error?.message || JSON.stringify(error)),
      context:    context || null,
      session_id: sessionId || null,
    });
  } catch (e) {
    // Last resort — if even logging fails, console.error so it shows in Vercel logs
    console.error('[ERROR_LOG_FAILED]', { endpoint, action, error: e.message });
  }
}

module.exports = { checkRateLimit, cleanupRateLimits, logError, RATE_LIMITS };
