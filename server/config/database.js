const Database = require('better-sqlite3');
const path = require('path');

// Initialize SQLite database with timeout option
const dbPath = path.join(__dirname, '../../database/modeblack.db');
const db = new Database(dbPath, {
  timeout: 10000, // Wait up to 10 seconds for locks to clear
  verbose: null // Disable verbose logging (use console.log for debugging)
});

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Set synchronous mode to NORMAL for better performance with WAL
db.pragma('synchronous = NORMAL');

// Cache size for better performance
db.pragma('cache_size = -64000'); // 64MB cache

// Initialize database tables
function initializeDatabase() {
  try {
    // Create all tables with the new schema
    // IMPORTANT: All timestamp columns should be explicitly set using now() from dateFormatter
    // DEFAULT CURRENT_TIMESTAMP returns UTC time, not local time
    db.exec(`
      -- dbt1: Farmers table (with notification and security tracking)
      CREATE TABLE IF NOT EXISTS dbt001 (
        farmer_name TEXT NOT NULL,
        user_id TEXT NOT NULL UNIQUE,
        user_token TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        timestamp DATETIME,
        recovery_code TEXT,
        confirmation_code TEXT,
        total_farms INTEGER DEFAULT 0,
        total_cows INTEGER DEFAULT 0,
        failed_login_attempts INTEGER DEFAULT 0,
        last_failed_login DATETIME,
        failed_login_location TEXT,
        failed_login_country TEXT,
        developer_token TEXT,
        connected_at DATETIME,
        last_seen DATETIME,
        connection_state TEXT DEFAULT 'disconnected',
        is_banished INTEGER DEFAULT 0,
        user_account_type TEXT,
        banished_at DATETIME,
        user_parameter TEXT
      );

      -- dbt2: Farms table
      CREATE TABLE IF NOT EXISTS dbt002 (
        farm_name TEXT NOT NULL,
        farm_token TEXT PRIMARY KEY,
        user_token TEXT NOT NULL,
        farm_gps TEXT,
        timestamp DATETIME,
        ph TEXT,
        total_number_of_cow INTEGER DEFAULT 0,
        total_number_of_fence INTEGER DEFAULT 0,
        is_used INTEGER DEFAULT 0
      );

      -- dbt3: Fences table
      CREATE TABLE IF NOT EXISTS dbt003 (
        fence_name TEXT NOT NULL,
        fence_token TEXT PRIMARY KEY,
        user_token TEXT NOT NULL,
        fence_coordinate TEXT NOT NULL,
        area_size REAL,
        ph TEXT,
        farm_token TEXT,
        timestamp DATETIME,
        is_used INTEGER DEFAULT 0,
        FOREIGN KEY (farm_token) REFERENCES dbt002(farm_token) ON DELETE SET NULL
      );

      -- dbt4: Cows table
      CREATE TABLE IF NOT EXISTS dbt004 (
        cow_name TEXT NOT NULL,
        cow_nickname TEXT,
        cow_token TEXT PRIMARY KEY,
        collar_id TEXT NOT NULL UNIQUE,
        user_token TEXT,
        farm_token TEXT,
        timestamp DATETIME,
        state_fence TEXT DEFAULT 'unknown',
        time_inside INTEGER DEFAULT 0,
        time_outside INTEGER DEFAULT 0,
        total_breach INTEGER DEFAULT 0,
        gps_latitude REAL,
        gps_longitude REAL,
        collar_state TEXT DEFAULT 'disconnected',
        connected_at DATETIME,
        last_seen DATETIME,
        registered_at DATETIME,
        assigned_at DATETIME,
        actual_time_inside_fence INTEGER DEFAULT 0,
        actual_time_outside_fence INTEGER DEFAULT 0,
        zone_changed_at DATETIME,
        alarm1_triggered INTEGER,
        alarm2_triggered INTEGER,
        alarm3_triggered INTEGER,
        alarm1_triggered_at DATETIME,
        alarm2_triggered_at DATETIME,
        alarm3_triggered_at DATETIME,
        current_breach_cycle TEXT,
        FOREIGN KEY (farm_token) REFERENCES dbt002(farm_token) ON DELETE SET NULL
      );

      -- dbt5: New ESP32 connected cows table
      CREATE TABLE IF NOT EXISTS dbt005 (
        cow_name TEXT NOT NULL,
        cow_nickname TEXT,
        cow_token TEXT PRIMARY KEY,
        collar_id TEXT NOT NULL UNIQUE,
        timestamp DATETIME,
        collar_state TEXT DEFAULT 'disconnected',
        user_token TEXT,
        registered_at DATETIME,
        connected_at DATETIME,
        last_seen DATETIME
      );

      -- dbt6: Virtual cows table (user_token can be farmer or developer)
      CREATE TABLE IF NOT EXISTS dbt006 (
        cow_name TEXT NOT NULL,
        cow_nickname TEXT,
        cow_token TEXT PRIMARY KEY,
        collar_id TEXT NOT NULL UNIQUE,
        user_token TEXT,
        timestamp DATETIME,
        state_fence TEXT DEFAULT 'unknown',
        time_inside INTEGER DEFAULT 0,
        time_outside INTEGER DEFAULT 0,
        total_breach INTEGER DEFAULT 0,
        gps_latitude REAL,
        gps_longitude REAL,
        farm_token TEXT,
        registered_at DATETIME,
        assigned_at DATETIME,
        connected_at DATETIME,
        last_seen DATETIME,
        collar_state TEXT DEFAULT 'disconnected',
        virtual_controller_state TEXT,
        actual_time_inside_fence INTEGER DEFAULT 0,
        actual_time_outside_fence INTEGER DEFAULT 0,
        zone_changed_at DATETIME,
        alarm1_triggered INTEGER,
        alarm2_triggered INTEGER,
        alarm3_triggered INTEGER,
        alarm1_triggered_at DATETIME,
        alarm2_triggered_at DATETIME,
        alarm3_triggered_at DATETIME,
        current_breach_cycle TEXT,
        FOREIGN KEY (farm_token) REFERENCES dbt002(farm_token) ON DELETE SET NULL
      );

      -- dbt7: Farmer collaborative recovery table
      -- agent_id is the MAC address of the device that accepts recovery
      -- recovery_code enables agent to access page7
      CREATE TABLE IF NOT EXISTS dbt007 (
        recovery_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        user_token TEXT NOT NULL,
        farm_token TEXT NOT NULL,
        lost_cow_token TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME,
        connection_state TEXT DEFAULT 'disconnected',
        agent_accept_state TEXT DEFAULT 'pending',
        recovery_code TEXT NOT NULL,
        recovery_completion_state TEXT DEFAULT 'pending',
        FOREIGN KEY (farm_token) REFERENCES dbt002(farm_token) ON DELETE CASCADE,
        FOREIGN KEY (lost_cow_token) REFERENCES dbt004(cow_token) ON DELETE CASCADE
      );

      -- dbt8: Notifications (no FK — both farmers and developers send/receive)
      CREATE TABLE IF NOT EXISTS dbt008 (
        notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
        cow_token TEXT,
        notification_type TEXT NOT NULL,
        message TEXT,
        metadata TEXT,
        is_read INTEGER DEFAULT 0,
        timestamp DATETIME,
        sender TEXT,
        receiver TEXT,
        message_type TEXT
      );

      -- dbt10: Developers table
      CREATE TABLE IF NOT EXISTS dbt010 (
        developer_name TEXT NOT NULL,
        user_token TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        email TEXT,
        registered_at DATETIME,
        recovery_code TEXT,
        confirmation_code TEXT,
        total_farms INTEGER DEFAULT 0,
        total_cows INTEGER DEFAULT 0,
        failed_login_attempts INTEGER DEFAULT 0,
        last_failed_login DATETIME,
        failed_login_location TEXT,
        failed_login_country TEXT,
        connected_at DATETIME,
        last_seen DATETIME,
        connection_state TEXT DEFAULT 'disconnected',
        user_parameter TEXT
      );

      -- dbt11: Developer virtual agent collaborative recovery table
      -- virtual_agent_id is like agent1, agent2, etc.
      -- No recovery_code needed for virtual agents (page18 access)
      -- Note: lost_cow_token has NO foreign key - allows both real and virtual cows
      -- The actual cow relationship is managed through dbt014 junction table
      CREATE TABLE IF NOT EXISTS dbt011 (
        recovery_id TEXT PRIMARY KEY,
        virtual_agent_id TEXT NOT NULL,
        developer_token TEXT NOT NULL,
        farm_token TEXT NOT NULL,
        lost_cow_token TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME,
        connection_state TEXT DEFAULT 'disconnected',
        virtual_agent_accept_state TEXT DEFAULT 'pending',
        recovery_code TEXT,
        FOREIGN KEY (developer_token) REFERENCES dbt010(developer_token) ON DELETE CASCADE,
        FOREIGN KEY (farm_token) REFERENCES dbt002(farm_token) ON DELETE CASCADE
      );

      -- dbt13: Junction table for multiple cows in farmer recovery (dbt007)
      CREATE TABLE IF NOT EXISTS dbt013 (
        recovery_cow_id INTEGER PRIMARY KEY AUTOINCREMENT,
        recovery_id TEXT NOT NULL,
        cow_token TEXT NOT NULL,
        FOREIGN KEY (recovery_id) REFERENCES dbt007(recovery_id) ON DELETE CASCADE,
        FOREIGN KEY (cow_token) REFERENCES dbt004(cow_token) ON DELETE CASCADE
      );

      -- dbt14: Junction table for multiple cows in developer virtual recovery (dbt011)
      CREATE TABLE IF NOT EXISTS dbt014 (
        recovery_cow_id INTEGER PRIMARY KEY AUTOINCREMENT,
        recovery_id TEXT NOT NULL,
        cow_token TEXT NOT NULL,
        FOREIGN KEY (recovery_id) REFERENCES dbt011(recovery_id) ON DELETE CASCADE,
        FOREIGN KEY (cow_token) REFERENCES dbt006(cow_token) ON DELETE CASCADE
      );

      -- dbt15: Real-time breach collection (transfers to dbt018 every 10 seconds)
      CREATE TABLE IF NOT EXISTS dbt015 (
        user_token TEXT,
        farm_token TEXT DEFAULT '',
        minute_timestamp DATETIME,
        breach_count_minute INTEGER
      );

      -- dbt12: Virtual controller state (page19/page23)
      CREATE TABLE IF NOT EXISTS dbt012 (
        user_token TEXT PRIMARY KEY,
        selected_cow_token TEXT,
        selected_farm_token TEXT,
        connected_at DATETIME,
        last_seen_at DATETIME,
        connection_state TEXT DEFAULT 'disconnected',
        last_speed_scale INTEGER DEFAULT 1
      );

      -- dbt018: Unified breach statistics (histogram1, histogram2, per farm/user/day/month/year)
      CREATE TABLE IF NOT EXISTS dbt018 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_token TEXT NOT NULL,
        farm_token TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL,
        month TEXT NOT NULL,
        year TEXT NOT NULL,
        hour INTEGER NOT NULL,
        breach_count INTEGER DEFAULT 0,
        UNIQUE(user_token, farm_token, date, hour)
      );

      -- dbt031: Alarm settings per user (copy — source of truth is dbt001/dbt010 user_parameter)
      CREATE TABLE IF NOT EXISTS dbt031 (
        user_token TEXT PRIMARY KEY,
        alarm1_trigger_time INTEGER DEFAULT 10,
        audio_duration INTEGER DEFAULT 20,
        moment_of_activation INTEGER DEFAULT 25,
        distance_of_activation REAL DEFAULT 1.0,
        gmail_alerts_enabled INTEGER DEFAULT 1,
        daily_reports INTEGER DEFAULT 1,
        alert_frequency TEXT DEFAULT 'immediate',
        gmail_receiver TEXT
      );

      -- dbt032: System settings + global user stats
      CREATE TABLE IF NOT EXISTS dbt032 (
        id INTEGER PRIMARY KEY DEFAULT 1,
        email TEXT,
        email_app_passcode TEXT,
        developer_passcode TEXT,
        total_number_of_user INTEGER DEFAULT 0,
        total_number_of_banished_user INTEGER DEFAULT 0,
        total_number_of_connected_user INTEGER DEFAULT 0,
        CHECK (id = 1)
      );

      -- dbt033: Archived ESP32 cow records — moved here when a device is reassigned to a new user.
      --         Restored back to dbt004/dbt006 if the device is later reassigned to the original owner.
      CREATE TABLE IF NOT EXISTS dbt033 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        -- Original identity
        cow_name TEXT NOT NULL,
        cow_nickname TEXT,
        cow_token TEXT NOT NULL,
        collar_id TEXT NOT NULL,
        -- Ownership at archive time
        original_user_token TEXT NOT NULL,
        original_farm_token TEXT,
        original_table TEXT NOT NULL,     -- 'dbt004' or 'dbt006'
        archived_at DATETIME NOT NULL,
        archived_reason TEXT,             -- 'reassignment' | 'manual'
        -- Full cow stats preserved
        timestamp DATETIME,
        registered_at DATETIME,
        assigned_at DATETIME,
        connected_at DATETIME,
        last_seen DATETIME,
        state_fence TEXT DEFAULT 'unknown',
        time_inside INTEGER DEFAULT 0,
        time_outside INTEGER DEFAULT 0,
        total_breach INTEGER DEFAULT 0,
        actual_time_inside_fence INTEGER DEFAULT 0,
        actual_time_outside_fence INTEGER DEFAULT 0,
        gps_latitude REAL,
        gps_longitude REAL,
        collar_state TEXT DEFAULT 'disconnected',
        alarm1_triggered INTEGER,
        alarm2_triggered INTEGER,
        alarm3_triggered INTEGER,
        alarm1_triggered_at DATETIME,
        alarm2_triggered_at DATETIME,
        alarm3_triggered_at DATETIME,
        current_breach_cycle TEXT,
        reg_number INTEGER,
        cow_type TEXT DEFAULT 'esp32',
        zone_changed_at DATETIME
      );

      -- Create indexes for better performance
      CREATE INDEX IF NOT EXISTS idx_dbt002_farmer ON dbt002(user_token);
      CREATE INDEX IF NOT EXISTS idx_dbt003_farmer ON dbt003(user_token);
      CREATE INDEX IF NOT EXISTS idx_dbt004_farmer ON dbt004(user_token);
      CREATE INDEX IF NOT EXISTS idx_dbt004_farm ON dbt004(farm_token);
      CREATE INDEX IF NOT EXISTS idx_dbt008_receiver ON dbt008(receiver);
      CREATE INDEX IF NOT EXISTS idx_dbt008_sender ON dbt008(sender);
      CREATE INDEX IF NOT EXISTS idx_dbt008_read ON dbt008(is_read);
      CREATE INDEX IF NOT EXISTS idx_dbt008_type ON dbt008(notification_type);
      CREATE INDEX IF NOT EXISTS idx_dbt013_recovery ON dbt013(recovery_id);
      CREATE INDEX IF NOT EXISTS idx_dbt013_cow ON dbt013(cow_token);
      CREATE INDEX IF NOT EXISTS idx_dbt014_recovery ON dbt014(recovery_id);
      CREATE INDEX IF NOT EXISTS idx_dbt014_cow ON dbt014(cow_token);
      CREATE INDEX IF NOT EXISTS idx_dbt015_user ON dbt015(user_token);
      CREATE INDEX IF NOT EXISTS idx_dbt015_timestamp ON dbt015(minute_timestamp);
      CREATE INDEX IF NOT EXISTS idx_dbt018_user ON dbt018(user_token);
      CREATE INDEX IF NOT EXISTS idx_dbt018_farm ON dbt018(farm_token);
      CREATE INDEX IF NOT EXISTS idx_dbt018_date ON dbt018(date);
      CREATE INDEX IF NOT EXISTS idx_dbt033_collar ON dbt033(collar_id);
      CREATE INDEX IF NOT EXISTS idx_dbt033_owner ON dbt033(original_user_token);
    `);

    // Migrate existing tables - add missing columns if they don't exist

    // Add missing columns to dbt002 (farms)
    const dbt2Columns = db.pragma('table_info(dbt002)');
    const dbt2ColumnNames = dbt2Columns.map(col => col.name);

    // developer_token has been renamed to 'ph' - migration no longer needed
    // if (!dbt2ColumnNames.includes('developer_token')) {
    //   db.exec('ALTER TABLE dbt002 ADD COLUMN developer_token TEXT');
    //   console.log('Added developer_token column to dbt2');
    // }

    if (!dbt2ColumnNames.includes('total_number_of_cow')) {
      db.exec('ALTER TABLE dbt002 ADD COLUMN total_number_of_cow INTEGER DEFAULT 0');
      console.log('Added total_number_of_cow column to dbt2');
    }

    if (!dbt2ColumnNames.includes('total_number_of_fence')) {
      db.exec('ALTER TABLE dbt002 ADD COLUMN total_number_of_fence INTEGER DEFAULT 0');
      console.log('Added total_number_of_fence column to dbt2');
    }

    if (!dbt2ColumnNames.includes('is_used')) {
      db.exec('ALTER TABLE dbt002 ADD COLUMN is_used INTEGER DEFAULT 0');
      console.log('Added is_used column to dbt2');
    }

    // Migrate dbt003 - add missing columns if they don't exist
    const dbt3Columns = db.pragma('table_info(dbt003)');
    const dbt3ColumnNames = dbt3Columns.map(col => col.name);

    // developer_token has been renamed to 'ph' - migration no longer needed
    // if (!dbt3ColumnNames.includes('developer_token')) {
    //   db.exec('ALTER TABLE dbt003 ADD COLUMN developer_token TEXT');
    //   console.log('Added developer_token column to dbt3');
    // }

    if (!dbt3ColumnNames.includes('farm_token')) {
      db.exec('ALTER TABLE dbt003 ADD COLUMN farm_token TEXT');
      console.log('Added farm_token column to dbt3');
    }

    if (!dbt3ColumnNames.includes('is_used')) {
      db.exec('ALTER TABLE dbt003 ADD COLUMN is_used INTEGER DEFAULT 0');
      console.log('Added is_used column to dbt3');
    }

    if (!dbt3ColumnNames.includes('fence_thickness')) {
      db.exec('ALTER TABLE dbt003 ADD COLUMN fence_thickness REAL DEFAULT 0.5');
      console.log('Added fence_thickness column to dbt3');
    }

    if (!dbt3ColumnNames.includes('fence_perimeter')) {
      db.exec('ALTER TABLE dbt003 ADD COLUMN fence_perimeter REAL');
      console.log('Added fence_perimeter column to dbt3');
    }

    const columns = db.pragma('table_info(dbt004)');
    const columnNames = columns.map(col => col.name);

    if (!columnNames.includes('collar_state')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN collar_state TEXT DEFAULT "disconnected"');
      console.log('Added collar_state column to dbt4');
    }

    if (!columnNames.includes('connected_at')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN connected_at DATETIME');
      console.log('Added connected_at column to dbt4');
    }

    if (!columnNames.includes('last_seen')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN last_seen DATETIME');
      console.log('Added last_seen column to dbt4');
    }

    if (!columnNames.includes('registered_at')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN registered_at DATETIME');
      console.log('Added registered_at column to dbt4');
    }

    if (!columnNames.includes('assigned_at')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN assigned_at DATETIME');
      console.log('Added assigned_at column to dbt4');
    }

    if (!columnNames.includes('actual_time_inside_fence')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN actual_time_inside_fence INTEGER DEFAULT 0');
      console.log('Added actual_time_inside_fence column to dbt4');
    }

    if (!columnNames.includes('actual_time_outside_fence')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN actual_time_outside_fence INTEGER DEFAULT 0');
      console.log('Added actual_time_outside_fence column to dbt4');
    }

    if (!columnNames.includes('zone_changed_at')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN zone_changed_at DATETIME');
      console.log('Added zone_changed_at column to dbt4');
    }

    // Migrate dbt006 - add missing columns if they don't exist
    const dbt6Columns = db.pragma('table_info(dbt006)');
    const dbt6ColumnNames = dbt6Columns.map(col => col.name);

    if (!dbt6ColumnNames.includes('gps_latitude')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN gps_latitude REAL');
      console.log('Added gps_latitude column to dbt6');
    }

    if (!dbt6ColumnNames.includes('gps_longitude')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN gps_longitude REAL');
      console.log('Added gps_longitude column to dbt6');
    }

    if (!dbt6ColumnNames.includes('farm_token')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN farm_token TEXT');
      console.log('Added farm_token column to dbt6');
    }

    if (!dbt6ColumnNames.includes('actual_time_inside_fence')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN actual_time_inside_fence INTEGER DEFAULT 0');
      console.log('Added actual_time_inside_fence column to dbt6');
    }

    if (!dbt6ColumnNames.includes('actual_time_outside_fence')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN actual_time_outside_fence INTEGER DEFAULT 0');
      console.log('Added actual_time_outside_fence column to dbt6');
    }

    if (!dbt6ColumnNames.includes('zone_changed_at')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN zone_changed_at DATETIME');
      console.log('Added zone_changed_at column to dbt6');
    }

    if (!dbt6ColumnNames.includes('last_position_source')) {
      db.exec("ALTER TABLE dbt006 ADD COLUMN last_position_source TEXT DEFAULT 'virtual'");
      console.log('Added last_position_source column to dbt006');
    }

    if (!dbt6ColumnNames.includes('virtual_latitude')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN virtual_latitude REAL');
      console.log('Added virtual_latitude column to dbt006');
    }

    if (!dbt6ColumnNames.includes('virtual_longitude')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN virtual_longitude REAL');
      console.log('Added virtual_longitude column to dbt006');
    }

    // Add alarm state columns to dbt4
    if (!columnNames.includes('alarm1_triggered')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN alarm1_triggered INTEGER');
      console.log('Added alarm1_triggered column to dbt4');
    }

    if (!columnNames.includes('alarm2_triggered')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN alarm2_triggered INTEGER');
      console.log('Added alarm2_triggered column to dbt4');
    }

    if (!columnNames.includes('alarm3_triggered')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN alarm3_triggered INTEGER');
      console.log('Added alarm3_triggered column to dbt4');
    }

    if (!columnNames.includes('alarm1_triggered_at')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN alarm1_triggered_at DATETIME');
      console.log('Added alarm1_triggered_at column to dbt4');
    }

    if (!columnNames.includes('alarm2_triggered_at')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN alarm2_triggered_at DATETIME');
      console.log('Added alarm2_triggered_at column to dbt4');
    }

    if (!columnNames.includes('alarm3_triggered_at')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN alarm3_triggered_at DATETIME');
      console.log('Added alarm3_triggered_at column to dbt4');
    }

    if (!columnNames.includes('current_breach_cycle')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN current_breach_cycle TEXT');
      console.log('Added current_breach_cycle column to dbt4');
    }

    if (!columnNames.includes('registration_notified')) {
      db.exec('ALTER TABLE dbt004 ADD COLUMN registration_notified INTEGER DEFAULT 0');
      console.log('Added registration_notified column to dbt4');
    }

    // Add alarm state columns to dbt6
    if (!dbt6ColumnNames.includes('alarm1_triggered')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN alarm1_triggered INTEGER');
      console.log('Added alarm1_triggered column to dbt6');
    }

    if (!dbt6ColumnNames.includes('alarm2_triggered')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN alarm2_triggered INTEGER');
      console.log('Added alarm2_triggered column to dbt6');
    }

    if (!dbt6ColumnNames.includes('alarm3_triggered')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN alarm3_triggered INTEGER');
      console.log('Added alarm3_triggered column to dbt6');
    }

    if (!dbt6ColumnNames.includes('alarm1_triggered_at')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN alarm1_triggered_at DATETIME');
      console.log('Added alarm1_triggered_at column to dbt6');
    }

    if (!dbt6ColumnNames.includes('alarm2_triggered_at')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN alarm2_triggered_at DATETIME');
      console.log('Added alarm2_triggered_at column to dbt6');
    }

    if (!dbt6ColumnNames.includes('alarm3_triggered_at')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN alarm3_triggered_at DATETIME');
      console.log('Added alarm3_triggered_at column to dbt6');
    }

    if (!dbt6ColumnNames.includes('current_breach_cycle')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN current_breach_cycle TEXT');
      console.log('Added current_breach_cycle column to dbt6');
    }

    if (!dbt6ColumnNames.includes('registered_at')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN registered_at DATETIME');
      console.log('Added registered_at column to dbt6');
    }

    if (!dbt6ColumnNames.includes('assigned_at')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN assigned_at DATETIME');
      console.log('Added assigned_at column to dbt6');
    }

    if (!dbt6ColumnNames.includes('connected_at')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN connected_at DATETIME');
      console.log('Added connected_at column to dbt6');
    }

    if (!dbt6ColumnNames.includes('last_seen')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN last_seen DATETIME');
      console.log('Added last_seen column to dbt6');
    }

    if (!dbt6ColumnNames.includes('collar_state')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN collar_state TEXT DEFAULT "disconnected"');
      console.log('Added collar_state column to dbt6');
    }

    if (!dbt6ColumnNames.includes('virtual_controller_state')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN virtual_controller_state TEXT');
      console.log('Added virtual_controller_state column to dbt6');
    }

    if (!dbt6ColumnNames.includes('offline_mode_active')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN offline_mode_active INTEGER DEFAULT 0');
      console.log('Added offline_mode_active column to dbt6');
    }

    if (!dbt6ColumnNames.includes('registration_notified')) {
      db.exec('ALTER TABLE dbt006 ADD COLUMN registration_notified INTEGER DEFAULT 0');
      console.log('Added registration_notified column to dbt6');
    }

    // Migrate dbt001 - add missing columns if they don't exist
    const dbt1Columns = db.pragma('table_info(dbt001)');
    const dbt1ColumnNames = dbt1Columns.map(col => col.name);

    if (!dbt1ColumnNames.includes('developer_token')) {
      db.exec('ALTER TABLE dbt001 ADD COLUMN developer_token TEXT');
      console.log('Added developer_token column to dbt1');
    }

    if (!dbt1ColumnNames.includes('connected_at')) {
      db.exec('ALTER TABLE dbt001 ADD COLUMN connected_at DATETIME');
      console.log('Added connected_at column to dbt1');
    }

    if (!dbt1ColumnNames.includes('last_seen')) {
      db.exec('ALTER TABLE dbt001 ADD COLUMN last_seen DATETIME');
      console.log('Added last_seen column to dbt1');
    }

    if (!dbt1ColumnNames.includes('connection_state')) {
      db.exec('ALTER TABLE dbt001 ADD COLUMN connection_state TEXT DEFAULT "disconnected"');
      console.log('Added connection_state column to dbt1');
    }

    if (!dbt1ColumnNames.includes('is_banished')) {
      db.exec('ALTER TABLE dbt001 ADD COLUMN is_banished INTEGER DEFAULT 0');
      console.log('Added is_banished column to dbt1');
    }

    if (!dbt1ColumnNames.includes('user_account_type')) {
      db.exec('ALTER TABLE dbt001 ADD COLUMN user_account_type TEXT');
      console.log('Added user_account_type column to dbt1');
    }

    if (!dbt1ColumnNames.includes('banished_at')) {
      db.exec('ALTER TABLE dbt001 ADD COLUMN banished_at DATETIME');
      console.log('Added banished_at column to dbt1');
    }

    if (!dbt1ColumnNames.includes('user_parameter')) {
      db.exec('ALTER TABLE dbt001 ADD COLUMN user_parameter TEXT');
      console.log('Added user_parameter column to dbt1');
    }

    // Migrate dbt007 - add missing columns if they don't exist
    const dbt7Columns = db.pragma('table_info(dbt007)');
    const dbt7ColumnNames = dbt7Columns.map(col => col.name);

    if (!dbt7ColumnNames.includes('recovery_completion_state')) {
      db.exec('ALTER TABLE dbt007 ADD COLUMN recovery_completion_state TEXT DEFAULT "pending"');
      console.log('Added recovery_completion_state column to dbt7');
    }

    // Migrate dbt010 - add missing columns if they don't exist
    const dbt10Columns = db.pragma('table_info(dbt010)');
    const dbt10ColumnNames = dbt10Columns.map(col => col.name);

    if (!dbt10ColumnNames.includes('user_parameter')) {
      db.exec('ALTER TABLE dbt010 ADD COLUMN user_parameter TEXT');
      console.log('Added user_parameter column to dbt10');
    }

    // Ensure dbt015 has farm_token column
    const dbt15Cols = db.pragma('table_info(dbt015)').map(c => c.name);
    if (!dbt15Cols.includes('farm_token')) {
      db.exec("ALTER TABLE dbt015 ADD COLUMN farm_token TEXT DEFAULT ''");
      console.log('Added farm_token column to dbt015');
    }

    // Migrate dbt005 - add missing columns
    const dbt5Cols = db.pragma('table_info(dbt005)').map(c => c.name);
    if (!dbt5Cols.includes('user_token'))
      db.exec('ALTER TABLE dbt005 ADD COLUMN user_token TEXT');
    if (!dbt5Cols.includes('registered_at'))
      db.exec('ALTER TABLE dbt005 ADD COLUMN registered_at DATETIME');
    if (!dbt5Cols.includes('connected_at'))
      db.exec('ALTER TABLE dbt005 ADD COLUMN connected_at DATETIME');
    if (!dbt5Cols.includes('last_seen'))
      db.exec('ALTER TABLE dbt005 ADD COLUMN last_seen DATETIME');

    // Migrate dbt031 - add missing columns if they don't exist
    const dbt31Cols = db.pragma('table_info(dbt031)').map(c => c.name);
    if (!dbt31Cols.includes('alarm1_trigger_time'))
      db.exec('ALTER TABLE dbt031 ADD COLUMN alarm1_trigger_time INTEGER DEFAULT 10');
    if (!dbt31Cols.includes('gmail_alerts_enabled'))
      db.exec('ALTER TABLE dbt031 ADD COLUMN gmail_alerts_enabled INTEGER DEFAULT 1');
    if (!dbt31Cols.includes('daily_reports'))
      db.exec('ALTER TABLE dbt031 ADD COLUMN daily_reports INTEGER DEFAULT 1');
    if (!dbt31Cols.includes('alert_frequency'))
      db.exec("ALTER TABLE dbt031 ADD COLUMN alert_frequency TEXT DEFAULT 'immediate'");
    if (!dbt31Cols.includes('gmail_receiver'))
      db.exec('ALTER TABLE dbt031 ADD COLUMN gmail_receiver TEXT');

    // Migrate dbt002 — add lock-view columns if missing
    const dbt2Cols = db.pragma('table_info(dbt002)').map(c => c.name);
    if (!dbt2Cols.includes('map_view_locked'))
      db.exec('ALTER TABLE dbt002 ADD COLUMN map_view_locked INTEGER DEFAULT 0');
    if (!dbt2Cols.includes('locked_bounds'))
      db.exec('ALTER TABLE dbt002 ADD COLUMN locked_bounds TEXT');

    // Ensure dbt032 has the stats columns (migration guard)
    const dbt32Cols = db.pragma('table_info(dbt032)').map(c => c.name);
    if (!dbt32Cols.includes('total_number_of_user'))
      db.exec('ALTER TABLE dbt032 ADD COLUMN total_number_of_user INTEGER DEFAULT 0');
    if (!dbt32Cols.includes('total_number_of_banished_user'))
      db.exec('ALTER TABLE dbt032 ADD COLUMN total_number_of_banished_user INTEGER DEFAULT 0');
    if (!dbt32Cols.includes('total_number_of_connected_user'))
      db.exec('ALTER TABLE dbt032 ADD COLUMN total_number_of_connected_user INTEGER DEFAULT 0');

    // Initialize system settings in dbt032 if not exists
    const systemSettings = db.prepare('SELECT * FROM dbt032 WHERE id = 1').get();
    if (!systemSettings) {
      console.log('⚙️  Initializing system settings in dbt032...');
      const insertSettings = db.prepare(`
        INSERT INTO dbt032 (id, email, email_app_passcode, developer_passcode)
        VALUES (1, ?, ?, ?)
      `);
      insertSettings.run('modeblackmng@gmail.com', 'dazcybxywevjoptd', '2323');
      console.log('✓ System settings initialized');
    }

    // Remove developer dummy rows that were mistakenly inserted into dbt001.
    // dbt001 is for farmers only; developers belong exclusively in dbt010.
    const removedDevRows = db.prepare("DELETE FROM dbt001 WHERE user_account_type = 'developer'").run();
    if (removedDevRows.changes > 0)
      console.log(`✓ Removed ${removedDevRows.changes} developer dummy row(s) from dbt001`);

    // Resync total_cows for every farmer from the actual dbt004 count (fixes stale counters)
    db.exec(`
      UPDATE dbt001 SET total_cows = (
        SELECT COUNT(*) FROM dbt004 WHERE dbt004.user_token = dbt001.user_token
      )
    `);

    // Resync total_cows for every developer from the actual dbt006 count (fixes stale counters)
    db.exec(`
      UPDATE dbt010 SET total_cows = (
        SELECT COUNT(*) FROM dbt006 WHERE dbt006.user_token = dbt010.user_token
      )
    `);

    // Sync dbt032 stats from actual dbt001 counts on every startup
    db.exec(`
      UPDATE dbt032 SET
        total_number_of_user = (SELECT COUNT(*) FROM dbt001 WHERE user_account_type IS NULL OR user_account_type != 'developer'),
        total_number_of_banished_user = (SELECT COALESCE(SUM(is_banished),0) FROM dbt001 WHERE user_account_type IS NULL OR user_account_type != 'developer'),
        total_number_of_connected_user = (SELECT COUNT(*) FROM dbt001 WHERE connection_state='connected' AND (user_account_type IS NULL OR user_account_type != 'developer'))
      WHERE id = 1
    `);

    // Backfill user_parameter for existing users who have NULL or incomplete params
    const EXO_DEFAULTS = {
      exo_section1_led1_enabled:         true,
      exo_section2_led2led3_enabled:     true,
      exo_section2_led2led3_parameter:   15,
      exo_section3_led4_enabled:         true,
      exo_section3_led4_parameter:       25,
      exo_section4_led5_enabled:         true,
      exo_section4_led5_parameter:       15,
      exo_section5_led6led7led8_enabled: true
    };
    const FARMER_DEFAULTS = {
      selectedFarmToken: null, showFarmMarkers: true, showFences: true,
      showCowNames: false, audioEnabled: false,
      cowVisibility: {}, cowAlarm: {}, cowMarker: {},
      alarm1TriggerTime: 10, alarm1AudioDuration: 20,
      alarm2MomentOfActivation: 25, alarm3DistanceOfActivation: 1.0,
      gmailAlertsEnabled: true, dailyReports: true, alertFrequency: 'immediate',
      ...EXO_DEFAULTS
    };
    const DEVELOPER_DEFAULTS = {
      selectedFarmToken: null, showFarmMarkers: true, showFences: true,
      showCowNames: false, audioEnabled: false,
      selectedVirtualCow: null, speedScale: 1,
      alarm1TriggerTime: 10, alarm1AudioDuration: 20,
      alarm2MomentOfActivation: 25, alarm3DistanceOfActivation: 1.0,
      gmailAlertsEnabled: true, dailyReports: true, alertFrequency: 'immediate',
      ...EXO_DEFAULTS
    };

    const backfill = db.transaction((table, defaults) => {
      const rows = db.prepare(`SELECT user_token, user_parameter FROM ${table}`).all();
      for (const row of rows) {
        let prefs = {};
        try { prefs = row.user_parameter ? JSON.parse(row.user_parameter) : {}; } catch (_) {}
        let changed = false;
        for (const [key, defVal] of Object.entries(defaults)) {
          if (prefs[key] === undefined) { prefs[key] = defVal; changed = true; }
        }
        if (changed) {
          db.prepare(`UPDATE ${table} SET user_parameter = ? WHERE user_token = ?`).run(JSON.stringify(prefs), row.user_token);
          console.log(`[Backfill] user_parameter updated in ${table} for user_token: ${row.user_token}`);
        }
      }
    });
    backfill('dbt001', FARMER_DEFAULTS);
    backfill('dbt010', DEVELOPER_DEFAULTS);

    // One-time migration: copy dbt031 alarm settings into user_parameter (dbt001 / dbt010)
    // Runs on every startup but is idempotent — skips users whose user_parameter already has alarm keys
    const dbt31Rows = db.prepare('SELECT * FROM dbt031').all();
    if (dbt31Rows.length > 0) {
      const mergeAlarms = db.transaction((rows) => {
        for (const row of rows) {
          const token = row.user_token;
          if (!token) continue;

          // Find the user in dbt001 or dbt010
          let userRow = db.prepare('SELECT user_parameter FROM dbt001 WHERE user_token = ?').get(token);
          let targetTable = 'dbt001';
          if (!userRow) {
            userRow = db.prepare('SELECT user_parameter FROM dbt010 WHERE user_token = ?').get(token);
            targetTable = 'dbt010';
          }
          if (!userRow) continue; // token no longer exists in either table

          let prefs = {};
          try { prefs = userRow.user_parameter ? JSON.parse(userRow.user_parameter) : {}; } catch (_) {}

          // Only migrate keys not already set in user_parameter
          let changed = false;
          const map = [
            ['alarm1TriggerTime',          row.alarm1_trigger_time,          10],
            ['alarm1AudioDuration',        row.alarm1_audio_duration,        20],
            ['alarm2MomentOfActivation',   row.alarm2_moment_of_activation,  25],
            ['alarm3DistanceOfActivation', row.alarm3_distance_of_activation, 1.0],
            ['gmailAlertsEnabled',         row.gmail_alerts_enabled != null ? Boolean(row.gmail_alerts_enabled) : undefined, true],
            ['dailyReports',               row.daily_reports        != null ? Boolean(row.daily_reports)        : undefined, true],
            ['alertFrequency',             row.alert_frequency,              'immediate'],
          ];
          for (const [key, val] of map) {
            if (prefs[key] === undefined && val != null) {
              prefs[key] = val;
              changed = true;
            }
          }

          if (changed) {
            db.prepare(`UPDATE ${targetTable} SET user_parameter = ? WHERE user_token = ?`).run(JSON.stringify(prefs), token);
            console.log(`[Migration] dbt031 → ${targetTable}.user_parameter for user_token: ${token}`);
          }
        }
      });
      mergeAlarms(dbt31Rows);
    }

    console.log('Database initialized successfully');
    return true;
  } catch (error) {
    console.error('Database initialization error:', error);
    return false;
  }
}

module.exports = { db, initializeDatabase };
