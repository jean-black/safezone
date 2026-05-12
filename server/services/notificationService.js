const { db } = require('../config/database');
const { sendLoginFailureNotification } = require('./emailService');
const { now, formatDateTime } = require('../utils/dateFormatter');

// Get SafeZone developer token (cached)
let DEVELOPER_TOKEN = null;
function getDeveloperToken() {
  if (!DEVELOPER_TOKEN) {
    const developer = db.prepare('SELECT user_token FROM dbt010 WHERE developer_name = ?').get('SafeZone');
    if (developer) {
      DEVELOPER_TOKEN = developer.developer_token;
    }
  }
  return DEVELOPER_TOKEN;
}

// Message types - these use auto-generated messages (message column is NULL)
const MESSAGE_TYPES = {
  LOGIN_FAIL:          'login fail attempt',
  PASSWORD_CHANGE:     'change of password',
  PASSWORD_RESET:      'password recovery successfully',
  EMAIL_CHANGE:        'change of email address',
  USERNAME_CHANGE:     'change of username',
  COW_BREACH:          'cow break line2 alarm',
  COW_RECOVERY:        'cow recovery attempt',
  NEW_COW_REGISTERED:  'new cow added registration',
  DAILY_REPORT:        'daily report',
  ESP32_CONNECTED:     'new esp32 connected',
  ESP32_OFFLINE:       'esp32 cow went offline'
};

/**
 * Create a notification in the database
 * @param {string} senderToken - The sender's token (uses developer token if null)
 * @param {string} receiverToken - The receiver's token
 * @param {string} messageType - Type of message from MESSAGE_TYPES
 * @param {string} customMessage - Optional custom message (only for non-auto types)
 * @param {string} cowToken - Optional cow token
 * @param {object} metadata - Optional metadata as JSON (only for specific types)
 */
function createNotification(senderToken, receiverToken, messageType, customMessage = null, cowToken = null, metadata = null) {
  try {
    // Use developer token if sender is null (system messages)
    const actualSender = senderToken || getDeveloperToken();

    // Message types that should have metadata
    const METADATA_TYPES = [
      MESSAGE_TYPES.PASSWORD_CHANGE,
      MESSAGE_TYPES.EMAIL_CHANGE,
      MESSAGE_TYPES.COW_BREACH,
      MESSAGE_TYPES.COW_RECOVERY,
      MESSAGE_TYPES.NEW_COW_REGISTERED,
      MESSAGE_TYPES.DAILY_REPORT,
      MESSAGE_TYPES.ESP32_CONNECTED,
      MESSAGE_TYPES.PASSWORD_RESET,
      MESSAGE_TYPES.ESP32_OFFLINE
    ];

    // Only populate metadata for allowed types
    const shouldHaveMetadata = METADATA_TYPES.includes(messageType);
    const metadataString = (shouldHaveMetadata && metadata) ? JSON.stringify(metadata) : null;

    const insertStmt = db.prepare(`
      INSERT INTO dbt008 (
        cow_token, notification_type, message,
        metadata, is_read, timestamp, sender, receiver, message_type
      )
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
    `);

    // For auto-generated message types, set message to NULL
    const messageValue = customMessage || null;

    // Use server's local time instead of UTC
    const currentTime = now();

    insertStmt.run(
      cowToken,
      messageType, // notification_type (for backward compatibility)
      messageValue,
      metadataString,
      currentTime, // timestamp in local time
      actualSender, // sender token (developer token for system messages)
      receiverToken, // receiver token
      messageType // message_type
    );

    console.log(`Notification created: ${messageType} for receiver ${receiverToken}`);
    return true;
  } catch (error) {
    console.error('Error creating notification:', error);
    return false;
  }
}

/**
 * Handle failed login attempt
 * @param {string} email - User email
 * @param {string} location - GPS coordinates or IP location
 * @param {string} country - Country name
 */
