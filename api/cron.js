// ============================================================
// FILE: api/cron.js  (UPGRADED — Fix 2)
// FIX: Cache warming — pre-fetches top country/category
//      combinations at 5am so first users never wait
//      Also runs story follow checks and cache cleanup
// ============================================================

const { createClient } = require('@supabase/supabase-js');

// Top country/category combinations to pre-warm
// These cover ~80% of daily user requests
const WARM_COMBINATIONS = [
  { country: 'in', category: 'general'    },
  { country: 'in', category: 'technology' },
  { country: 'in', category: 'business'   },
  { country: 'in', category: 'sports'     },
  { country: 'us', category: 'general'    },
  { country: 'us', category: 'technology' },
  { country: 'us', category: 'business'   },
  { country: 'gb', category: 'general'    },
  { country: 'gb', category: 'business'   },
  { country: 'ae', category: 'general'    },
  { country: 'sg', category: 'general'    },
  { country: 'au', category: 'general'    },
];

// Countries to generate morning digests for
const DIGEST_COUNTRIES = ['in', 'us', 'gb', 'ae', 'sg', 'au'];

module.exports = async function handler(request, response) {

  // Security check
  const cronSecret = request.headers['x-cron-secret'];
  if (cronSecret !== process.env.CRON_SECRET) {
    return response.status(401).json({ error: 'Unauthorized.' });
  }

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const GNEWS_API_KEY     = process.env.GNEWS_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const VERCEL_URL        = process.env.VERCEL_URL || 'https://verityn-backend-ten.vercel.app';

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const now      = new Date();
  const hour     = now.getUTCHours();

  const results = {
    task:               '',
    cacheWarmed:        0,
    digestsGenerated:   0,
    briefingsGenerated: 0,
    storiesChecked:     0,
    updatesFound:       0,
    cacheEntriesCleaned: 0,
    errors:             [],
  };

  // ── Task 1: 5am cache warming (Fix 2) ─────────────────────
  // Runs at 5am UTC (~10:30am IST, 1am EST)
  // Pre-warms all top country/category combinations
  if (hour === 5) {
    results.task = 'cache-warming';
    console.log('Starting cache warm at 5am UTC...');

    for (const combo of WARM_COMBINATIONS) {
      try {
        // Call our own news endpoint to warm the cache
        const res = await fetch(`${VERCEL_URL}/api/content?action=news&country=${combo.country}&category=${combo.category}&max=10`, {
          headers: { 'x-cron-secret': process.env.CRON_SECRET }
        });
        if (res.ok) {
          results.cacheWarmed++;
          console.log(`Warmed: ${combo.country}-${combo.category}`);
        }
        // Small delay between calls to avoid rate limiting
        await sleep(500);
      } catch (e) {
        results.errors.push(`Warm failed: ${combo.country}-${combo.category}: ${e.message}`);
      }
    }

    // Also pre-generate digests for top countries
    for (const country of DIGEST_COUNTRIES) {
      try {
        const res = await fetch(`${VERCEL_URL}/api/ai?action=digest&country=${country}`);
        if (res.ok) {
          results.digestsGenerated++;
          console.log(`Digest generated: ${country}`);
        }
        await sleep(2000); // Longer delay — digest is expensive
      } catch (e) {
        results.errors.push(`Digest warm failed: ${country}: ${e.message}`);
      }
    }

    // Pre-generate morning briefings
    for (const country of DIGEST_COUNTRIES) {
      try {
        const res = await fetch(`${VERCEL_URL}/api/ai?action=briefing&country=${country}`);
        if (res.ok) {
          results.briefingsGenerated++;
          console.log(`Briefing generated: ${country}`);
        }
        await sleep(2000);
      } catch (e) {
        results.errors.push(`Briefing warm failed: ${country}: ${e.message}`);
      }
    }
  }

  // ── Task 2: Every 30 min — story follow updates ────────────
  else {
    results.task = 'story-follow-check';

    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const { data: allFollowed } = await supabase
        .from('followed_stories')
        .select('*')
        .eq('is_active', true)
        .gte('followed_at', sevenDaysAgo)
        .order('last_checked', { ascending: true })
        .limit(15);

      if (allFollowed && allFollowed.length > 0) {
        // Deduplicate same headlines
        const uniqueStories = [];
        const seenHeadlines = new Set();
        for (const story of allFollowed) {
          const key = story.headline.slice(0, 50);
          if (!seenHeadlines.has(key)) {
            seenHeadlines.add(key);
            uniqueStories.push(story);
          }
        }

        for (const story of uniqueStories.slice(0, 8)) {
          results.storiesChecked++;
          try {
            const searchQuery = encodeURIComponent(
              story.headline.split(' ').slice(0, 5).join(' ')
            );
            const gnewsUrl  = `https://gnews.io/api/v4/search?q=${searchQuery}&lang=en&max=3&apikey=${GNEWS_API_KEY}`;
            const gnewsRes  = await fetch(gnewsUrl);
            const gnewsData = await gnewsRes.json();
            const newArticles = (gnewsData.articles || []).filter(a =>
              new Date(a.publishedAt) > new Date(story.followed_at)
            );

            if (newArticles.length === 0) continue;

            const articlesList = newArticles.map((a, i) => `${i + 1}. [${a.source?.name}] ${a.title}`).join('\n');

            const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
              method:  'POST',
              headers: {
                'Content-Type':      'application/json',
                'x-api-key':         ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model:      'claude-sonnet-4-20250514',
                max_tokens: 200,
                system:     'You assess news updates. Respond only with valid JSON.',
                messages: [{
                  role:    'user',
                  content: `Original story: "${story.headline}"\nNew articles:\n${articlesList}\nIs there a significant new development? Return: {"hasUpdate": bool, "headline": "new headline or null", "significance": "high/med/low", "updateType": "development/resolution/escalation", "notificationText": "max 20 words or null"}`
                }]
              })
            });

            const claudeData = await claudeRes.json();
            let assessment = {};
            try { assessment = JSON.parse(claudeData.content?.[0]?.text || '{}'); } catch (e) { continue; }

            if (assessment.hasUpdate && assessment.headline) {
              results.updatesFound++;

              await supabase.from('story_updates').insert({
                article_id:   story.article_id,
                headline:     assessment.headline,
                summary:      assessment.notificationText,
                source:       newArticles[0]?.source?.name,
                source_url:   newArticles[0]?.url,
                update_type:  assessment.updateType  || 'development',
                significance: assessment.significance || 'med',
              });

              await supabase
                .from('followed_stories')
                .update({ last_checked: new Date().toISOString(), update_count: (story.update_count || 0) + 1 })
                .eq('article_id', story.article_id)
                .eq('is_active', true);

              // Queue push notification for high significance
              if (assessment.significance === 'high' && assessment.notificationText) {
                await supabase.from('notification_queue').insert({
                  article_id:   story.article_id,
                  session_id:   story.session_id,
                  user_id:      story.user_id,
                  title:        `Story update · ${story.topic_label || story.topic}`,
                  body:         assessment.notificationText,
                  significance: assessment.significance,
                  sent:         false,
                }).catch(() => {});
              }
            }

            await sleep(500);

          } catch (storyError) {
            results.errors.push(`Story check failed: ${storyError.message}`);
          }
        }
      }
    } catch (e) {
      results.errors.push(`Story follow check error: ${e.message}`);
    }
  }

  // ── Task 3: Always — clean expired cache ───────────────────
  try {
    const { error } = await supabase.rpc('clean_expired_cache');
    if (!error) results.cacheEntriesCleaned = 1;
  } catch (e) {}

  console.log('Cron complete:', results);
  return response.status(200).json({ success: true, results });
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
