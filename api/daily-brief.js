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

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>Verityn · Daily Brief</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0A0A0C;color:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;min-height:100vh;padding-bottom:60px}
.header{padding:52px 24px 24px;border-bottom:1px solid rgba(245,240,232,0.08);display:flex;align-items:center;justify-content:space-between}
.logo{display:flex;align-items:center;gap:10px}
.logo-v{width:28px;height:28px;background:#C0392B;display:flex;align-items:center;justify-content:center;font-family:Georgia,serif;font-size:16px;color:#F5F0E8;border-radius:4px}
.logo-text{font-size:13px;font-weight:500;letter-spacing:0.1em;color:#F5F0E8;text-transform:uppercase}
.date{font-size:11px;color:rgba(245,240,232,0.35);font-family:monospace}
.gen-btn{margin:24px;width:calc(100% - 48px);padding:18px;background:#C0392B;color:#F5F0E8;border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:opacity 0.15s}
.gen-btn:active{opacity:0.75}
.gen-btn:disabled{opacity:0.4}
.spinner{width:18px;height:18px;border:2px solid rgba(245,240,232,0.3);border-top-color:#F5F0E8;border-radius:50%;animation:spin 0.8s linear infinite;display:none;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}
.status{text-align:center;font-size:12px;color:rgba(245,240,232,0.4);padding:0 24px 16px;min-height:20px;font-family:monospace}
.content{display:none}
.card-section{padding:0 24px 8px}
.section-label{font-size:10px;letter-spacing:0.2em;color:rgba(245,240,232,0.35);text-transform:uppercase;margin-bottom:12px;font-family:monospace}
.card-picker{display:flex;gap:8px;margin-bottom:14px}
.card-pick-btn{flex:1;padding:10px;border:1px solid rgba(245,240,232,0.15);border-radius:8px;background:transparent;color:rgba(245,240,232,0.5);font-size:12px;font-weight:600;cursor:pointer;text-align:center;transition:all 0.15s}
.card-pick-btn.active{border-color:#C0392B;color:#F5F0E8;background:rgba(192,57,43,0.15)}

/* ── Shared card structure ── */
.card-preview{border-radius:4px;padding:28px 22px;margin-bottom:12px}
.card-header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:20px}
.card-logo-wrap{display:flex;align-items:baseline;gap:0}
.card-logo-v{font-family:Georgia,serif;font-size:22px;font-weight:700;color:#C0392B}
.card-story{margin-bottom:16px;padding-bottom:14px}
.card-story:last-child{border-bottom:none;margin-bottom:8px;padding-bottom:0}
.card-story-top{display:flex;gap:10px;align-items:baseline;margin-bottom:6px}
.card-num{font-family:Georgia,serif;font-size:14px;font-weight:700;color:#C0392B;min-width:20px;flex-shrink:0}
.card-footer{display:flex;justify-content:space-between;align-items:center;padding-top:12px}
.card-footer-tag{font-family:Georgia,serif;font-size:9px;font-style:italic}

/* ── Dark card ── */
.card-dark{background:#0D0D0F;border-left:3px solid #C0392B}
.card-dark .card-logo-name{font-size:20px;font-weight:900;color:#F5F0E8;letter-spacing:-0.3px}
.card-dark .card-date-text{font-family:monospace;font-size:9px;color:rgba(245,240,232,0.3)}
.card-dark .card-mood{font-family:Georgia,serif;font-size:13px;font-style:italic;color:rgba(245,240,232,0.7);line-height:1.6;margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid rgba(245,240,232,0.07)}
.card-dark .card-story{border-bottom:1px solid rgba(245,240,232,0.05)}
.card-dark .card-headline{font-family:Georgia,serif;font-size:13px;font-weight:700;color:#F5F0E8;line-height:1.4}
.card-dark .card-why{font-size:11px;color:rgba(245,240,232,0.55);line-height:1.5;padding-left:30px;margin-top:4px}
.card-dark .card-more{font-size:10px;color:rgba(245,240,232,0.3);text-align:center;margin:12px 0 8px;font-style:italic}
.card-dark .card-footer{border-top:1px solid rgba(245,240,232,0.07)}
.card-dark .card-footer-url{font-family:monospace;font-size:8px;color:rgba(245,240,232,0.2)}
.card-dark .card-footer-tag{color:rgba(245,240,232,0.15)}

/* ── Light card ── */
.card-light{background:#FAF8F4;border-left:3px solid #C0392B}
.card-light .card-logo-name{font-size:20px;font-weight:900;color:#111111;letter-spacing:-0.3px}
.card-light .card-date-text{font-family:monospace;font-size:9px;color:rgba(0,0,0,0.3)}
.card-light .card-mood{font-family:Georgia,serif;font-size:13px;font-style:italic;color:rgba(0,0,0,0.55);line-height:1.6;margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid rgba(0,0,0,0.08)}
.card-light .card-story{border-bottom:1px solid rgba(0,0,0,0.06)}
.card-light .card-headline{font-family:Georgia,serif;font-size:13px;font-weight:700;color:#111111;line-height:1.4}
.card-light .card-why{font-size:11px;color:#3D2B1F;line-height:1.5;padding-left:30px;margin-top:4px}
.card-light .card-more{font-size:10px;color:rgba(0,0,0,0.3);text-align:center;margin:12px 0 8px;font-style:italic}
.card-light .card-footer{border-top:1px solid rgba(0,0,0,0.08)}
.card-light .card-footer-url{font-family:monospace;font-size:8px;color:rgba(0,0,0,0.25)}
.card-light .card-footer-tag{color:rgba(0,0,0,0.2)}

.dl-btn{width:100%;padding:14px;background:rgba(192,57,43,0.15);color:#C0392B;border:1px solid rgba(192,57,43,0.3);border-radius:10px;font-size:14px;font-weight:500;cursor:pointer;margin-bottom:28px;transition:background 0.15s}
.dl-btn:active{background:rgba(192,57,43,0.25)}
.block{margin:0 24px 20px}
.block-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.block-label{font-size:10px;letter-spacing:0.2em;color:rgba(245,240,232,0.35);text-transform:uppercase;font-family:monospace}
.copy-btn{font-size:12px;color:#C0392B;background:none;border:none;cursor:pointer;font-weight:500;padding:4px 8px;border-radius:6px}
.copy-btn.copied{color:#27AE60}
.block-content{background:#111114;border-left:2px solid #C0392B;border-radius:0 8px 8px 0;padding:16px;font-size:14px;line-height:1.7;color:rgba(245,240,232,0.85);white-space:pre-wrap;word-break:break-word}
.hook-content{background:#111114;border-left:2px solid #C0392B;border-radius:0 8px 8px 0;padding:16px;font-size:17px;font-weight:600;line-height:1.4;color:#F5F0E8}
.hashtags-content{background:#111114;border-left:2px solid rgba(192,57,43,0.4);border-radius:0 8px 8px 0;padding:16px;font-size:13px;color:rgba(245,240,232,0.6);line-height:1.8;word-break:break-word}
.divider-line{height:1px;background:rgba(245,240,232,0.06);margin:4px 24px 28px}
</style>
</head>
<body>

<div class="header">
  <div class="logo">
    <div class="logo-v">V</div>
    <div class="logo-text">Daily Brief</div>
  </div>
  <div class="date" id="today-date"></div>
</div>

<button class="gen-btn" id="gen-btn" onclick="generate()">
  <div class="spinner" id="spinner"></div>
  <span id="btn-text">Generate Today's Content</span>
</button>

<div class="status" id="status"></div>

<div class="content" id="content">

  <div class="card-section">
    <div class="section-label">Instagram Card — Pick Theme & Download</div>

    <div class="card-picker">
      <button class="card-pick-btn active" id="pick-dark" onclick="switchCard('dark')">Dark</button>
      <button class="card-pick-btn" id="pick-light" onclick="switchCard('light')">Light</button>
    </div>

    <!-- Dark card -->
    <div class="card-preview card-dark" id="card-dark">
      <div class="card-header">
        <div class="card-logo-wrap">
          <span class="card-logo-v">V</span><span class="card-logo-name">erityn</span>
        </div>
        <div class="card-date-text cd-date"></div>
      </div>
      <div class="card-mood cd-mood"></div>
      <div class="cd-stories"></div>
      <div class="card-more">+ 4 more stories in your daily briefing</div>
      <div class="card-footer">
        <div class="card-footer-url">verityn.news</div>
        <div class="card-footer-tag">7 stories. Why they matter to you.</div>
      </div>
    </div>

    <!-- Light card -->
    <div class="card-preview card-light" id="card-light" style="display:none">
      <div class="card-header">
        <div class="card-logo-wrap">
          <span class="card-logo-v">V</span><span class="card-logo-name">erityn</span>
        </div>
        <div class="card-date-text cd-date"></div>
      </div>
      <div class="card-mood cd-mood"></div>
      <div class="cd-stories"></div>
      <div class="card-more">+ 4 more stories in your daily briefing</div>
      <div class="card-footer">
        <div class="card-footer-url">verityn.news</div>
        <div class="card-footer-tag">7 stories. Why they matter to you.</div>
      </div>
    </div>

    <button class="dl-btn" onclick="downloadCard()">Download Card as PNG</button>
  </div>

  <div class="block">
    <div class="block-header">
      <div class="block-label">Hook</div>
      <button class="copy-btn" onclick="copyText('hook-text', this)">Copy</button>
    </div>
    <div class="hook-content" id="hook-text"></div>
  </div>

  <div class="divider-line"></div>

  <div class="block">
    <div class="block-header">
      <div class="block-label">Instagram Caption</div>
      <button class="copy-btn" onclick="copyText('ig-text', this)">Copy</button>
    </div>
    <div class="block-content" id="ig-text"></div>
  </div>

  <div class="block">
    <div class="block-header">
      <div class="block-label">Hashtags</div>
      <button class="copy-btn" onclick="copyText('ht-text', this)">Copy</button>
    </div>
    <div class="hashtags-content" id="ht-text"></div>
  </div>

  <div class="divider-line"></div>

  <div class="block">
    <div class="block-header">
      <div class="block-label">LinkedIn Post</div>
      <button class="copy-btn" onclick="copyText('li-text', this)">Copy</button>
    </div>
    <div class="block-content" id="li-text"></div>
  </div>

  <div class="divider-line"></div>

  <div class="block">
    <div class="block-header">
      <div class="block-label">Twitter Thread</div>
      <button class="copy-btn" onclick="copyText('tw-text', this)">Copy</button>
    </div>
    <div class="block-content" id="tw-text"></div>
  </div>

</div>

<script>
const today = new Date();
const dateStr = today.toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}).replace(/\\//g,'.');
document.getElementById('today-date').textContent = dateStr;

let activeTheme = 'dark';

function switchCard(theme) {
  activeTheme = theme;
  document.getElementById('card-dark').style.display = theme === 'dark' ? 'block' : 'none';
  document.getElementById('card-light').style.display = theme === 'light' ? 'block' : 'none';
  document.getElementById('pick-dark').classList.toggle('active', theme === 'dark');
  document.getElementById('pick-light').classList.toggle('active', theme === 'light');
}

function buildStoryHTML(stories) {
  return stories.map((s, i) => {
    const whyFirst = (s.why || '').split('.')[0] + '.';
    return '<div class="card-story">' +
      '<div class="card-story-top">' +
        '<div class="card-num">0' + (i+1) + '</div>' +
        '<div class="card-headline">' + s.headline + '</div>' +
      '</div>' +
      '<div class="card-why">' + whyFirst + '</div>' +
    '</div>';
  }).join('');
}

async function generate() {
  const btn = document.getElementById('gen-btn');
  const spinner = document.getElementById('spinner');
  const btnText = document.getElementById('btn-text');
  const status = document.getElementById('status');

  btn.disabled = true;
  spinner.style.display = 'block';
  btnText.textContent = 'Generating...';
  status.textContent = 'Fetching news from all countries...';

  try {
    status.textContent = 'Generating briefing & content...';
    const res = await fetch('/api/daily-brief?action=generate');
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const d = json.data;

    // Fill both cards with the same data
    const storyHTML = buildStoryHTML(d.cardStories);
    document.querySelectorAll('.cd-date').forEach(el => el.textContent = d.date);
    document.querySelectorAll('.cd-mood').forEach(el => el.textContent = '"' + d.mood + '"');
    document.querySelectorAll('.cd-stories').forEach(el => el.innerHTML = storyHTML);

    document.getElementById('hook-text').textContent = d.hook;
    document.getElementById('ig-text').textContent = d.instagramBody;
    document.getElementById('ht-text').textContent = d.hashtags;
    document.getElementById('li-text').textContent = d.linkedin;
    document.getElementById('tw-text').textContent = d.twitter;

    document.getElementById('content').style.display = 'block';
    status.textContent = '';
    document.getElementById('content').scrollIntoView({behavior:'smooth'});

  } catch(err) {
    status.textContent = 'Error: ' + err.message;
  } finally {
    btn.disabled = false;
    spinner.style.display = 'none';
    btnText.textContent = 'Regenerate';
  }
}

async function downloadCard() {
  const cardId = activeTheme === 'dark' ? 'card-dark' : 'card-light';
  const card = document.getElementById(cardId);
  const bgColor = activeTheme === 'dark' ? '#0D0D0F' : '#FAF8F4';
  const canvas = await html2canvas(card, {
    backgroundColor: bgColor,
    scale: 3,
    useCORS: true,
    logging: false
  });
  const link = document.createElement('a');
  link.download = 'verityn-' + activeTheme + '-' + dateStr + '.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function copyText(id, btn) {
  const text = document.getElementById(id).textContent;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}
<\/script>
</body>
</html>`;

export default async function handler(req, res) {
  if (req.method === 'GET' && !req.query.action) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(HTML);
  }

  if (req.query.action === 'generate') {
    try {
      const rotation = getTodayRotation();

      const fetchPromises = rotation.countries.flatMap(country => [
        fetch(`${BACKEND_URL}/api/content?action=news&country=${country.toLowerCase()}&category=general&max=12&sessionId=social`)
          .then(r => r.json()).then(d => d.articles || []).catch(() => []),
        fetch(`${BACKEND_URL}/api/content?action=rss&country=${country.toLowerCase()}&max=10&sessionId=social`)
          .then(r => r.json()).then(d => d.articles || []).catch(() => []),
      ]);
      const allResults = await Promise.all(fetchPromises);
      const articles = allResults.flat();

      const seen = new Set();
      const deduped = articles.filter(a => {
        const k = (a.headline || '').slice(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
      });

      const briefingRes = await fetch(`${BACKEND_URL}/api/ai?action=briefing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countries: rotation.countries.map(c => c.toLowerCase()),
          interests: rotation.interests.map(i => i.toLowerCase()),
          articles: deduped.slice(0, 40),
          sessionId: 'social',
          ts: Date.now(),
        })
      });
      const briefing = await briefingRes.json();
      const stories = briefing.stories || [];

      if (stories.length < 7) {
        return res.status(500).json({ success: false, error: 'Briefing returned fewer than 7 stories' });
      }

      const cardStories = stories.slice(0, 3);
      const storiesText = stories.map((s, i) =>
        `${i + 1}. ${s.headline}\n   → ${s.why}`
      ).join('\n\n');

      const prompt = `You are the content team for Verityn, a news intelligence app for time-poor professionals.

Today's briefing mood: ${briefing.mood}

Today's 7 stories with personalised why-lines:
${storiesText}

Write the following separated by ---SPLIT--- between each section:

HOOK
One punchy opening line max 15 words that stops the scroll. No hashtags. No emoji.

---SPLIT---

INSTAGRAM BODY
Start with today's mood sentence in quotes.
Then list 3 stories (the first 3) with their why-lines. Format:
01 · headline
→ first sentence of the why-line only

02 · headline
→ first sentence of the why-line only

03 · headline
→ first sentence of the why-line only

Then: "+ 4 more stories in your daily briefing"
Then: "Your morning briefing, personalised for where you live and what you do."
Then: "Link in bio → verityn.news"
No hashtags here.

---SPLIT---

HASHTAGS
8 relevant hashtags based on today's stories. All on one line.

---SPLIT---

LINKEDIN
Professional tone. 150-200 words. Lead with the most business-relevant story and its why-line. Show how Verityn connects global events to professional impact. End with: Get your full briefing at verityn.news

---SPLIT---

TWITTER
5 tweets max 240 chars each. Format:
1/ headline → one-line why
Use the strongest stories. End with: Your 7-story briefing, personalised → verityn.news`;

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

      return res.status(200).json({
        success: true,
        data: {
          rotation,
          mood: briefing.mood,
          allStories: stories.map(s => ({ headline: s.headline, why: s.why })),
          cardStories: cardStories.map(s => ({ headline: s.headline, why: s.why })),
          hook: parts[0] ? parts[0].replace(/^HOOK/i, '').trim() : '',
          instagramBody: parts[1] ? parts[1].replace(/^INSTAGRAM BODY/i, '').trim() : '',
          hashtags: parts[2] ? parts[2].replace(/^HASHTAGS/i, '').trim() : '',
          linkedin: parts[3] ? parts[3].replace(/^LINKEDIN/i, '').trim() : '',
          twitter: parts[4] ? parts[4].replace(/^TWITTER/i, '').trim() : '',
          date: new Date().toLocaleDateString('en-GB', {
            day: '2-digit', month: '2-digit', year: '2-digit'
          }).replace(/\//g, '.')
        }
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
