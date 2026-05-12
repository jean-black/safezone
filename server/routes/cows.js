const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken, generateToken } = require('../middleware/auth');
const gmailService = require('../utils/gmailService');
const { notifyNewCowRegistered } = require('../services/notificationService');
const { sendNewCowRegisteredEmail } = require('../services/emailService');
const { now } = require('../utils/dateFormatter');

// Get all cows
router.get('/', authenticateToken, (req, res) => {
  try {
    const userToken = req.user.token;

    // Check if user is a developer
    const developer = db.prepare('SELECT user_token FROM dbt010 WHERE user_token = ?').get(userToken);

    let cows = [];

    if (developer) {
      // Developer: all cows (both virtual and ESP32) live in dbt006
      cows = db.prepare(`
        SELECT
          cow_name, cow_nickname, collar_id, cow_token, farm_token, state_fence,
          time_inside, time_outside, total_breach, collar_state,
          registered_at, assigned_at, connected_at, last_seen, timestamp,
          gps_latitude, gps_longitude,
          virtual_latitude, virtual_longitude,
          actual_time_inside_fence, actual_time_outside_fence, zone_changed_at,
          CASE
            WHEN COALESCE(cow_type, 'virtual') = 'esp32'
             AND COALESCE(last_position_source, 'virtual') = 'virtual'
             AND virtual_latitude IS NOT NULL AND virtual_latitude != 0
            THEN (virtual_latitude || ',' || virtual_longitude)
            ELSE (gps_latitude || ',' || gps_longitude)
          END as real_time_coordinate,
          COALESCE(cow_type, 'virtual') as cow_type, reg_number,
          COALESCE(last_position_source, 'virtual') as last_position_source,
          ROW_NUMBER() OVER (PARTITION BY user_token ORDER BY reg_number) as queue_pos
        FROM dbt006
        WHERE user_token = ?
        ORDER BY timestamp ASC
      `).all(userToken).map(c => ({
        ...c,
        display_name: c.reg_number
          ? `cow${c.reg_number}_${c.queue_pos}_${c.cow_type === 'esp32' ? 'E' : 'V'}`
          : c.cow_name
      }));
    } else {
      // Farmer: load only their real cows from dbt4
      const stmt = db.prepare(`
        SELECT cow_name, cow_nickname, collar_id, cow_token, farm_token, state_fence, time_inside, time_outside, total_breach,
               collar_state, registered_at, assigned_at, connected_at, last_seen, timestamp,
               gps_latitude, gps_longitude,
               actual_time_inside_fence, actual_time_outside_fence, zone_changed_at,
               (gps_latitude || ',' || gps_longitude) as real_time_coordinate,
               'real' as cow_type, reg_number,
               ROW_NUMBER() OVER (PARTITION BY user_token ORDER BY reg_number) as queue_pos
        FROM dbt004
        WHERE user_token = ?
        ORDER BY timestamp ASC
      `);
      cows = stmt.all(userToken).map(c => ({
        ...c,
        display_name: c.reg_number ? `cow${c.reg_number}_${c.queue_pos}` : c.cow_name
      }));
    }

    res.json({ cows });
  } catch (error) {
    console.error('Cows error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ESP32 register endpoint - automatically adds cow when ESP32 connects
router.post('/register', async (req, res) => {
  try {
    const { macAddress, farmerToken } = req.body;

    if (!macAddress) {
      return res.status(400).json({ error: 'MAC address is required' });
    }

    if (!farmerToken) {
      return res.status(400).json({ error: 'farmerToken is required' });
    }

    // Check if account type1 (farmer) or type2 (developer)
    const farmerRow = db.prepare('SELECT user_token FROM dbt001 WHERE user_token = ?').get(farmerToken);
    const devRow    = db.prepare('SELECT user_token FROM dbt010 WHERE user_token = ?').get(farmerToken);

    if (!farmerRow && !devRow) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isDeveloper = !!devRow;
    const resolvedFarmerToken = farmerToken;
    const targetTable = isDeveloper ? 'dbt006' : 'dbt004';
    const seqTable    = isDeveloper ? 'dbt006_seq' : 'dbt004_seq';

    // Check if this collar already exists in the correct table
    const existingCow = db.prepare(`SELECT * FROM ${targetTable} WHERE collar_id = ?`).get(macAddress);

    if (existingCow) {
      return res.json({
        success: true,
        cow_token: existingCow.cow_token,
        cow_name: existingCow.cow_name,
        collar_id: existingCow.collar_id,
        message: 'Collar already registered'
      });
    }

    // Generate cow token and reg_number via AUTOINCREMENT sequence table
    const cowToken = generateToken();
    const seqResult = db.prepare(`INSERT INTO ${seqTable} (user_token, created_at) VALUES (?, ?)`).run(resolvedFarmerToken, now());
    const regNumber = seqResult.lastInsertRowid;
    const cowName = `cow${regNumber}`;

    if (isDeveloper) {
      // Developer ESP32 cow → dbt006 with cow_type='esp32'
      db.prepare(`
        INSERT INTO dbt006 (cow_name, cow_nickname, collar_id, cow_token, user_token, farm_token, state_fence,
          time_inside, time_outside, total_breach, timestamp, reg_number, cow_type,
          alarm1_triggered, alarm2_triggered, alarm3_triggered)
        VALUES (?, NULL, ?, ?, ?, NULL, 'outside', 0, 0, 0, ?, ?, 'esp32', 0, 0, 0)
      `).run(cowName, macAddress, cowToken, resolvedFarmerToken, now(), regNumber);
      db.prepare('UPDATE dbt010 SET total_cows = total_cows + 1 WHERE user_token = ?').run(resolvedFarmerToken);
    } else {
      // Farmer ESP32 cow → dbt004
      db.prepare(`
        INSERT INTO dbt004 (cow_name, cow_nickname, collar_id, cow_token, user_token, farm_token, state_fence,
          time_inside, time_outside, total_breach, timestamp, reg_number)
        VALUES (?, NULL, ?, ?, ?, NULL, 'outside', 0, 0, 0, ?, ?)
      `).run(cowName, macAddress, cowToken, resolvedFarmerToken, now(), regNumber);
      db.prepare('UPDATE dbt001 SET total_cows = total_cows + 1 WHERE user_token = ?').run(resolvedFarmerToken);
    }

    // Create in-app notification for new cow registration
    notifyNewCowRegistered(resolvedFarmerToken, cowToken, cowName, macAddress);

    // Gmail notification (msg8)
    try {
      let userEmail = null, userName = null;
      if (isDeveloper) {
        const devRow = db.prepare('SELECT email, developer_name FROM dbt010 WHERE user_token = ?').get(resolvedFarmerToken);
        if (devRow) { userEmail = devRow.email; userName = devRow.developer_name; }
      } else {
        const farmerRow = db.prepare('SELECT user_id AS email, farmer_name FROM dbt001 WHERE user_token = ?').get(resolvedFarmerToken);
        if (farmerRow) { userEmail = farmerRow.email; userName = farmerRow.farmer_name; }
      }
      if (userEmail) {
        const userParamRow = db.prepare(`SELECT user_parameter FROM ${isDeveloper ? 'dbt010' : 'dbt001'} WHERE user_token = ?`).get(resolvedFarmerToken);
        const prefs = userParamRow?.user_parameter ? JSON.parse(userParamRow.user_parameter) : {};
        if (prefs.gmailAlertsEnabled !== false) {
          sendNewCowRegisteredEmail(userEmail, userName, cowName, macAddress, 'esp32')
            .catch(err => console.error('[msg8] Gmail failed:', err.message));
        }
      }
    } catch (emailErr) {
      console.error('[msg8] Email lookup error:', emailErr.message);
    }

    res.json({
      success: true,
      cow_token: cowToken,
      cow_name: cowName,
      collar_id: macAddress,
      message: 'Cow registered successfully and added to new cows list'
    });
  } catch (error) {
    console.error('Register cow error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update cow nickname
router.put('/:collarId/nickname', authenticateToken, (req, res) => {
  try {
    const { collarId } = req.params;
    const { nickname } = req.body;
    const farmerToken = req.user.token;

    // Check if user is a developer (developers can update any cow)
    const isDeveloper = db.prepare('SELECT user_token FROM dbt010 WHERE user_token = ?').get(farmerToken);

    // Try updating in dbt004 (assigned real cows)
    let stmt = db.prepare(`
      UPDATE dbt004
      SET cow_nickname = ?
      WHERE collar_id = ? ${!isDeveloper ? 'AND user_token = ?' : ''}
    `);
    let result = isDeveloper ? stmt.run(nickname || null, collarId) : stmt.run(nickname || null, collarId, farmerToken);

    if (result.changes > 0) {
      console.log(`[Nickname] Updated dbt004 cow: ${collarId} with nickname: ${nickname}`);
      return res.json({ success: true, message: 'Cow nickname updated successfully' });
    }

    // Try updating in dbt005 (new ESP32 connected cows)
    stmt = db.prepare(`
      UPDATE dbt005
      SET cow_nickname = ?
      WHERE collar_id = ?
    `);
    result = stmt.run(nickname || null, collarId);

    if (result.changes > 0) {
      console.log(`[Nickname] Updated dbt005 cow: ${collarId} with nickname: ${nickname}`);
      return res.json({ success: true, message: 'Cow nickname updated successfully' });
    }

    // Try updating in dbt006 (virtual cows for development)
    stmt = db.prepare(`
      UPDATE dbt006
      SET cow_nickname = ?
      WHERE collar_id = ? ${!isDeveloper ? 'AND user_token = ?' : ''}
    `);
    result = isDeveloper ? stmt.run(nickname || null, collarId) : stmt.run(nickname || null, collarId, farmerToken);

    if (result.changes > 0) {
      console.log(`[Nickname] Updated dbt006 virtual cow: ${collarId} with nickname: ${nickname}`);
      return res.json({ success: true, message: 'Cow nickname updated successfully' });
    }

    // Cow not found in any table
    console.log(`[Nickname] Cow not found with collar_id: ${collarId}`);
    res.status(404).json({ error: 'Cow not found' });
  } catch (error) {
    console.error('Update cow nickname error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete cow - with dynamic cow name redistribution
router.delete('/:collarId', authenticateToken, (req, res) => {
  try {
    const { collarId } = req.params;
    const farmerToken = req.user.token;

    // Delete cow
    const stmt = db.prepare('DELETE FROM dbt004 WHERE collar_id = ? AND user_token = ?');
    const result = stmt.run(collarId, farmerToken);

    if (result.changes > 0) {
      // Decrement total_cow counter
      const updateStmt = db.prepare('UPDATE dbt001 SET total_cows = total_cows - 1 WHERE user_token = ?');
      updateStmt.run(farmerToken);

      // Decrement developer's total_cows counter (sum of dbt004 + dbt6)
      const farmer = db.prepare('SELECT developer_token FROM dbt001 WHERE user_token = ?').get(farmerToken);
      if (farmer && farmer.developer_token) {
        db.prepare('UPDATE dbt010 SET total_cows = total_cows - 1 WHERE user_token = ?')
          .run(farmer.developer_token);
        console.log(`[Delete] Decremented developer total_cows for: ${farmer.developer_token}`);
      }

      // Redistribute cow names dynamically
      // Get all remaining cows for this farmer, ordered by id
      const getCowsStmt = db.prepare('SELECT id, collar_id FROM dbt004 WHERE user_token = ? ORDER BY id ASC');
      const remainingCows = getCowsStmt.all(farmerToken);

      // Update cow names sequentially from cow1
      const updateNameStmt = db.prepare('UPDATE dbt004 SET cow_name = ? WHERE id = ?');
      remainingCows.forEach((cow, index) => {
        const newCowName = `cow${index + 1}`;
        updateNameStmt.run(newCowName, cow.id);
      });

      res.json({ success: true, message: 'Cow deleted and names redistributed successfully' });
    } else {
      res.status(404).json({ error: 'Cow not found' });
    }
  } catch (error) {
    console.error('Delete cow error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ESP32 data submission endpoint
router.post('/esp32/data', async (req, res) => {
  try {
    const { cowToken, state, timeSpent, alarmState } = req.body;

    if (!cowToken) {
      return res.status(400).json({ error: 'Cow token is required' });
    }

    // Update cow state and time tracking
    if (state) {
      const updateStateStmt = db.prepare('UPDATE dbt004 SET state_fence = ? WHERE cow_token = ?');
      updateStateStmt.run(state, cowToken);
    }

    // Update time spent inside/outside (time in seconds)
    if (timeSpent !== undefined && state) {
      if (state === 'inside') {
        const updateTimeStmt = db.prepare('UPDATE dbt004 SET time_inside = time_inside + ? WHERE cow_token = ?');
        updateTimeStmt.run(timeSpent, cowToken);
      } else if (state === 'outside') {
        const updateTimeStmt = db.prepare('UPDATE dbt004 SET time_outside = time_outside + ? WHERE cow_token = ?');
        updateTimeStmt.run(timeSpent, cowToken);
      }
    }

    // Handle alarm breach
    if (alarmState && alarmState !== 'normal') {
      // Increment alarm breach counter
      const updateAlarmStmt = db.prepare('UPDATE dbt004 SET total_breach = total_breach + 1 WHERE cow_token = ?');
      updateAlarmStmt.run(cowToken);

      // Record in dbt015 so the histogram pipeline picks it up (skip if no farm assigned)
      const cow4 = db.prepare('SELECT user_token, farm_token FROM dbt004 WHERE cow_token = ?').get(cowToken);
      if (cow4?.user_token && cow4?.farm_token) {
        try {
          db.prepare('INSERT INTO dbt015 (user_token, farm_token, minute_timestamp, breach_count_minute) VALUES (?, ?, datetime("now"), 1)')
            .run(cow4.user_token, cow4.farm_token);
        } catch (_) {}
      }

      // Get cow details for email
      const cowStmt = db.prepare('SELECT cow_name, cow_nickname, collar_id FROM dbt004 WHERE cow_token = ?');
      const cow = cowStmt.get(cowToken);

      // Use nickname if available, otherwise cow name
      const displayName = cow?.cow_nickname || cow?.cow_name || `Collar ${cow?.collar_id || cowToken}`;

      // Send alert email
      await gmailService.sendAlert(
        process.env.GMAIL_RECEIVER || 'jeanclaudemng@gmail.com',
        'SafeZone Alert',
        `${displayName} (${cow?.collar_id}) has triggered alarm: ${alarmState}`
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('ESP32 data error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Test email endpoint
router.post('/test-email', authenticateToken, async (req, res) => {
  try {
    const { receiver } = req.body;
    const testReceiver = receiver || process.env.GMAIL_RECEIVER || 'jeanclaudemng@gmail.com';

    const result = await gmailService.sendAlert(
      testReceiver,
      'Test Email from SafeZone',
      'This is a test email to verify Gmail integration is working correctly. If you receive this message, the email system is functioning properly!'
    );

    if (result.success) {
      res.json({ success: true, message: 'Test email sent successfully!', messageId: result.messageId });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({ success: false, error: 'Failed to send test email' });
  }
});

// Get new cows (cows without farm assignment)
router.get('/new', authenticateToken, (req, res) => {
  try {
    const farmerToken = req.user.token;

    // Get unassigned cows from dbt4
    const stmt4 = db.prepare(`
      SELECT cow_name, cow_nickname, collar_id, cow_token, collar_state, registered_at, connected_at, last_seen, timestamp
      FROM dbt004
      WHERE user_token = ? AND (farm_token IS NULL OR farm_token = '')
      ORDER BY timestamp ASC
    `);
    const dbt4Cows = stmt4.all(farmerToken);

    // Get new ESP32 cows from dbt005 belonging to this farmer
    const stmt5 = db.prepare(`
      SELECT cow_name, cow_nickname, collar_id, cow_token, collar_state,
             timestamp, registered_at, connected_at, last_seen
      FROM dbt005
      WHERE user_token = ?
      ORDER BY timestamp ASC
    `);
    const dbt5Cows = stmt5.all(farmerToken);

    // Combine, deduplicate by cow_token (dbt004 takes priority over dbt005)
    const seenTokens = new Set(dbt4Cows.map(c => c.cow_token));
    const filteredDbt5 = dbt5Cows.filter(c => !seenTokens.has(c.cow_token));
    const newCows = [...dbt4Cows, ...filteredDbt5];

    res.json({ newCows });
  } catch (error) {
    console.error('Get new cows error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Assign cow to farm
router.put('/:cowToken/assign-farm', authenticateToken, (req, res) => {
  try {
    const { cowToken } = req.params;
    const { farmToken } = req.body;
    const farmerToken = req.user.token;

    // Verify the farm belongs to this farmer (if farmToken provided)
    if (farmToken) {
      const farmStmt = db.prepare('SELECT * FROM dbt002 WHERE farm_token = ? AND user_token = ?');
      const farm = farmStmt.get(farmToken, farmerToken);

      if (!farm) {
        return res.status(404).json({ error: 'Farm not found' });
      }
    }

    // Check if cow exists in dbt005 (new ESP32 connected cows)
    const dbt5Cow = db.prepare('SELECT * FROM dbt005 WHERE cow_token = ?').get(cowToken);

    if (dbt5Cow) {
      const isDevAssign = !!db.prepare('SELECT user_token FROM dbt010 WHERE user_token = ?').get(farmerToken);
      const targetTable = isDevAssign ? 'dbt006' : 'dbt004';
      const seqTable    = isDevAssign ? 'dbt006_seq' : 'dbt004_seq';

      console.log(`[Assign] Moving cow from dbt005 to ${targetTable}:`, dbt5Cow.cow_name);

      const seq5 = db.prepare(`INSERT INTO ${seqTable} (user_token, created_at) VALUES (?, ?)`).run(farmerToken, now());
      const regNum5 = seq5.lastInsertRowid;
      const ts = now();

      if (isDevAssign) {
        // If another developer already has this collar_id in dbt006, archive it first to avoid UNIQUE collision
        const existingDbt6 = db.prepare("SELECT * FROM dbt006 WHERE collar_id = ? AND cow_type = 'esp32'").get(dbt5Cow.collar_id);
        if (existingDbt6 && existingDbt6.user_token !== farmerToken) {
          db.prepare(`INSERT INTO dbt033 (cow_name, cow_nickname, cow_token, collar_id,
            original_user_token, original_farm_token, original_table, archived_at, archived_reason,
            timestamp, registered_at, assigned_at, connected_at, last_seen,
            state_fence, time_inside, time_outside, total_breach,
            actual_time_inside_fence, actual_time_outside_fence,
            gps_latitude, gps_longitude, collar_state,
            alarm1_triggered, alarm2_triggered, alarm3_triggered,
            alarm1_triggered_at, alarm2_triggered_at, alarm3_triggered_at,
            current_breach_cycle, reg_number, cow_type, zone_changed_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `).run(
            existingDbt6.cow_name, existingDbt6.cow_nickname, existingDbt6.cow_token, existingDbt6.collar_id,
            existingDbt6.user_token, existingDbt6.farm_token, 'dbt006', now(), 'reassignment',
            existingDbt6.timestamp, existingDbt6.registered_at, existingDbt6.assigned_at,
            existingDbt6.connected_at, existingDbt6.last_seen,
            existingDbt6.state_fence, existingDbt6.time_inside||0, existingDbt6.time_outside||0, existingDbt6.total_breach||0,
            existingDbt6.actual_time_inside_fence||0, existingDbt6.actual_time_outside_fence||0,
            existingDbt6.gps_latitude, existingDbt6.gps_longitude, existingDbt6.collar_state,
            existingDbt6.alarm1_triggered, existingDbt6.alarm2_triggered, existingDbt6.alarm3_triggered,
            existingDbt6.alarm1_triggered_at, existingDbt6.alarm2_triggered_at, existingDbt6.alarm3_triggered_at,
            existingDbt6.current_breach_cycle, existingDbt6.reg_number, 'esp32', existingDbt6.zone_changed_at
          );
          db.prepare('DELETE FROM dbt006 WHERE collar_id = ?').run(dbt5Cow.collar_id);
          console.log(`[Assign] Archived previous dbt006 record for collar ${dbt5Cow.collar_id} to dbt033`);
        }

        db.prepare(`
          INSERT INTO dbt006 (
            cow_name, cow_nickname, collar_id, cow_token, user_token, farm_token,
            state_fence, time_inside, time_outside, total_breach, timestamp,
            alarm1_triggered, alarm2_triggered, alarm3_triggered,
            collar_state, registered_at, connected_at, last_seen, assigned_at,
            reg_number, cow_type
          ) VALUES (?, ?, ?, ?, ?, ?, 'outside', 0, 0, 0, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, 'esp32')
        `).run(
          `cow${regNum5}`, dbt5Cow.cow_nickname, dbt5Cow.collar_id, dbt5Cow.cow_token,
          farmerToken, farmToken || null, ts,
          dbt5Cow.collar_state || 'disconnected',
          dbt5Cow.registered_at || ts, dbt5Cow.connected_at || null,
          dbt5Cow.last_seen || null, ts, regNum5
        );
        db.prepare('UPDATE dbt010 SET total_cows = total_cows + 1 WHERE user_token = ?').run(farmerToken);
      } else {
        // Check for collar_id conflict in dbt004 before inserting
        const existingDbt4 = db.prepare('SELECT * FROM dbt004 WHERE collar_id = ?').get(dbt5Cow.collar_id);
        if (existingDbt4 && existingDbt4.cow_token === cowToken) {
          // Same cow already in dbt004 (duplicate state) — just update farm_token, skip INSERT
          db.prepare('UPDATE dbt004 SET farm_token = ?, assigned_at = ? WHERE cow_token = ?').run(farmToken || null, ts, cowToken);
          console.log(`[Assign] Cow already in dbt004, updated farm_token for: ${existingDbt4.cow_name}`);
        } else {
          if (existingDbt4) {
            // Different cow occupying collar_id — archive it first
            db.prepare(`INSERT INTO dbt033 (cow_name, cow_nickname, cow_token, collar_id,
              original_user_token, original_farm_token, original_table, archived_at, archived_reason,
              timestamp, registered_at, assigned_at, connected_at, last_seen,
              state_fence, time_inside, time_outside, total_breach,
              actual_time_inside_fence, actual_time_outside_fence,
              gps_latitude, gps_longitude, collar_state, reg_number, zone_changed_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            `).run(
              existingDbt4.cow_name, existingDbt4.cow_nickname, existingDbt4.cow_token, existingDbt4.collar_id,
              existingDbt4.user_token, existingDbt4.farm_token, 'dbt004', ts, 'collar_reassignment',
              existingDbt4.timestamp, existingDbt4.registered_at, existingDbt4.assigned_at,
              existingDbt4.connected_at, existingDbt4.last_seen,
              existingDbt4.state_fence, existingDbt4.time_inside||0, existingDbt4.time_outside||0, existingDbt4.total_breach||0,
              existingDbt4.actual_time_inside_fence||0, existingDbt4.actual_time_outside_fence||0,
              existingDbt4.gps_latitude, existingDbt4.gps_longitude, existingDbt4.collar_state,
              existingDbt4.reg_number, existingDbt4.zone_changed_at
            );
            db.prepare('DELETE FROM dbt004 WHERE collar_id = ?').run(dbt5Cow.collar_id);
            console.log(`[Assign] Archived conflicting dbt004 record for collar ${dbt5Cow.collar_id}`);
          }
          db.prepare(`
            INSERT INTO dbt004 (
              cow_name, cow_nickname, collar_id, cow_token, user_token, farm_token,
              state_fence, time_inside, time_outside, total_breach, timestamp,
              alarm1_triggered, alarm2_triggered, alarm3_triggered,
              collar_state, registered_at, connected_at, last_seen, assigned_at, reg_number
            ) VALUES (?, ?, ?, ?, ?, ?, 'outside', 0, 0, 0, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?)
          `).run(
            `cow${regNum5}`, dbt5Cow.cow_nickname, dbt5Cow.collar_id, dbt5Cow.cow_token,
            farmerToken, farmToken || null, ts,
            dbt5Cow.collar_state || 'disconnected',
            dbt5Cow.registered_at || ts, dbt5Cow.connected_at || null,
            dbt5Cow.last_seen || null, ts, regNum5
          );
          db.prepare('UPDATE dbt001 SET total_cows = total_cows + 1 WHERE user_token = ?').run(farmerToken);
          const farmer = db.prepare('SELECT developer_token FROM dbt001 WHERE user_token = ?').get(farmerToken);
          if (farmer?.developer_token) {
            db.prepare('UPDATE dbt010 SET total_cows = total_cows + 1 WHERE user_token = ?').run(farmer.developer_token);
          }
        }
      }

      db.prepare('DELETE FROM dbt005 WHERE cow_token = ?').run(cowToken);

      if (farmToken) {
        db.prepare('UPDATE dbt002 SET total_number_of_cow = total_number_of_cow + 1 WHERE farm_token = ?').run(farmToken);
      }

      return res.json({ success: true, message: `Cow moved from dbt005 to ${targetTable} and assigned successfully` });
    }

    // Check if user is a developer — developer cows live in dbt006, farmer cows in dbt004
    const isDeveloper = db.prepare('SELECT user_token FROM dbt010 WHERE user_token = ?').get(farmerToken);

    // Farmers look in dbt004; developers look in dbt006
    let dbt4Cow;
    if (isDeveloper) {
      dbt4Cow = db.prepare('SELECT * FROM dbt006 WHERE cow_token = ? AND user_token = ?').get(cowToken, farmerToken);
    } else {
      dbt4Cow = db.prepare('SELECT * FROM dbt004 WHERE cow_token = ? AND user_token = ?').get(cowToken, farmerToken);
    }

    if (dbt4Cow) {
      const oldFarmToken = dbt4Cow.farm_token;
      const assignTable = isDeveloper ? 'dbt006' : 'dbt004';

      db.prepare(`UPDATE ${assignTable} SET farm_token = ?, assigned_at = ? WHERE cow_token = ?`)
        .run(farmToken || null, now(), cowToken);

      console.log(`[Assign] ${isDeveloper ? 'Developer' : 'Farmer'} assigned cow from ${assignTable}: ${dbt4Cow.cow_name} to farm: ${farmToken}`);

      // Update dbt002 farm counters
      // If cow was previously assigned to a farm, decrement that farm's count
      if (oldFarmToken) {
        db.prepare('UPDATE dbt002 SET total_number_of_cow = total_number_of_cow - 1 WHERE farm_token = ?')
          .run(oldFarmToken);
        console.log(`[Assign] Decremented dbt002 total_number_of_cow for old farm: ${oldFarmToken}`);
      }

      // If cow is being assigned to a new farm, increment that farm's count
      if (farmToken) {
        db.prepare('UPDATE dbt002 SET total_number_of_cow = total_number_of_cow + 1 WHERE farm_token = ?')
          .run(farmToken);
        console.log(`[Assign] Incremented dbt002 total_number_of_cow for new farm: ${farmToken}`);
      }

      // Clean up any duplicate entry in dbt005 with the same collar_id
      const cleanupStmt = db.prepare('DELETE FROM dbt005 WHERE collar_id = ?');
      const cleanupResult = cleanupStmt.run(dbt4Cow.collar_id);

      if (cleanupResult.changes > 0) {
        console.log(`[Cleanup] Removed duplicate from dbt005 for collar_id: ${dbt4Cow.collar_id}`);
      }

      return res.json({ success: true, message: 'Cow farm assignment updated successfully' });
    }

    // Check if cow exists in dbt006 (virtual cows for development)
    const dbt6Cow = db.prepare('SELECT * FROM dbt006 WHERE cow_token = ?').get(cowToken);

    if (dbt6Cow) {
      const oldFarmToken = dbt6Cow.farm_token;

      // Update virtual cow's farm assignment in dbt6
      console.log('[Assign] Assigning virtual cow from dbt6:', dbt6Cow.cow_name, 'to farm:', farmToken);

      // Check if user is a developer (developer tokens are in dbt10, not dbt1)
      const isDeveloper = db.prepare('SELECT user_token FROM dbt010 WHERE user_token = ?').get(farmerToken);

      const updateStmt = db.prepare(`
        UPDATE dbt006
        SET farm_token = ?, assigned_at = ?${!isDeveloper ? ', user_token = ?' : ''}
        WHERE cow_token = ?
      `);

      // Only set user_token if user is an actual farmer (not a developer)
      if (isDeveloper) {
        // Developer: update farm_token and assigned_at
        updateStmt.run(farmToken || null, farmToken ? now() : null, cowToken);
        console.log('[Assign] Developer account - farm_token and assigned_at updated, user_token left unchanged');
      } else {
        // Farmer: update farm_token, assigned_at, and user_token
        updateStmt.run(farmToken || null, farmToken ? now() : null, farmerToken, cowToken);
        console.log('[Assign] Farmer account - farm_token, assigned_at, and user_token updated');
      }

      // Update dbt002 farm counters
      // If cow was previously assigned to a farm, decrement that farm's count
      if (oldFarmToken) {
        db.prepare('UPDATE dbt002 SET total_number_of_cow = total_number_of_cow - 1 WHERE farm_token = ?')
          .run(oldFarmToken);
        console.log(`[Assign] Decremented dbt002 total_number_of_cow for old farm: ${oldFarmToken}`);
      }

      // If cow is being assigned to a new farm, increment that farm's count
      if (farmToken) {
        db.prepare('UPDATE dbt002 SET total_number_of_cow = total_number_of_cow + 1 WHERE farm_token = ?')
          .run(farmToken);
        console.log(`[Assign] Incremented dbt002 total_number_of_cow for new farm: ${farmToken}`);
      }

      return res.json({ success: true, message: 'Virtual cow farm assignment updated successfully' });
    }

    // Cow not found in any table
    res.status(404).json({ error: 'Cow not found' });
  } catch (error) {
    console.error('Assign cow to farm error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk assign cows to farm
router.post('/bulk-assign', authenticateToken, (req, res) => {
  try {
    const { cowTokens, farmToken } = req.body;
    const farmerToken = req.user.token;

    if (!Array.isArray(cowTokens) || cowTokens.length === 0) {
      return res.status(400).json({ error: 'cowTokens must be a non-empty array' });
    }

    // Verify the farm belongs to this farmer
    if (farmToken) {
      const farmStmt = db.prepare('SELECT * FROM dbt002 WHERE farm_token = ? AND user_token = ?');
      const farm = farmStmt.get(farmToken, farmerToken);

      if (!farm) {
        return res.status(404).json({ error: 'Farm not found' });
      }
    }

    // Update all cows' farm assignments
    const stmt = db.prepare(`
      UPDATE dbt004
      SET farm_token = ?
      WHERE cow_token = ? AND user_token = ?
    `);

    const updateMany = db.transaction((cows) => {
      for (const cowToken of cows) {
        stmt.run(farmToken || null, cowToken, farmerToken);
      }
    });

    updateMany(cowTokens);

    res.json({ success: true, message: `${cowTokens.length} cows assigned successfully` });
  } catch (error) {
    console.error('Bulk assign cows error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update cow name
router.put('/:cowToken/name', authenticateToken, (req, res) => {
  try {
    const { cowToken } = req.params;
    const { name } = req.body;
    const farmerToken = req.user.token;

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Name is required' });
    }

    const stmt = db.prepare(`
      UPDATE dbt004
      SET cow_name = ?
      WHERE cow_token = ? AND user_token = ?
    `);
    const result = stmt.run(name.trim(), cowToken, farmerToken);

    if (result.changes > 0) {
      res.json({ success: true, message: 'Cow name updated successfully' });
    } else {
      res.status(404).json({ error: 'Cow not found' });
    }
  } catch (error) {
    console.error('Update cow name error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
