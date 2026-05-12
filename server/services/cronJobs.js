const cron = require('node-cron');
const { db } = require('../config/database');
const { sendDailyReportEmail } = require('./emailService');

// msg7 — Send daily report to every farmer who has cows (daily at 23:59)
function schedule24MPFReport() {
  cron.schedule('59 23 * * *', async () => {
    console.log('[Cron] Sending daily reports...');
    try {
      const today = new Date().toISOString().slice(0, 10);

      // Get all farmers who have at least one cow
      const farmers = db.prepare(`
        SELECT DISTINCT d.user_id, d.farmer_name, d.user_token
        FROM dbt001 d
        INNER JOIN dbt004 c ON c.user_token = d.user_token
      `).all();

      for (const farmer of farmers) {
        try {
          const stats = db.prepare(`
            SELECT
              COUNT(*) as totalCows,
              SUM(CASE WHEN state_fence IN ('zone1','zone2','zone3') THEN 1 ELSE 0 END) as cowsInside,
              SUM(CASE WHEN state_fence = 'none' OR state_fence IS NULL THEN 1 ELSE 0 END) as cowsOutside,
              (SELECT COUNT(*) FROM dbt002 WHERE user_token = ?) as totalFarms
            FROM dbt004
            WHERE user_token = ?
          `).get(farmer.user_token, farmer.user_token);

          const breachRow = db.prepare(`
            SELECT COALESCE(SUM(breach_count), 0) as breachesToday
            FROM dbt018
            WHERE user_token = ? AND date = ?
          `).get(farmer.user_token, today);

          const report = {
            totalCows:    stats?.totalCows    || 0,
            cowsInside:   stats?.cowsInside   || 0,
            cowsOutside:  stats?.cowsOutside  || 0,
            totalFarms:   stats?.totalFarms   || 0,
            breachesToday: breachRow?.breachesToday || 0
          };

          await sendDailyReportEmail(farmer.user_id, farmer.farmer_name, report);
        } catch (e) {
          console.error(`[Cron] Daily report failed for ${farmer.user_id}:`, e.message);
        }
      }

      console.log(`[Cron] Daily reports sent to ${farmers.length} farmer(s)`);
    } catch (error) {
      console.error('[Cron] Daily report cron error:', error);
    }
  });
}

// Schedule database cleanup (daily at midnight)
function scheduleDatabaseCleanup() {
  cron.schedule('0 0 * * *', async () => {
    try {
      // Reset daily statistics if needed
      // For now, we keep historical data in the simplified schema
      // Future enhancement: could archive old data or reset counters

      console.log('Database cleanup check completed');
    } catch (error) {
      console.error('Database cleanup error:', error);
    }
  });
}

// Check for inactive farmers and mark as disconnected (every minute)
function scheduleInactivityCheck() {
  cron.schedule('* * * * *', async () => {
    try {
      // Mark farmers as disconnected if last_seen is older than 2 minutes
      const inactivityThreshold = 2; // minutes

      const updateStmt = db.prepare(`
        UPDATE dbt001
        SET connection_state = 'disconnected'
        WHERE connection_state = 'connected'
        AND last_seen < datetime('now', '-${inactivityThreshold} minutes')
      `);

      const result = updateStmt.run();

      if (result.changes > 0) {
        console.log(`Marked ${result.changes} farmer(s) as disconnected due to inactivity`);
      }
    } catch (error) {
      console.error('Inactivity check error:', error);
    }
  });
}

// Initialize all cron jobs
function initializeCronJobs() {
  schedule24MPFReport();
  scheduleDatabaseCleanup();
  scheduleInactivityCheck();
  console.log('Cron jobs initialized');
}

module.exports = { initializeCronJobs };
