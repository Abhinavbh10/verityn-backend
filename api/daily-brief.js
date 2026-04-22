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
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Verityn · Daily Brief</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
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
#card-preview{background:#0D0D0F;border-left:3px solid #C0392B;border-radius:4px;padding:24px 20px;margin-bottom:12px}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.card-logo{font-family:monospace;font-size:10px;letter-spacing:0.15em;color:#F5F0E8;text-transform:uppercase}
.card-date-text{font-family:monospace;font-size:9px;color:rgba(245,240,232,0.3)}
.card-rotation{text-align:center;font-family:monospace;font-size:8px;letter-spacing:0.15em;color:rgba(245,240,232,0.3);text-transform:uppercase;border-top:1px solid rgba(245,240,232,0.07);border-bottom:1px solid rgba(245,240,232,0.07);padding:7px 0;margin-bottom:14px}
.card-mood{font-family:Georgia,serif;font-size:12px;font-style:italic;color:#F5F0E8;line-height:1.5;margin-bottom:14px}
.card-divider{height:1px;background:rgba(245,240,232,0.07);margin-bottom:12px}
.card-story{display:flex;gap:10px;margin-bottom:9px;align-items:baseline}
.card-num{font-family:monospace;font-size:9px;color:#C0392B;min-width:18px;flex-shrink:0}
.card-headline{font-size:11px;color:rgba(245,240,232,0.82);line-height:1.4}
.card-footer{display:flex;justify-content:space-between;margin-top:14px;padding-top:10px;border-top:1px solid rgba(245,240,232,0.07)}
.card-footer-url{font-family:monospace;font-size:8px;color:rgba(245,240,232,0.2)}
.card-footer-tag{font-family:Georgia,serif;font-size:9px;font-style:italic;color:rgba(245,240,232,0.15)}
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
    <div class="section-label">📸 Instagram Card — Download & Post</div>
    <div id="card-preview">
      <div class="card-header">
        <div class="card-logo">V · Verityn Daily Brief</div>
        <div class="card-date-text" id="c-date"></div>
      </div>
      <div class="card-rotation" id="c-rotation"></div>
      <div class="card-mood" id="c-mood"></div>
      <div class="card-divider"></div>
      <div id="c-stories"></div>
      <div class="card-footer">
        <div class="card-footer-url">verityn.news</div>
        <div class="card-footer-tag">7 stories. Why they matter to you.</div>
      </div>
    </div>
    <button class="dl-btn" onclick="downloadCard()">⬇ Download Card as PNG</button>
  </div>

  <div class="block">
    <div class="block-header">
      <div class="block-label">🪝 Hook</div>
      <button class="copy-btn" onclick="copyText('hook-text', this)">Copy</button>
    </div>
    <div class="hook-content" id="hook-text"></div>
  </div>

  <div class="divider-line"></div>

  <div class="block">
    <div class="block-header">
      <div class="block-label">📝 Instagram Caption</div>
      <button class="copy-btn" onclick="copyText('ig-text', this)">Copy</button>
    </div>
    <div class="block-content" id="ig-text"></div>
  </div>

  <div class="block">
    <div class="block-header">
      <div class="block-label"># Hashtags</div>
      <button class="copy-btn" onclick="copyText('ht-text', this)">Copy</button>
    </div>
    <div class="hashtags-content" id="ht-text"></div>
  </div>

  <div class="divider-line"></div>

  <div class="block">
    <div class="block-header">
      <div class="block-label">💼 LinkedIn Post</div>
      <button class="copy-btn" onclick="copyText('li-text', this)">Copy</button>
    </div>
    <div class="block-content" id="li-text"></div>
  </div>

  <div class="divider-line"></div>

  <div class="block">
    <div class="block-header">
      <div class="block-label">🐦 Twitter Thread</div>
      <button class="copy-btn" onclick="copyText('tw-text', this)">Copy</button>
    </div>
    <div class="block-content" id="tw-text"></div>
  </div>

</div>

<script>
const today = new Date();
const dateStr = today.toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}).replace(/\\//g,'.');
document.getElementById('today-date').textContent = dateStr;

async function generate() {
  const btn = document.getElementById('gen-btn');
  const spinner = document.getElementById('spinner');
  const btnText = document.getElementById('btn-text');
  const status = document.getElementById('status');

  btn.disabled = true;
  spinner.style.display = 'block';
  btnText.textContent = 'Generating...';
  status.textContent = 'Fetching news...';

  try {
    status.textContent = 'Generating briefing & content...';
    const res = await fetch('/api/daily-brief?action=generate');
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const d = json.data;

    document.getElementById('c-date').textContent = d.date;
    document.getElementById('c-rotation').textContent = d.rotation.countries.join(' + ') + '  ·  ' + d.rotation.interests.join(' + ');
    document.getElementById('c-mood').textContent = '"' + d.mood + '"';
    document.getElementById('c-stories').innerHTML = d.stories.map((h,i) =>
      '<div class="card-story"><div class="card-num">0'+(i+1)+'</div><div class="card-headline">'+h+'</div></div>'
    ).join('');

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
  const card = document.getElementById('card-preview');
  const canvas = await html2canvas(card, {
    backgroundColor: '#0D0D0F',
    scale: 3,
    useCORS: true,
    logging: false
  });
  const link = document.createElement('a');
  link.download = 'verityn-' + dateStr + '.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function copyText(id, btn) {
  const text = document.getElementById(id).textContent;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied ✓';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}
<\/script>
</body>
</html>`;

export default async function handler(req, res) {
  // Serve the HTML page
  if (req.method === 'GET' && !req.query.action) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(HTML);
  }

  // Generate content
  if (req.query.action === 'generate') {
    try {
      const rotation = getTodayRotation();
      const country = rotation.countries[0];

      const newsRes = await fetch(
        `${BACKEND_URL}/api/content?action=news&country=${country}&category=general&max=20`
      );
      const newsData = await newsRes.json();
      const articles = newsData.articles || [];

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

      const prompt = `You are the content team for Verityn, a news intelligence app for time-poor professionals living outside their home country.

Today's briefing mood: ${briefing.mood}
Today's audience: professionals in ${rotation.countries.join(' + ')} interested in ${rotation.interests.join(' + ')}
Today's 7 stories:
${storiesText}

Write the following separated ONLY by the text ---SPLIT--- on its own line between each section. No other separators.

HOOK
One punchy opening line max 15 words that stops the scroll. No hashtags.

---SPLIT---

INSTAGRAM BODY
List 7 headlines as 01 · headline format. Then one sentence mood. End with: Your morning briefing, personalised for where you live and what you do. Link in bio.

---SPLIT---

HASHTAGS
8 relevant hashtags all on one line.

---SPLIT---

LINKEDIN
Professional tone 150-200 words. End with: Get your full briefing on Verityn.

---SPLIT---

TWITTER
7 tweets one per story max 240 chars each. Format: 1/ headline → why. End tweet 7 with: Get your personalised briefing → verityn.news`;

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
          stories: stories.map(s => s.headline),
          hook: parts[0] ? parts[0].replace(/^HOOK/i,'').trim() : '',
          instagramBody: parts[1] ? parts[1].replace(/^INSTAGRAM BODY/i,'').trim() : '',
          hashtags: parts[2] ? parts[2].replace(/^HASHTAGS/i,'').trim() : '',
          linkedin: parts[3] ? parts[3].replace(/^LINKEDIN/i,'').trim() : '',
          twitter: parts[4] ? parts[4].replace(/^TWITTER/i,'').trim() : '',
          date: new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}).replace(/\//g,'.')
        }
      });

    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