async function handleFailedLogin(email, location, country) {
  try {
    // Get user info - check both farmers (dbt001) and developers (dbt010)
    let user = db.prepare('SELECT * FROM dbt001 WHERE user_id = ?').get(email);
    let isDeveloper = false;
    let userName, userToken;

    // If not found in dbt1, check dbt010 (developers)
    if (!user) {
      user = db.prepare('SELECT * FROM dbt010 WHERE email = ?').get(email);
      isDeveloper = true;
    }

    if (!user) {
      return;
    }

    // Get user details based on user type
    if (isDeveloper) {
      userName = user.developer_name;
      userToken = user.developer_token;
    } else {
      userName = user.farmer_name;
      userToken = user.user_token;
    }

    // Increment failed login attempts
    const currentAttempts = (user.failed_login_attempts || 0) + 1;
    const nowTime = now();

    // Update failed login attempts in the correct table
    if (isDeveloper) {
      const updateStmt = db.prepare(`
        UPDATE dbt010
        SET failed_login_attempts = ?,
            last_failed_login = ?,
            failed_login_location = ?,
            failed_login_country = ?
        WHERE email = ?
      `);
      updateStmt.run(currentAttempts, nowTime, location, country, email);
    } else {
      const updateStmt = db.prepare(`
        UPDATE dbt001
        SET failed_login_attempts = ?,
            last_failed_login = ?,
            failed_login_location = ?,
            failed_login_country = ?
        WHERE user_id = ?
      `);
      updateStmt.run(currentAttempts, nowTime, location, country, email);
    }

    // If 3 or more failed attempts, send notification
    if (currentAttempts >= 3) {
      // Create app notification (message is NULL, auto-generated from message_type)
      // LOGIN_FAIL does not use metadata
      createNotification(
        null, // sender (NULL for system messages)
        userToken, // receiver token (user_token or developer_token)
        MESSAGE_TYPES.LOGIN_FAIL,
        null, // no custom message, auto-generated
        null, // no cow_token
        null  // no metadata for login fail
      );

      // Send email notification
      try {
        await sendLoginFailureNotification(
          email,
          userName,
          currentAttempts,
          location,
          country,
          nowTime
        );
      } catch (emailError) {
        console.error('Error sending login failure email:', emailError);
      }
    }

    return currentAttempts;
  } catch (error) {
    console.error('Error handling failed login:', error);
    return 0;
  }
}

/**
 * Reset failed login attempts on successful login
 * @param {string} email - User email
 */
function resetFailedLoginAttempts(email) {
  try {
    // Check if user is in dbt001 (farmers) or dbt010 (developers)
    const farmer = db.prepare('SELECT user_id FROM dbt001 WHERE user_id = ?').get(email);

    if (farmer) {
      // Reset for farmer
      const updateStmt = db.prepare(`
        UPDATE dbt001
        SET failed_login_attempts = 0,
            last_failed_login = NULL,
            failed_login_location = NULL,
            failed_login_country = NULL
        WHERE user_id = ?
      `);
      updateStmt.run(email);
    } else {
      // Reset for developer
      const updateStmt = db.prepare(`
        UPDATE dbt010
        SET failed_login_attempts = 0,
            last_failed_login = NULL,
            failed_login_location = NULL,
            failed_login_country = NULL
        WHERE email = ?
      `);
      updateStmt.run(email);
    }

    console.log(`Reset failed login attempts for ${email}`);
  } catch (error) {
    console.error('Error resetting failed login attempts:', error);
  }
}

/**
 * Create notification for password change
 * @param {string} farmerToken - The farmer's token
 * @param {string} farmerName - The farmer's name
 * @param {string} email - User email
 */
async function notifyPasswordChange(farmerToken, farmerName, email) {
  // PASSWORD_CHANGE uses metadata
  createNotification(
    null, // sender (NULL for system messages)
    farmerToken, // receiver token
    MESSAGE_TYPES.PASSWORD_CHANGE,
    null, // no custom message, auto-generated
    null, // no cow_token
    { timestamp: now() }
  );

  console.log(`Password change notification sent for ${email}`);
}

/**
 * Create notification for username change
 * @param {string} farmerToken - The farmer's token
 * @param {string} farmerEmail - The farmer's email
 * @param {string} oldUsername - Old username
 * @param {string} newUsername - New username
 */
function notifyUsernameChange(farmerToken, farmerEmail, oldUsername, newUsername) {
  // USERNAME_CHANGE does not use metadata
  createNotification(
    null, // sender (NULL for system messages)
    farmerToken, // receiver token
    MESSAGE_TYPES.USERNAME_CHANGE,
    null, // no custom message, auto-generated
    null, // no cow_token
    null  // no metadata for username change
  );

  console.log(`Username change notification created: ${oldUsername} -> ${newUsername}`);
}

/**
 * Create notification for email change
 * @param {string} farmerToken - The farmer's token
 * @param {string} oldEmail - Old email
 * @param {string} newEmail - New email
 */
function notifyEmailChange(farmerToken, oldEmail, newEmail) {
  // EMAIL_CHANGE uses metadata
  createNotification(
    null, // sender (NULL for system messages)
    farmerToken, // receiver token
    MESSAGE_TYPES.EMAIL_CHANGE,
    null, // no custom message, auto-generated
    null, // no cow_token
    { oldEmail, newEmail, timestamp: now() }
  );

  console.log(`Email change notification created: ${oldEmail} -> ${newEmail}`);
}

/**
 * Create notification for cow breach
 * @param {string} farmerToken - The farmer's token
 * @param {string} cowToken - The cow's token
 * @param {string} cowName - The cow's name
 * @param {string} location - GPS location
 */
