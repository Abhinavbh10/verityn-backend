module.exports = async function handler(req, res) {
    return res.json({ ok: true, action: req.query.action || 'none', time: new Date().toISOString() });
};
