const express = require('express');
const { db } = require('../config/database');
const { now } = require('../utils/dateFormatter');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { notifyESP32Offline, notifyNewCowRegistered } = require('../services/notificationService');
const { sendESP32OfflineEmail, sendNewCowRegisteredEmail } = require('../services/emailService');

// WebSocket server will be injected
let wss = null;

function setWebSocketServer(websocketServer) {
  wss = websocketServer;
}

// Bridge socket (Socket.IO connection to websocket-bridge) — injected from index.js
let bridgeSocketRef = null;

function setBridgeSocket(socket) {
  bridgeSocketRef = socket;
}

// Send alarm command to the developer's connected ESP32 (if any)
function sendAlarmToEsp32(userToken, zone, cowToken) {
  if (!bridgeSocketRef) return;
  try {
    // Look up the specific cow by token — skip if in virtual offline mode
    const esp32Cow = db.prepare(`
      SELECT collar_id, offline_mode_active FROM dbt006
      WHERE cow_token = ? AND cow_type = 'esp32' AND collar_state = 'connected'
    `).get(cowToken);
    if (!esp32Cow) {
      console.log(`🔔 [Virtual Alarm] No connected ESP32 for cow ${cowToken} — skipped`);
      return;
    }
    if (esp32Cow.offline_mode_active) {
      console.log(`🔔 [Virtual Alarm] Cow ${cowToken} is in virtual offline mode — alarm skipped`);
      return;
    }
    const deviceId = 'ESP32_' + esp32Cow.collar_id.replace(/:/g, '');
    bridgeSocketRef.emit('command:alarm', { deviceId, zone, cowToken, timestamp: Date.now() });
    console.log(`🔔 [Virtual Alarm] Sent command:alarm to ${deviceId} (zone: ${zone})`);
  } catch (err) {
    console.error('[Virtual Alarm] Error sending alarm command:', err.message);
  }
}

const router = express.Router();

// Middleware to verify developer authentication
function authenticateDeveloper(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'safezone-secret-key');

    if (decoded.userType !== 'developer') {
      return res.status(403).json({ error: 'Developer access required' });
    }

    req.developerToken = decoded.token;
    req.developerId = decoded.farmerId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Generate unique token
function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

// GET farms belonging to the authenticated developer
router.get('/farms', authenticateDeveloper, (req, res) => {
  try {
    const farms = db.prepare(`
      SELECT
        f.farm_name,
        f.farm_token,
        f.farm_gps,
        f.timestamp,
        COALESCE(dev.developer_name, fr.farmer_name) as owner_name,
        f.user_token as owner_token,
        COUNT(DISTINCT fe.fence_token) as fence_count,
        (COUNT(DISTINCT c.cow_token) + COUNT(DISTINCT vc.cow_token)) as cow_count
      FROM dbt002 f
      LEFT JOIN dbt001 fr ON f.user_token = fr.user_token
      LEFT JOIN dbt010 dev ON f.user_token = dev.user_token
      LEFT JOIN dbt003 fe ON f.farm_token = fe.farm_token
      LEFT JOIN dbt004 c ON f.farm_token = c.farm_token
      LEFT JOIN dbt006 vc ON f.farm_token = vc.farm_token
      WHERE f.user_token = ?
      GROUP BY f.farm_token
      ORDER BY f.timestamp DESC
    `).all(req.developerToken);

    res.json({ farms });
  } catch (error) {
    console.error('Error fetching farms:', error);
    res.status(500).json({ error: 'Failed to fetch farms' });
  }
});

// GET all real ESP32 cows for this developer (from dbt006 cow_type='esp32')
router.get('/esp32-cows', authenticateDeveloper, (req, res) => {
  try {
    const userToken = req.developerToken;
    const rawCows = db.prepare(`
      SELECT
        c.cow_name,
        c.cow_token,
        c.collar_id,
        c.farm_token,
        c.gps_latitude,
        c.gps_longitude,
        c.state_fence,
        c.collar_state,
        c.offline_mode_active,
        c.reg_number,
        ROW_NUMBER() OVER (PARTITION BY c.user_token ORDER BY c.reg_number) AS queue_pos,
        'ESP32_' || REPLACE(c.collar_id, ':', '') AS device_id
      FROM dbt006 c
      WHERE c.user_token = ? AND c.cow_type = 'esp32'
    `).all(userToken);

    const cows = rawCows.map(c => ({
      ...c,
      display_name: c.reg_number ? `cow${c.reg_number}_${c.queue_pos}_E` : c.cow_name
    }));

    res.json({ cows });
  } catch (error) {
    console.error('Error fetching ESP32 cows:', error);
    res.status(500).json({ error: 'Failed to fetch ESP32 cows' });
  }
});

