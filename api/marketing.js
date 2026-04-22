const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BACKEND_URL = 'https://verityn-backend-ten.vercel.app';

const ROTATION = [
  { countries: ['IN','DE'], interests: ['Finance','Politics'] },
  { countries: ['IN','GB'], interests: ['Technology','Business'] },
  { countries: ['IN','US'], interests: ['Finance','Technology'] },
  { countries: ['IN','DE'], interests: ['Politics','Science'] },
  { countries: ['IN','AU'], interests: ['Business','Technology'] },
  { countries: ['DE','US'], interests: ['Finance','Politics'] },
  { countries: ['PH','AE'], interests: ['Business','Technology'] },
  { countries: ['KR','GB'], interests: ['Technology','Science'] },
  { countries: ['MX','US'], interests: ['Finance','Politics'] },
  { countries: ['EG','DE'], interests: ['Politics','Business'] },
  { countries: ['AU','GB'], interests: ['Finance','Business'] },
  { countries: ['ZA','GB'], interests: ['Politics','Finance'] },
];

function getTodayRotation() {
  const start = new Date('2025-01-01');
  const today = new Date();
  const days = Math.floor((today - start) / 86400000);
  return ROTATION[Math.floor(days / 2) % ROTATION.length];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  if (action === 'generate') {
    try {
      const rotation = getTodayRotation();
      const country = rotation.countries[0];

      // Fetch news
      const newsRes = await fetch(
        `${BACKEND_URL}/api/content?action=news&country=${country}&category=general&max=20`
      );
      const newsData = await newsRes.json();
      const articles = newsData.articles || [];

      // Fetch briefing
      const briefingRes = await fetch(`${BACKEND_URL}/api/ai?action=briefing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countries: rotation.countries,
          interests: rotation.interests,
          articles
        })
      });
      const briefing = await briefingRes.json();

      const stories = briefing.stories || [];
      const storiesText = stories.map((s, i) =>
        `${i + 1}. ${s.headline}\n   → ${s.why}`
      ).join('\n\n');

      // Generate content with Claude
      const prompt = `You are the content team for Verityn, a news intelligence app for time-poor professionals living outside their home country.

Today's briefing mood: ${briefing.mood}

Today's audience: professionals in ${rotation.countries.join(' + ')} interested in ${rotation.interests.join(' + ')}

Today's 7 stories:
${storiesText}

Write the following separated by ---SPLIT--- between each section:

HOOK
One punchy opening line max 15 words that stops the scroll. No hashtags.

---SPLIT---

INSTAGRAM BODY
List 7 headlines as:
01 · headline
02 · headline
etc.
Then one sentence: today's mood.
End with: Your morning briefing, personalised for where you live and what you do. Link in bio.
No hashtags here.

---SPLIT---

HASHTAGS
8 relevant hashtags based on today's stories and audience. All on one line.

---SPLIT---

LINKEDIN
Professional tone. 150-200 words. Lead with most business-relevant story. End with: Get your full briefing on Verityn.

---SPLIT---

TWITTER
7 tweets, one per story, max 240 chars each. Format: 1/ headline → why it matters. End tweet 7 with: Get your personalised briefing → verityn.news`;

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const claudeData = await claudeRes.json();
      const text = claudeData.content[0].text;
      const parts = text.split('---SPLIT---');

      const result = {
        rotation,
        mood: briefing.mood,
        stories: stories.map(s => s.headline),
        hook: parts[0] ? parts[0].replace(/^HOOK/i, '').trim() : '',
        instagramBody: parts[1] ? parts[1].replace(/^INSTAGRAM BODY/i, '').trim() : '',
        hashtags: parts[2] ? parts[2].replace(/^HASHTAGS/i, '').trim() : '',
        linkedin: parts[3] ? parts[3].replace(/^LINKEDIN/i, '').trim() : '',
        twitter: parts[4] ? parts[4].replace(/^TWITTER/i, '').trim() : '',
        date: new Date().toLocaleDateString('en-GB', {
          day: '2-digit', month: '2-digit', year: '2-digit'
        }).replace(/\//g, '.')
      };

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
