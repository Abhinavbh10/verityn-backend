// api/admin.js — Admin endpoint for Verityn newsletter alerts + events.
//
// GET  /api/admin?key=<ADMIN_KEY>           → HTML page with two textareas
// POST /api/admin?action=alerts&key=<KEY>   → replace active_alerts (body: { text: "line1\nline2" })
// POST /api/admin?action=events&key=<KEY>   → replace events (body: { text: "2026-06-07 | Sat 13:00 · Kreuzberg | Title | Detail" })
//
// Auth: ADMIN_KEY env var matched against `key` query param. Simple but works.
// Set ADMIN_KEY in Vercel project env vars. Pick a long random string.

var SUPABASE_URL = process.env.SUPABASE_URL;
var SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
    var { createClient } = require('@supabase/supabase-js');
    return createClient(SUPABASE_URL, SUPABASE_KEY);
}

function checkAuth(req) {
    var key = (req.query && req.query.key) || '';
    var expected = process.env.ADMIN_KEY;
    if (!expected) return false;
    return key === expected;
}

// Render the admin HTML page with current alerts + events loaded
async function renderAdminPage(req, res, supabase) {
    var alertsResp, eventsResp;
    try {
        alertsResp = await supabase
            .from('active_alerts')
            .select('text, expires_at')
            .order('priority', { ascending: false });
    } catch (e) {
        alertsResp = { data: [] };
    }
    try {
        eventsResp = await supabase
            .from('events')
            .select('sort_date, when_label, title, detail')
            .gte('sort_date', new Date().toISOString().slice(0, 10))
            .order('sort_date', { ascending: true });
    } catch (e) {
        eventsResp = { data: [] };
    }

    var alertLines = (alertsResp.data || []).map(function(a) { return a.text; }).join('\n');
    var eventLines = (eventsResp.data || []).map(function(e) {
        return e.sort_date + ' | ' + (e.when_label || '') + ' | ' + (e.title || '') + ' | ' + (e.detail || '');
    }).join('\n');

    var key = req.query.key || '';
    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Verityn Admin</title>'
        + '<style>body{font-family:-apple-system,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1F1810;background:#FBF5E8}'
        + 'h1{font-family:Georgia,serif;font-size:28px;font-weight:400;border-bottom:3px solid #D14A28;padding-bottom:8px;margin-bottom:24px}'
        + 'h2{font-family:Georgia,serif;font-size:20px;font-weight:400;color:#1F1810;margin-top:32px}'
        + 'p{color:#5A4A30;font-size:14px;line-height:1.5}'
        + 'textarea{width:100%;min-height:160px;padding:14px;border:1px solid #C9B98A;background:#fff;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5}'
        + 'button{background:#1F1810;color:#FBF5E8;border:none;padding:10px 24px;font-size:14px;font-weight:600;letter-spacing:0.5px;cursor:pointer;margin-top:12px}'
        + 'button:hover{background:#D14A28}'
        + 'pre{background:rgba(31,24,16,0.04);padding:14px;border-radius:4px;font-size:12px}'
        + '.status{margin-top:12px;padding:10px 14px;border-radius:4px;display:none}'
        + '.status.ok{background:#E6F2E0;color:#3F6E3F;display:block}'
        + '.status.err{background:#FBE0DC;color:#A03A20;display:block}'
        + '</style></head><body>'
        + '<h1>Verityn Admin</h1>'

        + '<h2>Active Alerts</h2>'
        + '<p>One alert per line. Renders as the red strip at the top of the email. Empty input = no alerts shown.</p>'
        + '<p><strong>Example:</strong><br><code>S-Bahn S1 partial closure Wannsee–Potsdam until 18:00</code></p>'
        + '<textarea id="alerts" placeholder="One alert per line">' + escapeHtml(alertLines) + '</textarea>'
        + '<div><button onclick="save(\'alerts\')">Save alerts</button></div>'
        + '<div class="status" id="alerts-status"></div>'

        + '<h2>Events</h2>'
        + '<p>One event per line, pipe-separated: <code>YYYY-MM-DD | when_label | title | detail</code>. Past events auto-purged.</p>'
        + '<p><strong>Example:</strong><br><code>2026-06-07 | Sat 7 June · 13:00 · Kreuzberg | Karneval der Kulturen — Street Parade | Annual cultural festival returns to Yorckstraße. Free entry.</code></p>'
        + '<textarea id="events" placeholder="YYYY-MM-DD | when_label | title | detail (one per line)">' + escapeHtml(eventLines) + '</textarea>'
        + '<div><button onclick="save(\'events\')">Save events</button></div>'
        + '<div class="status" id="events-status"></div>'

        + '<script>'
        + 'var key=' + JSON.stringify(key) + ';'
        + 'async function save(kind){'
        + '  var text=document.getElementById(kind).value;'
        + '  var st=document.getElementById(kind+"-status");'
        + '  st.className="status";st.textContent="Saving…";'
        + '  try{'
        + '    var r=await fetch("/api/admin?action="+kind+"&key="+encodeURIComponent(key),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:text})});'
        + '    var d=await r.json();'
        + '    if(d.ok){st.className="status ok";st.textContent="Saved "+d.count+" rows.";}'
        + '    else{st.className="status err";st.textContent="Error: "+(d.error||"unknown");}'
        + '  }catch(e){st.className="status err";st.textContent="Error: "+e.message;}'
        + '}'
        + '</script></body></html>';
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
}

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = async function handler(req, res) {
    if (!checkAuth(req)) {
        res.statusCode = 401;
        return res.json({ ok: false, error: 'Unauthorized' });
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        res.statusCode = 500;
        return res.json({ ok: false, error: 'Supabase not configured' });
    }

    var supabase = getSupabase();
    var action = (req.query && req.query.action) || '';

    if (req.method === 'GET' && !action) {
        return renderAdminPage(req, res, supabase);
    }

    if (req.method === 'POST' && action === 'alerts') {
        try {
            var body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
            var text = (body.text || '').trim();
            var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);

            // Replace strategy: delete all, insert new.
            await supabase.from('active_alerts').delete().gte('id', 0);

            if (lines.length > 0) {
                var rows = lines.map(function(line, i) {
                    return {
                        text: line,
                        priority: lines.length - i,   // first lines higher priority
                        expires_at: null,
                    };
                });
                var ins = await supabase.from('active_alerts').insert(rows);
                if (ins.error) throw new Error(ins.error.message);
            }
            return res.json({ ok: true, count: lines.length });
        } catch (e) {
            res.statusCode = 500;
            return res.json({ ok: false, error: e.message });
        }
    }

    if (req.method === 'POST' && action === 'events') {
        try {
            var body2 = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
            var text2 = (body2.text || '').trim();
            var lines2 = text2.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);

            var parsed = lines2.map(function(line) {
                var parts = line.split('|').map(function(p) { return p.trim(); });
                if (parts.length < 3) return null;
                var sortDate = parts[0];
                // Basic format check: YYYY-MM-DD
                if (!/^\d{4}-\d{2}-\d{2}$/.test(sortDate)) return null;
                return {
                    sort_date: sortDate,
                    when_label: parts[1] || '',
                    title: parts[2] || '',
                    detail: parts[3] || '',
                };
            }).filter(Boolean);

            await supabase.from('events').delete().gte('id', 0);

            if (parsed.length > 0) {
                var ins2 = await supabase.from('events').insert(parsed);
                if (ins2.error) throw new Error(ins2.error.message);
            }
            return res.json({ ok: true, count: parsed.length });
        } catch (e) {
            res.statusCode = 500;
            return res.json({ ok: false, error: e.message });
        }
    }

    res.statusCode = 400;
    return res.json({ ok: false, error: 'Unknown action' });
};