// GET all virtual cows (from dbt6)
router.get('/virtual-cows', authenticateDeveloper, (req, res) => {
  try {
    const userToken = req.developerToken;
    const rawCows = db.prepare(`
      SELECT
        v.cow_name,
        v.cow_nickname,
        v.cow_token,
        v.collar_id,
        v.farm_token,
        v.user_token,
        v.timestamp,
        v.state_fence,
        v.time_inside,
        v.time_outside,
        v.total_breach,
        v.gps_latitude,
        v.gps_longitude,
        v.actual_time_inside_fence,
        v.actual_time_outside_fence,
        v.zone_changed_at,
        COALESCE(v.cow_type, 'virtual') as cow_type,
        v.reg_number,
        ROW_NUMBER() OVER (PARTITION BY v.user_token ORDER BY v.reg_number) as queue_pos,
        f.farm_name,
        dev.developer_name as owner_name
      FROM dbt006 v
      LEFT JOIN dbt002 f ON v.farm_token = f.farm_token
      LEFT JOIN dbt010 dev ON v.user_token = dev.user_token
      WHERE v.user_token = ? AND (v.cow_type IS NULL OR v.cow_type = 'virtual')
      ORDER BY v.timestamp DESC
    `).all(userToken);

    const virtualCows = rawCows.map(c => ({
      ...c,
      display_name: c.reg_number
        ? `cow${c.reg_number}_${c.queue_pos}_${c.cow_type === 'esp32' ? 'E' : 'V'}`
        : c.cow_name
    }));

    res.json({ virtualCows });
  } catch (error) {
    console.error('Error fetching virtual cows:', error);
    res.status(500).json({ error: 'Failed to fetch virtual cows' });
  }
});

