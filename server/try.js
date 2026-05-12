// Dashboard histogram backend — powered by dbt018
// dbt015 → (every 10s) → dbt018

const express = require('express');
const router = express.Router();
const { db } = require('./config/database');
const { authenticateToken } = require('./middleware/auth');

function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthStr() { return new Date().toISOString().slice(0, 7); }
function yearStr()  { return new Date().getFullYear().toString(); }
function hourNow()  { return new Date().getHours(); }

// ─── GET /api/try/histogram-data ─────────────────────────────────────────────
// Histogram 1: total breaches per hour today  (all farms combined)
// Histogram 2: total breaches per day this month (all farms combined)

router.get('/histogram-data', authenticateToken, (req, res) => {
    try {
        const userToken = req.user.token;
        const today = todayStr();
        const month = monthStr();

        const hist1 = db.prepare(`
            SELECT hour as h, SUM(breach_count) as c
            FROM dbt018
            WHERE user_token = ? AND date = ?
            GROUP BY hour
            ORDER BY hour
        `).all(userToken, today);

        const hist2 = db.prepare(`
            SELECT date, SUM(breach_count) as c
            FROM dbt018
            WHERE user_token = ? AND month = ?
            GROUP BY date
            ORDER BY date
        `).all(userToken, month);

        res.json({ hist1, hist2, today, month });
    } catch (e) {
        console.error('histogram-data error:', e);
        res.status(500).json({ error: 'Failed to fetch histogram data' });
    }
});

// ─── Transfer dbt015 → dbt018 ─────────────────────
// Runs every 10s. Groups by (user_token, farm_token) and upserts into dbt018.

function transferDbt15ToDbt18() {
    try {
        const breaches = db.prepare(`
            SELECT user_token, farm_token,
                   SUM(breach_count_minute) as total
            FROM dbt015
            WHERE farm_token IS NOT NULL AND farm_token != ''
            GROUP BY user_token, farm_token
        `).all();

        if (!breaches.length) return { success: true, transferred: 0 };

        const today = todayStr();
        const month = monthStr();
        const year  = yearStr();
        const hour  = hourNow();

        const upsert = db.prepare(`
            INSERT INTO dbt018
                (user_token, farm_token, date, month, year, hour, breach_count)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_token, farm_token, date, hour) DO UPDATE SET
                breach_count = breach_count + excluded.breach_count
        `);

        db.transaction(() => {
            for (const { user_token, farm_token, total } of breaches) {
                upsert.run(user_token, farm_token, today, month, year, hour, total);
            }
            db.prepare('DELETE FROM dbt015').run();
        })();

        console.log(`[dbt018] Transferred ${breaches.length} group(s) → dbt018`);
        return { success: true, transferred: breaches.length };
    } catch (e) {
        console.error('transferDbt15ToDbt18 error:', e);
        return { success: false, error: e.message };
    }
}

module.exports = router;
module.exports.transferDbt15ToDbt18 = transferDbt15ToDbt18;
