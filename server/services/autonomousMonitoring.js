/**
 * Autonomous Cow Monitoring Service
 *
 * This service runs 24/7 on the server to monitor cow positions and zones.
 * It automatically sends email notifications even when no users are logged in.
 *
 * Features:
 * - Monitors all cows (real and virtual) every 5 seconds
 * - Tracks time spent in each zone
 * - Triggers Email1 after 25 seconds in zone2 (warning zone)
 * - Triggers Email2 when cow enters zone3 (danger zone >50m from fence)
 * - Prevents duplicate emails during same breach cycle
 *
 * Smart Coordination:
 * - Server monitoring ONLY activates when page19 is closed OR user is disconnected
 * - When page19 is open AND user is connected, web client handles monitoring
 * - This prevents duplicate emails and ensures seamless 24/7 coverage
 */

const { db } = require('../config/database');
const { sendZone2BreachEmail, sendLine2BreachEmail } = require('./emailService');

// Track monitoring state for each cow
const cowMonitoringState = new Map();

/**
 * Initialize monitoring service
 */
function initializeAutonomousMonitoring() {
    console.log('🤖 Initializing Autonomous Cow Monitoring Service...');
    console.log('📧 Email notifications will be sent automatically 24/7');
    console.log('🔍 Monitoring starts in 10 seconds...');

    // Start monitoring after 10 seconds (give server time to fully initialize)
    setTimeout(() => {
        // Run monitoring every 5 seconds
        setInterval(monitorAllCows, 5000);
        console.log('✅ Autonomous monitoring active');
    }, 10000);
}

/**
 * Monitor all cows and trigger alarms if needed
 */
async function monitorAllCows() {
    try {
        // Get all assigned cows from both tables (where farm_token is not null)
        const virtualCows = db.prepare(`
            SELECT
                cow_token, cow_name, cow_nickname, farm_token,
                gps_latitude, gps_longitude, state_fence,
                zone_changed_at, actual_time_outside_fence,
                alarm1_triggered_at, alarm2_triggered_at, alarm3_triggered_at,
                alarm1_triggered, alarm2_triggered, alarm3_triggered,
                user_token
            FROM dbt006
            WHERE farm_token IS NOT NULL
        `).all();

        const realCows = db.prepare(`
            SELECT
                c.cow_token, c.cow_name, c.cow_nickname, c.farm_token,
                c.gps_latitude, c.gps_longitude, c.state_fence,
                c.zone_changed_at, c.actual_time_outside_fence,
                c.alarm1_triggered_at, c.alarm2_triggered_at, c.alarm3_triggered_at,
                c.alarm1_triggered, c.alarm2_triggered, c.alarm3_triggered,
                f.user_token
            FROM dbt004 c
            LEFT JOIN dbt002 f ON c.farm_token = f.farm_token
            WHERE c.farm_token IS NOT NULL
        `).all();

        const allCows = [...virtualCows, ...realCows];

        for (const cow of allCows) {
            await checkCowAlarms(cow);
        }

    } catch (error) {
        console.error('❌ Error in autonomous monitoring:', error);
    }
}

/**
 * Check if web client (page19) is actively monitoring
 * Returns true if page19 is open AND user is connected
 */
function checkIfWebIsMonitoring(userToken) {
    try {
        if (!userToken) return false;

        // Check if user is a developer with page19 open
        const controller = db.prepare(`
            SELECT connection_state, last_seen_at
            FROM dbt012
            WHERE user_token = ?
        `).get(userToken);

        // Page19 must be explicitly connected with recent heartbeat
        if (controller && controller.connection_state === 'connected') {
            // Check if last_seen is recent (within last 30 seconds)
            const lastSeen = new Date(controller.last_seen_at).getTime();
            const now = Date.now();
            const timeSinceLastSeen = (now - lastSeen) / 1000; // seconds

            if (timeSinceLastSeen < 30) {
                // Page19 is actively connected and sending heartbeats
                // Also verify developer is logged in
                const developer = db.prepare(`
                    SELECT connection_state
                    FROM dbt010
                    WHERE user_token = ?
                `).get(userToken);

                if (developer && developer.connection_state === 'connected') {
                    // Both page19 is open AND developer is logged in
                    return true;
                }
            }
        }

        // Check if user is a farmer connected to their page
        const farmer = db.prepare(`
            SELECT connection_state
            FROM dbt001
            WHERE user_token = ?
        `).get(userToken);

        if (farmer && farmer.connection_state === 'connected') {
            // Farmer is connected, web might be handling monitoring
            return true;
        }

        // No active web monitoring detected
        return false;

    } catch (error) {
        console.error('Error checking web monitoring status:', error);
        // In case of error, assume web is NOT monitoring (server takes over)
        return false;
    }
}

/**
 * Check if a cow needs any alarm triggered
 */