// POST create a new virtual cow
router.post('/virtual-cows', authenticateDeveloper, (req, res) => {
  try {
    const { cowNickname, farmToken, cowType } = req.body;

    // Get next reg_number via AUTOINCREMENT sequence table (stored in sqlite_sequence)
    const seqResult = db.prepare('INSERT INTO dbt006_seq (user_token, created_at) VALUES (?, ?)').run(req.developerToken, now());
    const regNumber = seqResult.lastInsertRowid;
    const finalCowName = `cow${regNumber}`;
    const type = cowType === 'esp32' ? 'esp32' : 'virtual';

    // Generate unique tokens
    const cowToken = generateToken();
    const collarId = `VC${Date.now().toString().slice(-8)}`; // Virtual Collar ID

    // Insert into dbt006
    const insertStmt = db.prepare(`
      INSERT INTO dbt006 (
        cow_name,
        cow_nickname,
        cow_token,
        collar_id,
        farm_token,
        user_token,
        timestamp,
        state_fence,
        time_inside,
        time_outside,
        total_breach,
        registered_at,
        assigned_at,
        gps_latitude,
        gps_longitude,
        alarm1_triggered,
        alarm2_triggered,
        alarm3_triggered,
        cow_type,
        reg_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const currentTime = now();
    insertStmt.run(
      finalCowName,
      cowNickname || finalCowName,
      cowToken,
      collarId,
      farmToken || null,
      req.developerToken,
      currentTime,
      'inside',
      0, 0, 0,
      currentTime,
      farmToken ? currentTime : null,
      0.0, 0.0,
      0, 0, 0,
      type,
      regNumber
    );

    // Update developer's total_cows counter
    const updateDeveloperStmt = db.prepare('UPDATE dbt010 SET total_cows = total_cows + 1 WHERE user_token = ?');
    updateDeveloperStmt.run(req.developerToken);
    console.log(`[Create Virtual Cow] Incremented total_cows for developer: ${req.developerToken}`);

    // msg8 — in-app + Gmail for new cow registration
    notifyNewCowRegistered(req.developerToken, cowToken, finalCowName, collarId);
    try {
      const devRow = db.prepare('SELECT email, developer_name, user_parameter FROM dbt010 WHERE user_token = ?').get(req.developerToken);
      if (devRow?.email) {
        const prefs = devRow.user_parameter ? JSON.parse(devRow.user_parameter) : {};
        if (prefs.gmailAlertsEnabled !== false) {
          sendNewCowRegisteredEmail(devRow.email, devRow.developer_name, finalCowName, collarId, type)
            .catch(err => console.error('[msg8] Virtual cow Gmail failed:', err.message));
        }
      }
    } catch (emailErr) {
      console.error('[msg8] Virtual cow email lookup error:', emailErr.message);
    }

    res.json({
      success: true,
      virtualCow: {
        cow_name: finalCowName,
        cow_nickname: cowNickname || finalCowName,
        cow_token: cowToken,
        collar_id: collarId,
        farm_token: farmToken || null,
        user_token: req.developerToken,
        cow_type: type,
        reg_number: regNumber,
        display_name: `${finalCowName}_1_${type === 'esp32' ? 'E' : 'V'}`
      }
    });
  } catch (error) {
    console.error('Error creating virtual cow:', error);
    res.status(500).json({ error: 'Failed to create virtual cow' });
  }
});

// PUT assign virtual cow to a farm
router.put('/virtual-cows/:cowToken/assign', authenticateDeveloper, (req, res) => {
  try {
    const { cowToken } = req.params;
    const { farmToken } = req.body;

    if (!farmToken) {
      return res.status(400).json({ error: 'Farm token is required' });
    }

    // Verify farm exists
    const farm = db.prepare('SELECT farm_name FROM dbt002 WHERE farm_token = ?').get(farmToken);

    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }

    // Update virtual cow with farm_token
    const updateStmt = db.prepare(`
      UPDATE dbt006
      SET farm_token = ?,
          timestamp = ?
      WHERE cow_token = ?
    `);

    const result = updateStmt.run(farmToken, now(), cowToken);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Virtual cow not found' });
    }

    res.json({
      success: true,
      message: `Virtual cow assigned to ${farm.farm_name}`
    });
  } catch (error) {
    console.error('Error assigning virtual cow:', error);
    res.status(500).json({ error: 'Failed to assign virtual cow' });
  }
});

// PUT unassign virtual cow from farm
router.put('/virtual-cows/:cowToken/unassign', authenticateDeveloper, (req, res) => {
  try {
    const { cowToken } = req.params;

    // Update virtual cow to remove farm_token
    const updateStmt = db.prepare(`
      UPDATE dbt006
      SET farm_token = NULL,
          timestamp = ?
      WHERE cow_token = ?
    `);

    const result = updateStmt.run(now(), cowToken);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Virtual cow not found' });
    }

    res.json({
      success: true,
      message: 'Virtual cow unassigned from farm'
    });
  } catch (error) {
    console.error('Error unassigning virtual cow:', error);
    res.status(500).json({ error: 'Failed to unassign virtual cow' });
  }
});

// POST update virtual controller selection (dbt012)
router.post('/controller/select', authenticateDeveloper, (req, res) => {
  try {
    const { cowToken, farmToken } = req.body;
    console.log('[Virtual Controller] Selecting cow:', cowToken, 'farm:', farmToken, 'developer:', req.developerToken);

    // First, set all previously selected cows to disconnected
    const disconnectResult = db.prepare(`
      UPDATE dbt006
      SET virtual_controller_state = 'disconnected'
      WHERE user_token = ? AND virtual_controller_state = 'connected'
    `).run(req.developerToken);
    console.log('[Virtual Controller] Disconnected previous cows:', disconnectResult.changes);

    // Update the selected cow to connected
    const connectResult = db.prepare(`
      UPDATE dbt006
      SET virtual_controller_state = 'connected',
          connected_at = ?,
          last_seen = ?
      WHERE cow_token = ?
    `).run(now(), now(), cowToken);
    console.log('[Virtual Controller] Connected cow:', cowToken, 'rows affected:', connectResult.changes);

    // Check if controller entry exists for this developer
    const existing = db.prepare('SELECT * FROM dbt012 WHERE user_token = ?').get(req.developerToken);

    if (existing) {
      // Update existing entry
      const updateStmt = db.prepare(`
        UPDATE dbt012
        SET selected_cow_token = ?,
            selected_farm_token = ?,
            connected_at = ?,
            last_seen_at = ?,
            connection_state = 'connected'
        WHERE user_token = ?
      `);

      updateStmt.run(cowToken, farmToken, now(), now(), req.developerToken);
    } else {
      // Insert new entry
      const insertStmt = db.prepare(`
        INSERT INTO dbt012 (
          user_token,
          selected_cow_token,
          selected_farm_token,
          connected_at,
          last_seen_at,
          connection_state,
          last_speed_scale
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(req.developerToken, cowToken, farmToken, now(), now(), 'connected', 0);
    }

    res.json({
      success: true,
      message: 'Virtual controller selection updated'
    });
  } catch (error) {
    console.error('Error updating controller selection:', error);
    res.status(500).json({ error: 'Failed to update selection' });
  }
});

// GET current controller selection
router.get('/controller/current', authenticateDeveloper, (req, res) => {
  try {
    const selection = db.prepare(`
      SELECT
        vc.user_token,
        vc.selected_cow_token,
        vc.selected_farm_token,
        vc.connection_state,
        vc.last_speed_scale,
        c.cow_name,
        c.cow_nickname,
        c.gps_latitude,
        c.gps_longitude,
        f.farm_name
      FROM dbt012 vc
      LEFT JOIN dbt006 c ON vc.selected_cow_token = c.cow_token
      LEFT JOIN dbt002 f ON vc.selected_farm_token = f.farm_token
      WHERE vc.user_token = ?
    `).get(req.developerToken);

    res.json({ selection: selection || null });
  } catch (error) {
    console.error('Error fetching controller selection:', error);
    res.status(500).json({ error: 'Failed to fetch selection' });
  }
});

// POST update virtual cow position
router.post('/virtual-cows/:cowToken/position', authenticateDeveloper, (req, res) => {
  try {
    const { cowToken } = req.params;
    const { latitude, longitude, speed, zone } = req.body;

    console.log(`📥 [Server] Received position update for cow ${cowToken}:`);
    console.log(`   - latitude: ${latitude}`);
    console.log(`   - longitude: ${longitude}`);
    console.log(`   - speed: ${speed} (type: ${typeof speed})`);
    console.log(`   - zone: ${zone}`);

    // Get current cow data before updating
    const cowExists = db.prepare(`
      SELECT cow_token, cow_name, cow_type, state_fence, zone_changed_at,
             time_inside, time_outside,
             actual_time_inside_fence, actual_time_outside_fence,
             total_breach, user_token, farm_token,
             alarm1_triggered, alarm2_triggered, alarm3_triggered,
             alarm1_triggered_at, alarm2_triggered_at, alarm3_triggered_at
      FROM dbt006
      WHERE cow_token = ?
    `).get(cowToken);

    if (!cowExists) {
      return res.status(404).json({ error: 'Virtual cow not found' });
    }

    // Calculate zone transition and time updates
    let cumulativeTimeInside = cowExists.time_inside || 0;
    let cumulativeTimeOutside = cowExists.time_outside || 0;
    let actualTimeInside = cowExists.actual_time_inside_fence || 0;
    let actualTimeOutside = cowExists.actual_time_outside_fence || 0;
    let totalBreach = cowExists.total_breach || 0;
    const oldZone = cowExists.state_fence;
    const newZone = zone || oldZone || 'unknown';
    const zoneChanged = oldZone && oldZone !== newZone;

    if (zoneChanged) {
      console.log(`\n🔄 [Virtual Cow] Zone transition: ${oldZone} → ${newZone}`);

      // Calculate elapsed time since last zone change
      if (cowExists.zone_changed_at) {
        const lastChangeTime = new Date(cowExists.zone_changed_at);
        const currentTime = new Date();
        const elapsedSeconds = Math.floor((currentTime - lastChangeTime) / 1000);
        console.log(`  Time in previous zone: ${elapsedSeconds} seconds`);

        // Add elapsed time — line1 counts as inside (cow is still within fence)
        if (oldZone === 'zone1' || oldZone === 'line1') {
          cumulativeTimeInside += elapsedSeconds;
          actualTimeInside += elapsedSeconds;
          console.log(`  Added ${elapsedSeconds}s to time inside (cumulative: ${cumulativeTimeInside}s, actual: ${actualTimeInside}s)`);
        } else if (oldZone === 'zone2' || oldZone === 'zone3') {
          cumulativeTimeOutside += elapsedSeconds;
          actualTimeOutside += elapsedSeconds;
          console.log(`  Added ${elapsedSeconds}s to time outside (cumulative: ${cumulativeTimeOutside}s, actual: ${actualTimeOutside}s)`);
        }
      }

      // Reset the ACTUAL counter for the NEW zone — line1 is inside
      if (newZone === 'zone1' || newZone === 'line1') {
        actualTimeOutside = 0;
        console.log(`  🔄 Reset actual_time_outside_fence to 0 (now inside)`);
      } else if (newZone === 'zone2' || newZone === 'zone3') {
        actualTimeInside = 0;
        console.log(`  🔄 Reset actual_time_inside_fence to 0 (now outside)`);
      }

      // Breach: cow exited fence from zone1 or line1
      if ((oldZone === 'zone1' || oldZone === 'line1') && (newZone === 'zone2' || newZone === 'zone3')) {
        totalBreach += 1;
        console.log(`  🚨 BREACH DETECTED! Total breaches: ${totalBreach}`);
        if (cowExists.cow_type === 'esp32') {
          sendAlarmToEsp32(cowExists.user_token, newZone, cowToken);
        }
        if (cowExists?.user_token && cowExists?.farm_token) {
          try {
            db.prepare(`
              INSERT INTO dbt015 (user_token, farm_token, minute_timestamp, breach_count_minute)
              VALUES (?, ?, ?, 1)
            `).run(cowExists.user_token, cowExists.farm_token, now());
            console.log(`  📝 Breach recorded in dbt015 for user ${cowExists.user_token} farm ${cowExists.farm_token}`);
          } catch (error) {
            console.error('  ❌ Error inserting into dbt015:', error);
          }
        } else {
          console.log(`  ⚠️ Cannot record breach: missing user_token (${cowExists?.user_token})`);
        }
      }

      // Exo1 ON: cow entered line1 band from deep inside (zone1 → line1)
      if (oldZone === 'zone1' && newZone === 'line1') {
        console.log(`  🔔 Cow entered line1 band — firing exo1`);
        if (cowExists.cow_type === 'esp32') {
          sendAlarmToEsp32(cowExists.user_token, 'line1', cowToken);
        }
      }

      // Exo1 OFF: cow moved deeper inside from line1 (line1 → zone1)
      if (oldZone === 'line1' && newZone === 'zone1') {
        console.log(`  🔔 Cow left line1 band (went inside) — stopping exo1`);
        if (cowExists.cow_type === 'esp32') {
          sendAlarmToEsp32(cowExists.user_token, 'zone1', cowToken);
        }
      }

      // Return from outside to line1: re-fire exo1, reset breach alarm flags
      if ((oldZone === 'zone2' || oldZone === 'zone3') && newZone === 'line1') {
        console.log(`  🔔 Cow returned from outside to line1 band — firing exo1`);
        if (cowExists.cow_type === 'esp32') {
          sendAlarmToEsp32(cowExists.user_token, 'line1', cowToken);
        }
      }

      // Return from outside to fully safe (zone1): stop all alarms
      if ((oldZone === 'zone2' || oldZone === 'zone3') && newZone === 'zone1') {
        console.log(`  🔔 Cow returned fully to safe zone — resetting all alarm triggers`);
        if (cowExists.cow_type === 'esp32') {
          sendAlarmToEsp32(cowExists.user_token, 'zone1', cowToken);
        }
      }

      console.log(`  💾 Final values - Cumulative: inside=${cumulativeTimeInside}s, outside=${cumulativeTimeOutside}s | Actual: inside=${actualTimeInside}s, outside=${actualTimeOutside}s | Breaches: ${totalBreach}`);
    }

    // Reset alarm triggered flags when cow returns to safe zone (zone1 or line1 = returned inside)
    const shouldResetAlarms = zoneChanged && (newZone === 'zone1' || newZone === 'line1') && (oldZone === 'zone2' || oldZone === 'zone3');

    // Compute alarm triggered values based on new zone and timestamp existence
    // FIXED LOGIC:
    // Column23 = 1 when: state_fence IN ('zone2', 'zone3') AND alarm1_triggered_at != null
    // Column24 = 1 when: state_fence IN ('zone2', 'zone3') AND alarm2_triggered_at != null (stays 1 in both zones)
    // Column25 = 1 when: state_fence IN ('zone2', 'zone3') AND alarm3_triggered_at != null (stays 1 in both zones)

    let alarm1Triggered = 0;
    let alarm2Triggered = 0;
    let alarm3Triggered = 0;

    if (!shouldResetAlarms) {
      // Compute based on current zone and timestamp existence
      // All alarms stay active as long as cow is outside zone1 AND alarm was triggered
      alarm1Triggered = ((newZone === 'zone2' || newZone === 'zone3') && cowExists.alarm1_triggered_at !== null) ? 1 : 0;
      alarm2Triggered = ((newZone === 'zone2' || newZone === 'zone3') && cowExists.alarm2_triggered_at !== null) ? 1 : 0;
      alarm3Triggered = ((newZone === 'zone2' || newZone === 'zone3') && cowExists.alarm3_triggered_at !== null) ? 1 : 0;
    }
    // If shouldResetAlarms, all stay 0

    // ESP32 cows: write virtual position to dedicated columns and mark source as 'virtual'.
    // Virtual cows (no real GPS): keep writing to gps_latitude/gps_longitude as before.
    const isEsp32Cow = cowExists.cow_type === 'esp32';
    const posColSql = isEsp32Cow
      ? 'virtual_latitude = ?, virtual_longitude = ?, last_position_source = \'virtual\','
      : 'gps_latitude = ?, gps_longitude = ?,';

    const updateStmt = db.prepare(`
      UPDATE dbt006
      SET ${posColSql}
          state_fence = ?,
          time_inside = ?,
          time_outside = ?,
          actual_time_inside_fence = ?,
          actual_time_outside_fence = ?,
          total_breach = ?,
          zone_changed_at = ?,
          timestamp = ?,
          alarm1_triggered = ?,
          alarm2_triggered = ?,
          alarm3_triggered = ?,
          alarm1_triggered_at = ?,
          alarm2_triggered_at = ?,
          alarm3_triggered_at = ?
      WHERE cow_token = ?
    `);

    const result = updateStmt.run(
      latitude,
      longitude,
      newZone,
      cumulativeTimeInside,
      cumulativeTimeOutside,
      actualTimeInside,
      actualTimeOutside,
      totalBreach,
      zoneChanged ? now() : cowExists.zone_changed_at,
      now(),
      alarm1Triggered,
      alarm2Triggered,
      alarm3Triggered,
      shouldResetAlarms ? null : cowExists.alarm1_triggered_at,
      shouldResetAlarms ? null : cowExists.alarm2_triggered_at,
      shouldResetAlarms ? null : cowExists.alarm3_triggered_at,
      cowToken
    );

    // Update last speed in dbt012 if this is the selected cow
    if (speed !== undefined) {
      console.log(`💾 [Server] Updating dbt012 with speed ${speed} for cow ${cowToken}, dev ${req.developerToken}`);
      const result = db.prepare(`
        UPDATE dbt012
        SET last_speed_scale = ?,
            last_seen_at = ?
        WHERE selected_cow_token = ? AND user_token = ?
      `).run(speed, now(), cowToken, req.developerToken);
      console.log(`   Updated ${result.changes} row(s) in dbt12`);

      // Verify the update
      const verification = db.prepare('SELECT last_speed_scale FROM dbt012 WHERE selected_cow_token = ? AND user_token = ?').get(cowToken, req.developerToken);
      console.log(`   ✅ Verified: dbt12.last_speed_scale = ${verification?.last_speed_scale}`);

    } else {
      console.log(`⚠️ [Server] speed is undefined, not updating dbt12`);
    }

    // Broadcast position update to all WebSocket clients for real-time sync
    if (wss) {
      const cow = db.prepare(`
        SELECT cow_name, cow_nickname, collar_id,
               time_inside, time_outside,
               actual_time_inside_fence, actual_time_outside_fence,
               total_breach, zone_changed_at,
               gps_latitude, gps_longitude
        FROM dbt006
        WHERE cow_token = ?
      `).get(cowToken);

      console.log(`📡 [BROADCAST] Virtual cow position update for ${cow?.cow_nickname || cowToken}`);
      console.log(`   DB Position: (${cow?.gps_latitude}, ${cow?.gps_longitude})`);
      console.log(`   Param Position: (${latitude}, ${longitude})`);
      console.log(`   Match: ${cow?.gps_latitude === latitude && cow?.gps_longitude === longitude ? 'YES' : 'NO - MISMATCH!'}`);

      const broadcastData = {
        type: 'virtual_cow_position',
        cow_token: cowToken,
        cow_name: cow?.cow_name,
        cow_nickname: cow?.cow_nickname,
        collar_id: cow?.collar_id,
        latitude: latitude,
        longitude: longitude,
        zone: newZone,
        cow_type: cowExists.cow_type,           // so client knows which columns to update
        isEsp32: isEsp32Cow,                    // shorthand flag for client
        time_inside: cow?.time_inside,
        time_outside: cow?.time_outside,
        actual_time_inside_fence: cow?.actual_time_inside_fence,
        actual_time_outside_fence: cow?.actual_time_outside_fence,
        total_breach: cow?.total_breach,
        zone_changed_at: cow?.zone_changed_at,
        speed: speed,
        timestamp: now()
      };

      wss.clients.forEach((client) => {
        if (client.readyState === 1) { // WebSocket.OPEN = 1
          client.send(JSON.stringify(broadcastData));
        }
      });
      console.log(`   Broadcast sent to ${wss.clients.size} client(s)`);
    }

    res.json({
      success: true,
      position: { latitude, longitude, speed }
    });
  } catch (error) {
    console.error('Error updating virtual cow position:', error);
    res.status(500).json({ error: 'Failed to update position' });
  }
});

// DELETE virtual cow
router.delete('/virtual-cows/:cowToken', authenticateDeveloper, (req, res) => {
  try {
    const { cowToken } = req.params;

    // Delete from dbt6
    const deleteStmt = db.prepare('DELETE FROM dbt006 WHERE cow_token = ? AND user_token = ?');
    const result = deleteStmt.run(cowToken, req.developerToken);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Virtual cow not found' });
    }

    // Decrement developer's total_cows counter
    const updateDeveloperStmt = db.prepare('UPDATE dbt010 SET total_cows = total_cows - 1 WHERE user_token = ?');
    updateDeveloperStmt.run(req.developerToken);
    console.log(`[Delete Virtual Cow] Decremented total_cows for developer: ${req.developerToken}`);

    // Clear from dbt012 if it was selected
    db.prepare(`
      UPDATE dbt012
      SET selected_cow_token = NULL
      WHERE selected_cow_token = ?
    `).run(cowToken);

    res.json({
      success: true,
      message: 'Virtual cow deleted'
    });
  } catch (error) {
    console.error('Error deleting virtual cow:', error);
    res.status(500).json({ error: 'Failed to delete virtual cow' });
  }
});