function notifyCowBreach(farmerToken, cowToken, cowName, location) {
  try {
    // COW_BREACH uses metadata
    createNotification(
      null, // sender (NULL for system messages)
      farmerToken, // receiver token
      MESSAGE_TYPES.COW_BREACH,
      null, // no custom message, auto-generated
      cowToken,
      { cowName, location, timestamp: now() }
    );

    console.log(`Cow breach notification created for ${cowName}`);
  } catch (error) {
    console.error('Error creating cow breach notification:', error);
  }
}

/**
 * Create notification for cow recovery attempt
 * @param {string} farmerToken - The farmer's token
 * @param {string} cowToken - The cow's token
 * @param {string} cowName - The cow's name
 * @param {string} helperName - Name of person helping with recovery
 * @param {string} recoveryId - Optional recovery ID (e.g., recovery1, recovery2)
 */
function notifyCowRecovery(farmerToken, cowToken, cowName, helperName, recoveryId = null) {
  try {
    // COW_RECOVERY uses metadata with recovery_id
    const metadata = {
      cowName,
      helperName,
      timestamp: now()
    };

    // Add recovery_id to metadata if provided
    if (recoveryId) {
      metadata.recoveryId = recoveryId;
    }

    createNotification(
      null, // sender (NULL for system messages)
      farmerToken, // receiver token
      MESSAGE_TYPES.COW_RECOVERY,
      null, // no custom message, auto-generated
      cowToken,
      metadata
    );

    console.log(`Cow recovery notification created for ${cowName}${recoveryId ? ` (${recoveryId})` : ''}`);
  } catch (error) {
    console.error('Error creating cow recovery notification:', error);
  }
}

/**
 * Create notification for new cow registration
 * @param {string} farmerToken - The farmer's token
 * @param {string} cowToken - The cow's token
 * @param {string} cowName - The cow's name
 * @param {string} collarId - The collar MAC address
 */
function notifyNewCowRegistered(farmerToken, cowToken, cowName, collarId) {
  try {
    // NEW_COW_REGISTERED uses metadata
    createNotification(
      null, // sender (NULL for system messages)
      farmerToken, // receiver token
      MESSAGE_TYPES.NEW_COW_REGISTERED,
      null, // no custom message, auto-generated
      cowToken,
      { cowName, collarId, timestamp: now() }
    );

    console.log(`New cow registration notification created for ${cowName}`);
  } catch (error) {
    console.error('Error creating new cow registration notification:', error);
  }
}

/**
 * Get unread notifications for a farmer
 * @param {string} farmerToken - The farmer's token
 * @returns {Array} Array of unread notifications
 */
function getUnreadNotifications(farmerToken) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM dbt008
      WHERE receiver = ? AND is_read = 0
      ORDER BY timestamp DESC
    `);

    return stmt.all(farmerToken);
  } catch (error) {
    console.error('Error getting unread notifications:', error);
    return [];
  }
}

/**
 * Mark notification as read
 * @param {number} notificationId - The notification ID
 */
function markAsRead(notificationId) {
  try {
    const updateStmt = db.prepare('UPDATE dbt008 SET is_read = 1 WHERE notification_id = ?');
    updateStmt.run(notificationId);
    return true;
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return false;
  }
}

/**
 * Mark all notifications as read for a farmer
 * @param {string} farmerToken - The farmer's token
 */
function markAllAsRead(farmerToken) {
  try {
    const updateStmt = db.prepare('UPDATE dbt008 SET is_read = 1 WHERE receiver = ? AND is_read = 0');
    updateStmt.run(farmerToken);
    return true;
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    return false;
  }
}

// msg9 in-app — password recovery successfully completed
function notifyPasswordReset(userToken) {
  createNotification(null, userToken, MESSAGE_TYPES.PASSWORD_RESET, null, null, { timestamp: now() });
  console.log(`Password reset notification created for token: ${userToken}`);
}

// msg8 in-app — new ESP32 device connected
function notifyESP32Connected(userToken, macAddress, deviceId) {
  createNotification(null, userToken, MESSAGE_TYPES.ESP32_CONNECTED, null, null, { macAddress, deviceId, timestamp: now() });
  console.log(`ESP32 connected notification created for token: ${userToken}`);
}

// msg11 in-app — ESP32 cow went offline
function notifyESP32Offline(userToken, cowToken, cowName, macAddress) {
  createNotification(null, userToken, MESSAGE_TYPES.ESP32_OFFLINE, null, cowToken, { cowName, macAddress, timestamp: now() });
  console.log(`ESP32 offline notification created for cow: ${cowName}`);
}

module.exports = {
  MESSAGE_TYPES,
  createNotification,
  handleFailedLogin,
  resetFailedLoginAttempts,
  notifyPasswordChange,
  notifyPasswordReset,
  notifyUsernameChange,
  notifyEmailChange,
  notifyCowBreach,
  notifyCowRecovery,
  notifyNewCowRegistered,
  notifyESP32Connected,
  notifyESP32Offline,
  getUnreadNotifications,
  markAsRead,
  markAllAsRead
};
