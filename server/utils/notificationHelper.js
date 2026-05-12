const { db } = require('../config/database');

/**
 * Create a notification for a farmer
 * @param {string} farmerToken - The farmer's token
 * @param {string} notificationType - Type of notification (failed_login, password_change, username_change, email_change, cow_breach, cow_recovery, new_cow_registered)
 * @param {string} message - The notification message
 * @param {Object} metadata - Optional metadata (e.g., cowId, location, etc.)
 */
function createNotification(farmerToken, notificationType, message, metadata = {}) {
    try {
        // Generate notification ID
        const notificationId = `NOTIF_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Insert notification into database
        const stmt = db.prepare(`
            INSERT INTO dbt008 (
                notification_id,
                user_token,
                notification_type,
                message,
                metadata,
                is_read,
                timestamp
            ) VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        `);

        stmt.run(
            notificationId,
            farmerToken,
            notificationType,
            message,
            JSON.stringify(metadata)
        );

        console.log(`[Notification] Created ${notificationType} notification for farmer ${farmerToken}`);

        return { success: true, notificationId };
    } catch (error) {
        console.error('[Notification Helper] Error creating notification:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Create notifications for multiple farmers
 * @param {Array<string>} farmerTokens - Array of farmer tokens
 * @param {string} notificationType - Type of notification
 * @param {string} message - The notification message
 * @param {Object} metadata - Optional metadata
 */
function createBulkNotifications(farmerTokens, notificationType, message, metadata = {}) {
    try {
        const results = [];

        farmerTokens.forEach(farmerToken => {
            const result = createNotification(farmerToken, notificationType, message, metadata);
            results.push(result);
        });

        return { success: true, results };
    } catch (error) {
        console.error('[Notification Helper] Error creating bulk notifications:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Get farmer token from email
 * @param {string} email - The farmer's email
 * @returns {string|null} - Farmer token or null
 */
function getFarmerTokenByEmail(email) {
    try {
        const stmt = db.prepare('SELECT user_token FROM dbt001 WHERE email = ?');
        const farmer = stmt.get(email);
        return farmer ? farmer.user_token : null;
    } catch (error) {
        console.error('[Notification Helper] Error getting farmer token:', error);
        return null;
    }
}

module.exports = {
    createNotification,
    createBulkNotifications,
    getFarmerTokenByEmail
};