// POST heartbeat to keep connection alive
router.post('/controller/heartbeat', authenticateDeveloper, (req, res) => {
  try {
    const { cowToken, farmToken } = req.body;

    // Update last_seen_at in dbt012 to indicate connection is still alive
    db.prepare(`
      UPDATE dbt012
      SET last_seen_at = ?
      WHERE user_token = ? AND selected_cow_token = ?
    `).run(now(), req.developerToken, cowToken);

    // Update last_seen in dbt006 for the virtual cow
    db.prepare(`
      UPDATE dbt006
      SET last_seen = ?
      WHERE cow_token = ? AND user_token = ?
    `).run(now(), cowToken, req.developerToken);

    res.json({ success: true });
  } catch (error) {
    console.error('Error processing heartbeat:', error);
    res.status(500).json({ error: 'Failed to process heartbeat' });
  }
});

// POST disconnect virtual controller
router.post('/controller/disconnect', authenticateDeveloper, (req, res) => {
  try {
    // Set all cows controlled by this developer to disconnected
    db.prepare(`
      UPDATE dbt006
      SET virtual_controller_state = 'disconnected',
          last_seen = ?
      WHERE user_token = ? AND virtual_controller_state = 'connected'
    `).run(now(), req.developerToken);

    // Switch ESP32 cows back to real GPS source so the next valid GPS packet takes over.
    db.prepare(`
      UPDATE dbt006 SET last_position_source = 'gps'
      WHERE user_token = ? AND cow_type = 'esp32' AND last_position_source = 'virtual'
    `).run(req.developerToken);

    // Update dbt012 to mark as disconnected (but keep selected_cow_token, selected_farm_token, and last_speed_scale)
    // This allows restoration when page19 is reopened
    db.prepare(`
      UPDATE dbt012
      SET connection_state = 'disconnected',
          last_seen_at = ?
      WHERE user_token = ?
    `).run(now(), req.developerToken);

    res.json({
      success: true,
      message: 'Virtual controller disconnected and reset'
    });
  } catch (error) {
    console.error('Error disconnecting controller:', error);
    res.status(500).json({ error: 'Failed to disconnect controller' });
  }
});

