module.exports = async function handler(req, res) {
    try {
        var { createClient } = require('@supabase/supabase-js');
        var supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

        var result = await supabase.from('newsletter_cache').select('stories').limit(1).single();

        return res.json({
            ok: true,
            supabase: 'connected',
            hasData: !!(result.data && result.data.stories),
            error: result.error ? result.error.message : null,
        });
    } catch (e) {
        return res.json({ ok: false, error: e.message, stack: (e.stack || '').split('\n').slice(0, 3) });
    }
};