async function checkCowAlarms(cow) {
    const { cow_token, state_fence, zone_changed_at, actual_time_outside_fence, user_token } = cow;

    // Skip if cow is in safe zone (zone1)
    if (state_fence === 'zone1') {
        // Clear monitoring state if cow returned to safe zone
        if (cowMonitoringState.has(cow_token)) {
            cowMonitoringState.delete(cow_token);
        }
        return;
    }

    // Skip if cow doesn't have zone change timestamp
    if (!zone_changed_at) {
        return;
    }

    // Check if web client (page19) is actively monitoring this cow
    // Server only takes over when page19 is closed OR user is disconnected
    const isWebMonitoring = checkIfWebIsMonitoring(user_token);
    if (isWebMonitoring) {
        // Web client is active, let it handle monitoring
        // Clear server monitoring state for this cow
        if (cowMonitoringState.has(cow_token)) {
            cowMonitoringState.delete(cow_token);
        }
        return;
    }

    // Calculate time in current zone
    const zoneChangedTime = new Date(zone_changed_at).getTime();
    const currentTime = Date.now();
    const timeInZone = Math.floor((currentTime - zoneChangedTime) / 1000); // seconds

    // Initialize monitoring state for this cow if needed
    if (!cowMonitoringState.has(cow_token)) {
        cowMonitoringState.set(cow_token, {
            alarm1Sent: false,
            alarm2Sent: false,
            alarm3Sent: false
        });
    }

    const monitorState = cowMonitoringState.get(cow_token);

    // Check Alarm2 (Email1): 25 seconds in zone2
    if (state_fence === 'zone2' && timeInZone >= 25) {
        if (!monitorState.alarm2Sent && cow.alarm2_triggered_at === null) {
            const success = await triggerAlarm2(cow);
            if (success) {
                monitorState.alarm2Sent = true;
            }
        }
    }

    // Check Alarm3 (Email2): Entered zone3 (danger zone >50m)
    if (state_fence === 'zone3') {
        if (!monitorState.alarm3Sent && cow.alarm3_triggered_at === null) {
            const success = await triggerAlarm3(cow);
            if (success) {
                monitorState.alarm3Sent = true;
            }
        }
    }
}

/**
 * Trigger Alarm2 (Email1) - 25 seconds in zone2
 */
async function triggerAlarm2(cow) {
    try {
        console.log(`📧 [AUTO-ALARM2] Triggering Email1 for ${cow.cow_nickname || cow.cow_token}`);
        console.log(`   Time in zone2: ${Math.floor((Date.now() - new Date(cow.zone_changed_at).getTime()) / 1000)}s`);

        // Get farmer email for this cow
        const farmer = await getFarmerForCow(cow.farm_token);
        if (!farmer) {
            console.error(`❌ No farmer found for farm_token: ${cow.farm_token}`);
            return false;
        }

        // Prepare cow data for email
        const cowData = {
            cowToken: cow.cow_token,
            cowName: cow.cow_name,
            cowNickname: cow.cow_nickname,
            latitude: cow.gps_latitude,
            longitude: cow.gps_longitude,
            timestamp: new Date().toISOString()
        };

        // Send email
        await sendZone2BreachEmail(farmer.email, farmer.username, cowData);
        console.log(`✅ Email1 sent to ${farmer.email}`);

        // Update database
        const cowTable = db.prepare('SELECT cow_token FROM dbt006 WHERE cow_token = ?').get(cow.cow_token) ? 'dbt006' : 'dbt004';
        const now = new Date().toISOString();
        db.prepare(`UPDATE ${cowTable} SET alarm2_triggered_at = ? WHERE cow_token = ?`).run(now, cow.cow_token);
        console.log(`✅ Alarm2 timestamp set in database`);

        return true;

    } catch (error) {
        console.error(`❌ Error triggering Alarm2 for ${cow.cow_token}:`, error);
        return false;
    }
}

/**
 * Trigger Alarm3 (Email2) - Entered zone3 (danger zone)
 */
async function triggerAlarm3(cow) {
    try {
        console.log(`📧 [AUTO-ALARM3] Triggering Email2 for ${cow.cow_nickname || cow.cow_token}`);
        console.log(`   Cow entered DANGER ZONE (zone3, >50m from fence)`);

        // Get farmer email for this cow
        const farmer = await getFarmerForCow(cow.farm_token);
        if (!farmer) {
            console.error(`❌ No farmer found for farm_token: ${cow.farm_token}`);
            return false;
        }

        // Prepare cow data for email
        const cowData = {
            cowToken: cow.cow_token,
            cowName: cow.cow_name,
            cowNickname: cow.cow_nickname,
            latitude: cow.gps_latitude,
            longitude: cow.gps_longitude,
            timestamp: new Date().toISOString()
        };

        // Send email
        await sendLine2BreachEmail(farmer.email, farmer.username, cowData);
        console.log(`✅ Email2 sent to ${farmer.email}`);

        // Update database
        const cowTable = db.prepare('SELECT cow_token FROM dbt006 WHERE cow_token = ?').get(cow.cow_token) ? 'dbt006' : 'dbt004';
        const now = new Date().toISOString();
        db.prepare(`UPDATE ${cowTable} SET alarm3_triggered_at = ? WHERE cow_token = ?`).run(now, cow.cow_token);
        console.log(`✅ Alarm3 timestamp set in database`);

        return true;

    } catch (error) {
        console.error(`❌ Error triggering Alarm3 for ${cow.cow_token}:`, error);
        return false;
    }
}

/**
 * Get farmer information for a given farm
 */
async function getFarmerForCow(farmToken) {
    try {
        // Get farm info
        const farm = db.prepare('SELECT user_token FROM dbt002 WHERE farm_token = ?').get(farmToken);
        if (!farm) {
            console.error(`❌ Farm not found for token: ${farmToken}`);
            return null;
        }

        // Get user info (check both farmer and developer tables)
        let user = null;

        // Try farmer first
        if (farm.user_token) {
            user = db.prepare('SELECT user_id AS email, farmer_name AS username FROM dbt001 WHERE user_token = ?').get(farm.user_token);
        }

        // If not a farmer, try developer
        if (!user && farm.user_token) {
            user = db.prepare('SELECT email, developer_name AS username FROM dbt010 WHERE user_token = ?').get(farm.user_token);
        }

        if (!user) {
            console.error(`❌ No user found for farm_token: ${farmToken}`);
        }

        return user;
    } catch (error) {
        console.error('Error getting farmer for cow:', error);
        return null;
    }
}

module.exports = {
    initializeAutonomousMonitoring
};