// GET farm fence center for resetting position
router.get('/farms/:farmToken/fence-center', authenticateDeveloper, (req, res) => {
  try {
    const { farmToken } = req.params;

    // Get farm GPS as fallback
    const farm = db.prepare('SELECT farm_name, farm_gps FROM dbt002 WHERE farm_token = ?').get(farmToken);

    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }

    // Get fences for this farm
    const fences = db.prepare(`
      SELECT fence_name, fence_coordinate
      FROM dbt003
      WHERE farm_token = ?
    `).all(farmToken);

    let centerLat = 0;
    let centerLng = 0;

    if (fences.length > 0 && fences[0].fence_coordinate) {
      // Calculate center of first fence
      const coords = JSON.parse(fences[0].fence_coordinate);
      if (coords && coords.length > 0) {
        const sumLat = coords.reduce((sum, coord) => sum + coord.lat, 0);
        const sumLng = coords.reduce((sum, coord) => sum + coord.lng, 0);
        centerLat = sumLat / coords.length;
        centerLng = sumLng / coords.length;
      }
    } else if (farm.farm_gps) {
      // Use farm GPS as fallback
      const [lat, lng] = farm.farm_gps.split(',').map(Number);
      centerLat = lat;
      centerLng = lng;
    }

    res.json({
      farm_name: farm.farm_name,
      center: {
        latitude: centerLat,
        longitude: centerLng
      },
      has_fence: fences.length > 0
    });
  } catch (error) {
    console.error('Error getting farm fence center:', error);
    res.status(500).json({ error: 'Failed to get fence center' });
  }
});

