const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Dashboard statistics endpoint
router.get('/stats', authenticateToken, (req, res) => {
  try {
    const farmerToken = req.user.token;

    // Get total cows and farms from farmer record
    const farmerStmt = db.prepare('SELECT total_farms, total_cows FROM dbt001 WHERE user_token = ?');
    const farmerStats = farmerStmt.get(farmerToken);

    // Get cows with most alarm breaches
    const topCowsStmt = db.prepare(`
      SELECT cow_name as cow_id, total_breach as breach_count
      FROM dbt004
      WHERE user_token = ? AND total_breach > 0
      ORDER BY total_breach DESC
      LIMIT 5
    `);
    const topCows = topCowsStmt.all(farmerToken);

    // Get summary of cow states
    const stateStmt = db.prepare(`
      SELECT
        state_fence as state,
        COUNT(*) as count
      FROM dbt004
      WHERE user_token = ?
      GROUP BY state_fence
    `);
    const cowStates = stateStmt.all(farmerToken);

    // Get total time spent stats
    const timeStmt = db.prepare(`
      SELECT
        SUM(time_inside) as total_time_inside,
        SUM(time_outside) as total_time_outside,
        SUM(total_breach) as total_breaches
      FROM dbt004
      WHERE user_token = ?
    `);
    const timeStats = timeStmt.get(farmerToken);

    res.json({
      totalFarms: farmerStats ? farmerStats.total_farms : 0,
      totalCows: farmerStats ? farmerStats.total_cows : 0,
      topCows,
      cowStates,
      timeStats: {
        totalTimeInside: timeStats.total_time_inside || 0,
        totalTimeOutside: timeStats.total_time_outside || 0,
        totalBreaches: timeStats.total_breaches || 0
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Notifications endpoint
router.get('/notifications', authenticateToken, (req, res) => {
  try {
    const farmerToken = req.user.token;

    // Get all notifications for this farmer (unread and read)
    const stmt = db.prepare(`
      SELECT
        notification_id,
        cow_token,
        notification_type,
        message,
        metadata,
        is_read,
        timestamp,
        sender,
        receiver,
        message_type
      FROM dbt008
      WHERE receiver = ?
      ORDER BY timestamp DESC
      LIMIT 50
    `);

    const notifications = stmt.all(farmerToken);

    // Parse metadata JSON if it exists
    const formattedNotifications = notifications.map(notif => ({
      ...notif,
      metadata: notif.metadata ? JSON.parse(notif.metadata) : null
    }));

    res.json({ notifications: formattedNotifications });
  } catch (error) {
    console.error('Notifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark notification as read
router.put('/notifications/:id/read', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const farmerToken = req.user.token;

    // Verify the notification belongs to this farmer
    const checkStmt = db.prepare('SELECT receiver FROM dbt008 WHERE notification_id = ?');
    const notification = checkStmt.get(id);

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notification.receiver !== farmerToken) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Mark as read
    const updateStmt = db.prepare('UPDATE dbt008 SET is_read = 1 WHERE notification_id = ?');
    updateStmt.run(id);

    res.json({ success: true });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark all notifications as read
router.put('/notifications/mark-all-read', authenticateToken, (req, res) => {
  try {
    const farmerToken = req.user.token;

    const updateStmt = db.prepare('UPDATE dbt008 SET is_read = 1 WHERE receiver = ? AND is_read = 0');
    const result = updateStmt.run(farmerToken);

    res.json({ success: true, updatedCount: result.changes });
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Database test endpoint
router.get('/database/test', authenticateToken, (req, res) => {
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'dbt%' ORDER BY name").all();
    const userCount = db.prepare('SELECT COUNT(*) as count FROM dbt001').get();

    res.json({
      success: true,
      database: {
        connected: true,
        type: 'SQLite',
        file: './modeblack.db',
        tables: tables.map(row => row.name),
        user_count: userCount.count
      }
    });
  } catch (error) {
    console.error('Database test error:', error);
    res.status(500).json({
      success: false,
      error: 'Database connection failed',
      details: error.message
    });
  }
});

module.exports = router;