// POST line1 test for virtual cow — finds any connected non-offline ESP32 for this developer
router.post('/virtual-cows/:cowToken/line1-test', authenticateDeveloper, (req, res) => {
  try {
    const { active } = req.body;
    const zone = active ? 'line1' : 'zone1';

    if (!bridgeSocketRef) return res.status(503).json({ error: 'Bridge not connected' });

    const esp32 = db.prepare(`
      SELECT collar_id FROM dbt006
      WHERE user_token = ? AND cow_type = 'esp32' AND collar_state = 'connected' AND offline_mode_active = 0
      LIMIT 1
    `).get(req.developerToken);

    if (esp32) {
      const deviceId = 'ESP32_' + esp32.collar_id.replace(/:/g, '');
      bridgeSocketRef.emit('command:alarm', { deviceId, zone, cowToken: null, timestamp: Date.now() });
      console.log(`[Line1 Test Virtual] LED1 ${active ? 'ON' : 'OFF'} → ${deviceId}`);
    } else {
      console.log('[Line1 Test Virtual] No connected non-offline ESP32 for developer — skipped');
    }

    res.json({ success: true, active: !!active });
  } catch (error) {
    console.error('Error sending virtual line1 test command:', error);
    res.status(500).json({ error: 'Failed to send line1 test command' });
  }
});

// POST line1 test — toggle exo section1 LED1 on/off for a connected ESP32 device
// active=true  → alarm_command line1 (cow at line1 boundary, LED1 stays ON)
// active=false → alarm_command zone1 (cow back safe, LED1 OFF)
router.post('/esp32-cows/:deviceId/line1-test', authenticateDeveloper, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { active } = req.body;
    if (!bridgeSocketRef) {
      return res.status(503).json({ error: 'Bridge not connected' });
    }
    bridgeSocketRef.emit('command:alarm', {
      deviceId,
      zone:      active ? 'line1' : 'zone1',
      cowToken:  null,
      timestamp: Date.now()
    });
    console.log(`[Line1 Test] LED1 ${active ? 'ON' : 'OFF'} → ${deviceId}`);
    res.json({ success: true, active: !!active });
  } catch (error) {
    console.error('Error sending line1 test command:', error);
    res.status(500).json({ error: 'Failed to send line1 test command' });
  }
});

// POST toggle offline/online mode for a connected ESP32 device
router.post('/esp32-cows/:deviceId/offline-mode', authenticateDeveloper, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { enabled } = req.body;

    // Persist virtual offline state to dbt006 so the dropdown restores correctly on reload
    // deviceId is 'ESP32_AABBCCDDEE11' — match against 'ESP32_' || REPLACE(collar_id, ':', '')
    db.prepare(`
      UPDATE dbt006
      SET offline_mode_active = ?
      WHERE 'ESP32_' || REPLACE(collar_id, ':', '') = ? AND cow_type = 'esp32' AND user_token = ?
    `).run(enabled ? 1 : 0, deviceId, req.developerToken);

    if (!bridgeSocketRef) {
      return res.status(503).json({ error: 'Bridge not connected' });
    }
    bridgeSocketRef.emit('command:offline_mode', {
      deviceId: deviceId,   // already in 'ESP32_XXXXXX' format from frontend
      enabled:  !!enabled,
      timestamp: Date.now()
    });
    console.log(`[Offline Mode] ${enabled ? 'OFFLINE' : 'ONLINE'} command sent to ${deviceId}, dbt006 updated`);

    // When going offline, trigger the same msg11 alert as a real disconnect
    if (enabled) {
      try {
        const cow = db.prepare(`
          SELECT collar_id, cow_token, cow_name, user_token FROM dbt006
          WHERE 'ESP32_' || REPLACE(collar_id, ':', '') = ? AND user_token = ?
        `).get(deviceId, req.developerToken);

        if (cow) {
          const userRow = db.prepare(
            `SELECT email, developer_name, user_parameter FROM dbt010 WHERE user_token = ?`
          ).get(cow.user_token);

          if (userRow) {
            const prefs = userRow.user_parameter ? JSON.parse(userRow.user_parameter) : {};
            if (prefs.offlineAlertEnabled !== false) {
              const cowName = cow.cow_name || cow.cow_token;
              notifyESP32Offline(cow.user_token, cow.cow_token, cowName, cow.collar_id);
              if (prefs.gmailAlertsEnabled !== false) {
                sendESP32OfflineEmail(userRow.email, userRow.developer_name, cowName, cow.collar_id)
                  .catch(err => console.error('[Virtual Offline Alert] Gmail failed:', err.message));
              }
              console.log(`[Virtual Offline Alert] Sent for cow "${cowName}" (${cow.collar_id})`);
            }
          }
        }
      } catch (err) {
        console.error('[Virtual Offline Alert Error]', err);
      }
    }

    res.json({ success: true, enabled: !!enabled });
  } catch (error) {
    console.error('Error sending offline mode command:', error);
    res.status(500).json({ error: 'Failed to send offline mode command' });
  }
});

module.exports = router;
module.exports.setWebSocketServer = setWebSocketServer;
module.exports.setBridgeSocket = setBridgeSocket;
