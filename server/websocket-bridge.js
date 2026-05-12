const WebSocket = require('ws');
const io = require('socket.io-client');
const { now } = require('./utils/dateFormatter');
const { db } = require('./config/database');
const { sendESP32ConnectedEmail } = require('./services/emailService');
const { notifyESP32Connected } = require('./services/notificationService');

// WebSocket server for ESP32 (Plain WebSocket on port 8081)
const wss = new WebSocket.Server({ port: 8081 });

// Connect to main server Socket.IO on port 3000
const socket = io('http://localhost:3000', {
  transports: ['polling', 'websocket'], // Try polling first, then upgrade to websocket
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 10,
  forceNew: true,
  timeout: 10000
});

console.log('WebSocket Bridge Server Starting...');
console.log('ESP32 WebSocket Server: ws://localhost:8081');
console.log('Main Server Socket.IO: http://localhost:3000');

// Track connected ESP32 devices
const connectedDevices = new Map();

// Socket.IO connection to main server
socket.on('connect', () => {
  console.log('✓ Connected to main server Socket.IO (port 3000)');
});

socket.on('disconnect', () => {
  console.log('✗ Disconnected from main server Socket.IO');
});

socket.on('connect_error', (error) => {
  console.error('Main server connection error:', error.message);
  console.error('Error type:', error.type);
  console.error('Error description:', error.description);
});

// WebSocket server for ESP32 devices
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`\n[ESP32] New connection from ${clientIp}`);

  let deviceId = null;
  let deviceInfo = null;
  let isAlive = true;

  // Heartbeat ping/pong to detect dead connections
  ws.on('pong', () => {
    isAlive = true;
  });

  const heartbeatInterval = setInterval(() => {
    if (isAlive === false) {
      console.log(`[ESP32] Heartbeat timeout - terminating connection for ${deviceId || 'unknown'}`);
      clearInterval(heartbeatInterval);
      ws.terminate();
      return;
    }

    isAlive = false;
    ws.ping();
  }, 10000); // Ping every 10 seconds

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      // Handle device registration
      if (message.type === 'register') {
        deviceId = message.deviceId;
        deviceInfo = {
          deviceId: message.deviceId,
          macAddress: message.macAddress,
          ipAddress: message.ipAddress,
          codeEmail: message.codeEmail,
          ws: ws,
          connectedAt: now(),
          userToken: null  // filled in after DB resolution below
        };

        connectedDevices.set(deviceId, deviceInfo);

        console.log(`[ESP32] Device registered: ${deviceId}`);
        console.log(`  MAC: ${message.macAddress}`);
        console.log(`  IP: ${message.ipAddress}`);
        console.log(`  Email: ${message.codeEmail}`);

        // --- Email-based registration with NVS two-email fallback system ---
        let resolvedUserToken = null;
        let alarmConfig = null;
        let responseEmail1 = '';
        let responseEmail2 = '';
        try {
          const mac       = message.macAddress;
          const codeEmail = (message.codeEmail || '').trim();
          const email1    = (message.email1    || '').trim();
          const email2    = (message.email2    || '').trim();

          // Helper: resolve an email to a user_token (checks dbt001 farmers + dbt010 developers)
          function resolveEmailToToken(email) {
            if (!email) return null;
            const r1 = db.prepare('SELECT user_token FROM dbt001 WHERE user_id = ?').get(email);
            if (r1) return r1.user_token;
            const r2 = db.prepare('SELECT user_token FROM dbt010 WHERE email = ?').get(email);
            return r2 ? r2.user_token : null;
          }

          // Helper: send MSG8 notification to a user (checks dbt001 + dbt010, respects gmailAlertsEnabled)
          function notifyReassignedOwner(userToken, deviceMac, deviceIdStr) {
            try {
              let userEmail = null, userName = null, prefs = {};
              const fr = db.prepare('SELECT user_id AS email, farmer_name AS name, user_parameter FROM dbt001 WHERE user_token = ?').get(userToken);
              if (fr) { userEmail = fr.email; userName = fr.name; prefs = fr.user_parameter ? JSON.parse(fr.user_parameter) : {}; }
              else {
                const dr = db.prepare('SELECT email, developer_name AS name, user_parameter FROM dbt010 WHERE user_token = ?').get(userToken);
                if (dr) { userEmail = dr.email; userName = dr.name; prefs = dr.user_parameter ? JSON.parse(dr.user_parameter) : {}; }
              }
              if (userEmail) {
                notifyESP32Connected(userToken, deviceMac, deviceIdStr);
                if (prefs.gmailAlertsEnabled !== false) {
                  sendESP32ConnectedEmail(userEmail, userName, deviceIdStr, deviceMac).catch(() => {});
                }
              }
            } catch (e) {
              console.error('[ESP32][REASSIGN] msg8 error:', e.message);
            }
          }

          // Helper: archive a full cow record from dbt004/dbt006 to dbt033
          function archiveCowRecord(cow, sourceTable, reason) {
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
              cow.cow_name, cow.cow_nickname, cow.cow_token, cow.collar_id,
              cow.user_token, cow.farm_token, sourceTable, now(), reason,
              cow.timestamp, cow.registered_at, cow.assigned_at, cow.connected_at, cow.last_seen,
              cow.state_fence, cow.time_inside||0, cow.time_outside||0, cow.total_breach||0,
              cow.actual_time_inside_fence||0, cow.actual_time_outside_fence||0,
              cow.gps_latitude, cow.gps_longitude, cow.collar_state,
              cow.alarm1_triggered, cow.alarm2_triggered, cow.alarm3_triggered,
              cow.alarm1_triggered_at, cow.alarm2_triggered_at, cow.alarm3_triggered_at,
              cow.current_breach_cycle, cow.reg_number, cow.cow_type || 'esp32', cow.zone_changed_at
            );
          }

          const ts = now();

          // Decision:
          // 1. codeEmail == email1 → same owner confirmed, just connect
          // 2. email2 exists       → server-set override active, just connect
          // 3. otherwise           → look up codeEmail in DB, reassign if found
          const sameOwner   = codeEmail.length > 0 && codeEmail === email1;
          const hasEmail2   = email2.length > 0;
          const justConnect = sameOwner || hasEmail2;

          // Default response emails
          responseEmail1 = email1 || codeEmail;
          responseEmail2 = email2;

          if (justConnect) {
            // ── Owner confirmed — just update connection state, no reassignment ──
            const inDbt4 = db.prepare('SELECT * FROM dbt004 WHERE collar_id = ?').get(mac);
            if (inDbt4) {
              db.prepare(`UPDATE dbt004 SET collar_state='connected', connected_at=?, last_seen=? WHERE collar_id=?`).run(ts, ts, mac);
              resolvedUserToken = inDbt4.user_token;
              console.log(`[ESP32][CONNECT] dbt004 — MAC ${mac} | user_token: ${resolvedUserToken}`);
            } else {
              const inDbt6 = db.prepare(`SELECT * FROM dbt006 WHERE collar_id = ? AND cow_type = 'esp32'`).get(mac);
              if (inDbt6) {
                db.prepare(`UPDATE dbt006 SET collar_state='connected', connected_at=?, last_seen=? WHERE collar_id=?`).run(ts, ts, mac);
                resolvedUserToken = inDbt6.user_token;
                console.log(`[ESP32][CONNECT] dbt006 — MAC ${mac} | user_token: ${resolvedUserToken}`);
              } else {
                const inDbt5 = db.prepare('SELECT * FROM dbt005 WHERE collar_id = ?').get(mac);
                if (inDbt5) {
                  db.prepare(`UPDATE dbt005 SET collar_state='connected', connected_at=?, last_seen=? WHERE collar_id=?`).run(ts, ts, mac);
                  resolvedUserToken = inDbt5.user_token;
                  console.log(`[ESP32][CONNECT] dbt005 — MAC ${mac} | user_token: ${resolvedUserToken}`);
                } else {
                  // Brand new device in just-connect mode (edge case)
                  const ownerEmail  = hasEmail2 ? email2 : (email1 || codeEmail);
                  resolvedUserToken = resolveEmailToToken(ownerEmail);
                  const count    = db.prepare('SELECT COUNT(*) as total FROM dbt005').get();
                  const cowName  = 'cow' + (count.total + 1);
                  const cowToken = 'COW_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                  db.prepare(`INSERT INTO dbt005 (cow_name, cow_nickname, cow_token, collar_id, timestamp, collar_state, user_token, registered_at, connected_at, last_seen) VALUES (?,?,?,?,?,'connected',?,?,?,?)`)
                    .run(cowName, null, cowToken, mac, ts, resolvedUserToken, ts, ts, ts);
                  console.log(`[ESP32][NEW-CONNECT] dbt005 insert: ${cowName} | MAC: ${mac}`);
                  if (resolvedUserToken) notifyReassignedOwner(resolvedUserToken, mac, message.deviceId);
                }
              }
            }
            // In same-owner mode, clear email2 (no override needed)
            if (sameOwner) {
              responseEmail1 = codeEmail;
              responseEmail2 = '';
            }
            // else email2-based connect: keep email1 and email2 unchanged

          } else {
            // ── codeEmail differs from email1, no email2 — look up and potentially reassign ──
            const emailUserToken = resolveEmailToToken(codeEmail);

            const inDbt4 = db.prepare('SELECT * FROM dbt004 WHERE collar_id = ?').get(mac);
            if (inDbt4) {
              const macUserToken = inDbt4.user_token;
              if (emailUserToken && emailUserToken !== macUserToken) {
                // ── Reassign: dbt004 → correct table based on new owner type ──
                db.transaction(() => {
                  archiveCowRecord(inDbt4, 'dbt004', 'reassignment');
                  const newOwnerIsDev = !!db.prepare('SELECT user_token FROM dbt010 WHERE user_token = ?').get(emailUserToken);
                  const archived = db.prepare('SELECT * FROM dbt033 WHERE collar_id = ? AND original_user_token = ? ORDER BY archived_at DESC LIMIT 1').get(mac, emailUserToken);

                  if (newOwnerIsDev) {
                    db.prepare('DELETE FROM dbt004 WHERE collar_id = ?').run(mac);
                    if (archived) {
                      const cowCount = db.prepare('SELECT COUNT(*) as total FROM dbt006 WHERE user_token = ?').get(emailUserToken).total;
                      const newName = 'cow' + (cowCount + 1);
                      db.prepare(`INSERT INTO dbt006 (cow_name, cow_nickname, cow_token, collar_id, timestamp,
                        collar_state, user_token, farm_token, registered_at, connected_at, last_seen,
                        state_fence, time_inside, time_outside, total_breach,
                        actual_time_inside_fence, actual_time_outside_fence,
                        gps_latitude, gps_longitude,
                        alarm1_triggered, alarm2_triggered, alarm3_triggered,
                        alarm1_triggered_at, alarm2_triggered_at, alarm3_triggered_at,
                        current_breach_cycle, reg_number, zone_changed_at, cow_type)
                        VALUES (?,?,?,?,?,'connected',?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'esp32')
                      `).run(
                        newName, archived.cow_nickname, archived.cow_token, mac, ts,
                        emailUserToken, ts, ts, ts,
                        archived.state_fence||'unknown', archived.time_inside||0, archived.time_outside||0, archived.total_breach||0,
                        archived.actual_time_inside_fence||0, archived.actual_time_outside_fence||0,
                        archived.gps_latitude, archived.gps_longitude,
                        archived.alarm1_triggered, archived.alarm2_triggered, archived.alarm3_triggered,
                        archived.alarm1_triggered_at, archived.alarm2_triggered_at, archived.alarm3_triggered_at,
                        archived.current_breach_cycle, archived.reg_number, archived.zone_changed_at
                      );
                      db.prepare('DELETE FROM dbt033 WHERE id=?').run(archived.id);
                      console.log(`[ESP32][RESTORE] dbt033 → dbt006 for ${emailUserToken} | MAC: ${mac}`);
                    } else {
                      // No prior history for this user — send to dbt005 for farm registration
                      const dbt5Count = db.prepare('SELECT COUNT(*) as total FROM dbt005').get().total;
                      const dbt5Name = 'cow' + (dbt5Count + 1);
                      const dbt5Token = 'COW_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                      db.prepare(`INSERT INTO dbt005 (cow_name, cow_nickname, cow_token, collar_id, timestamp,
                        collar_state, user_token, registered_at, connected_at, last_seen)
                        VALUES (?,NULL,?,?,?,'connected',?,?,?,?)
                      `).run(dbt5Name, dbt5Token, mac, ts, emailUserToken, ts, ts, ts);
                      console.log(`[ESP32][MOVE] dbt004 → dbt005 (no history): ${dbt5Name} | MAC: ${mac}`);
                    }
                  } else {
                    // Farmer — stay in dbt004
                    if (archived) {
                      const cowCount = db.prepare('SELECT COUNT(*) as total FROM dbt004 WHERE user_token = ?').get(emailUserToken).total;
                      const newName = 'cow' + (cowCount + 1);
                      db.prepare(`UPDATE dbt004 SET
                        user_token=?, cow_name=?, cow_nickname=?, farm_token=NULL,
                        state_fence=?, time_inside=?, time_outside=?, total_breach=?,
                        actual_time_inside_fence=?, actual_time_outside_fence=?,
                        gps_latitude=?, gps_longitude=?,
                        collar_state='connected', connected_at=?, last_seen=?,
                        alarm1_triggered=?, alarm2_triggered=?, alarm3_triggered=?,
                        alarm1_triggered_at=?, alarm2_triggered_at=?, alarm3_triggered_at=?,
                        current_breach_cycle=?, reg_number=?, zone_changed_at=?
                        WHERE collar_id=?`).run(
                        emailUserToken, newName, archived.cow_nickname,
                        archived.state_fence, archived.time_inside||0, archived.time_outside||0, archived.total_breach||0,
                        archived.actual_time_inside_fence||0, archived.actual_time_outside_fence||0,
                        archived.gps_latitude, archived.gps_longitude, ts, ts,
                        archived.alarm1_triggered, archived.alarm2_triggered, archived.alarm3_triggered,
                        archived.alarm1_triggered_at, archived.alarm2_triggered_at, archived.alarm3_triggered_at,
                        archived.current_breach_cycle, archived.reg_number, archived.zone_changed_at,
                        mac
                      );
                      db.prepare('DELETE FROM dbt033 WHERE id=?').run(archived.id);
                      console.log(`[ESP32][RESTORE] dbt033 → dbt004 for ${emailUserToken} | MAC: ${mac}`);
                    } else {
                      // No prior history for this user — delete from dbt004, send to dbt005
                      db.prepare('DELETE FROM dbt004 WHERE collar_id = ?').run(mac);
                      const dbt5Count = db.prepare('SELECT COUNT(*) as total FROM dbt005').get().total;
                      const dbt5Name = 'cow' + (dbt5Count + 1);
                      const dbt5Token = 'COW_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                      db.prepare(`INSERT INTO dbt005 (cow_name, cow_nickname, cow_token, collar_id, timestamp,
                        collar_state, user_token, registered_at, connected_at, last_seen)
                        VALUES (?,NULL,?,?,?,'connected',?,?,?,?)
                      `).run(dbt5Name, dbt5Token, mac, ts, emailUserToken, ts, ts, ts);
                      console.log(`[ESP32][MOVE] dbt004 → dbt005 (no history): ${dbt5Name} | MAC: ${mac}`);
                    }
                  }
                  // Resync total_cows — old owner was a farmer (dbt004), new owner may be dev or farmer
                  db.prepare('UPDATE dbt001 SET total_cows = (SELECT COUNT(*) FROM dbt004 WHERE user_token = ?) WHERE user_token = ?').run(macUserToken, macUserToken);
                  if (newOwnerIsDev) {
                    db.prepare('UPDATE dbt010 SET total_cows = (SELECT COUNT(*) FROM dbt006 WHERE user_token = ?) WHERE user_token = ?').run(emailUserToken, emailUserToken);
                  } else {
                    db.prepare('UPDATE dbt001 SET total_cows = (SELECT COUNT(*) FROM dbt004 WHERE user_token = ?) WHERE user_token = ?').run(emailUserToken, emailUserToken);
                  }
                })();
                resolvedUserToken = emailUserToken;
                console.log(`[ESP32][REASSIGN] dbt004 — MAC ${mac} reassigned → ${emailUserToken}`);
                notifyReassignedOwner(emailUserToken, mac, message.deviceId);
                socket.emit('esp32:cow_reassigned', { macAddress: mac, deviceId: message.deviceId, oldUserToken: macUserToken, newUserToken: emailUserToken, timestamp: Date.now() });
              } else {
                // Same owner or email not found — just connect
                resolvedUserToken = emailUserToken || macUserToken;
                db.prepare(`UPDATE dbt004 SET collar_state='connected', connected_at=?, last_seen=? WHERE collar_id=?`).run(ts, ts, mac);
                console.log(`[ESP32][CONNECT] dbt004 — MAC ${mac} | user_token: ${resolvedUserToken}`);
              }

            } else {
              const inDbt6 = db.prepare(`SELECT * FROM dbt006 WHERE collar_id = ? AND cow_type = 'esp32'`).get(mac);
              if (inDbt6) {
                const macUserToken = inDbt6.user_token;
                if (emailUserToken && emailUserToken !== macUserToken) {
                  // ── Reassign: dbt006 → correct table based on new owner type ──
                  db.transaction(() => {
                    archiveCowRecord(inDbt6, 'dbt006', 'reassignment');
                    const newOwnerIsFarmer = !db.prepare('SELECT user_token FROM dbt010 WHERE user_token = ?').get(emailUserToken);
                    const archived = db.prepare('SELECT * FROM dbt033 WHERE collar_id = ? AND original_user_token = ? ORDER BY archived_at DESC LIMIT 1').get(mac, emailUserToken);

                    if (newOwnerIsFarmer) {
                      db.prepare('DELETE FROM dbt006 WHERE collar_id = ?').run(mac);
                      if (archived) {
                        const cowCount = db.prepare('SELECT COUNT(*) as total FROM dbt004 WHERE user_token = ?').get(emailUserToken).total;
                        const newName = 'cow' + (cowCount + 1);
                        db.prepare(`INSERT INTO dbt004 (cow_name, cow_nickname, cow_token, collar_id, timestamp,
                          collar_state, user_token, farm_token, registered_at, connected_at, last_seen,
                          state_fence, time_inside, time_outside, total_breach,
                          actual_time_inside_fence, actual_time_outside_fence,
                          gps_latitude, gps_longitude,
                          alarm1_triggered, alarm2_triggered, alarm3_triggered,
                          alarm1_triggered_at, alarm2_triggered_at, alarm3_triggered_at,
                          current_breach_cycle, reg_number, zone_changed_at)
                          VALUES (?,?,?,?,?,'connected',?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                        `).run(
                          newName, archived.cow_nickname, archived.cow_token, mac, ts,
                          emailUserToken, ts, ts, ts,
                          archived.state_fence||'unknown', archived.time_inside||0, archived.time_outside||0, archived.total_breach||0,
                          archived.actual_time_inside_fence||0, archived.actual_time_outside_fence||0,
                          archived.gps_latitude, archived.gps_longitude,
                          archived.alarm1_triggered, archived.alarm2_triggered, archived.alarm3_triggered,
                          archived.alarm1_triggered_at, archived.alarm2_triggered_at, archived.alarm3_triggered_at,
                          archived.current_breach_cycle, archived.reg_number, archived.zone_changed_at
                        );
                        db.prepare('DELETE FROM dbt033 WHERE id=?').run(archived.id);
                        console.log(`[ESP32][RESTORE] dbt033 → dbt004 for ${emailUserToken} | MAC: ${mac}`);
                      } else {
                        // No prior history for this user — send to dbt005 for farm registration
                        const dbt5Count = db.prepare('SELECT COUNT(*) as total FROM dbt005').get().total;
                        const dbt5Name = 'cow' + (dbt5Count + 1);
                        const dbt5Token = 'COW_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                        db.prepare(`INSERT INTO dbt005 (cow_name, cow_nickname, cow_token, collar_id, timestamp,
                          collar_state, user_token, registered_at, connected_at, last_seen)
                          VALUES (?,NULL,?,?,?,'connected',?,?,?,?)
                        `).run(dbt5Name, dbt5Token, mac, ts, emailUserToken, ts, ts, ts);
                        console.log(`[ESP32][MOVE] dbt006 → dbt005 (no history): ${dbt5Name} | MAC: ${mac}`);
                      }
                    } else {
                      // Developer — stay in dbt006
                      if (archived) {
                        const cowCount = db.prepare('SELECT COUNT(*) as total FROM dbt006 WHERE user_token = ?').get(emailUserToken).total;
                        const newName = 'cow' + (cowCount + 1);
                        db.prepare(`UPDATE dbt006 SET
                          user_token=?, cow_name=?, cow_nickname=?, farm_token=NULL,
                          state_fence=?, time_inside=?, time_outside=?, total_breach=?,
                          actual_time_inside_fence=?, actual_time_outside_fence=?,
                          gps_latitude=?, gps_longitude=?,
                          collar_state='connected', connected_at=?, last_seen=?,
                          alarm1_triggered=?, alarm2_triggered=?, alarm3_triggered=?,
                          alarm1_triggered_at=?, alarm2_triggered_at=?, alarm3_triggered_at=?,
                          current_breach_cycle=?, reg_number=?, zone_changed_at=?
                          WHERE collar_id=?`).run(
                          emailUserToken, newName, archived.cow_nickname,
                          archived.state_fence, archived.time_inside||0, archived.time_outside||0, archived.total_breach||0,
                          archived.actual_time_inside_fence||0, archived.actual_time_outside_fence||0,
                          archived.gps_latitude, archived.gps_longitude, ts, ts,
                          archived.alarm1_triggered, archived.alarm2_triggered, archived.alarm3_triggered,
                          archived.alarm1_triggered_at, archived.alarm2_triggered_at, archived.alarm3_triggered_at,
                          archived.current_breach_cycle, archived.reg_number, archived.zone_changed_at,
                          mac
                        );
                        db.prepare('DELETE FROM dbt033 WHERE id=?').run(archived.id);
                        console.log(`[ESP32][RESTORE] dbt033 → dbt006 for ${emailUserToken} | MAC: ${mac}`);
                      } else {
                        // No prior history for this user — delete from dbt006, send to dbt005
                        db.prepare('DELETE FROM dbt006 WHERE collar_id = ?').run(mac);
                        const dbt5Count = db.prepare('SELECT COUNT(*) as total FROM dbt005').get().total;
                        const dbt5Name = 'cow' + (dbt5Count + 1);
                        const dbt5Token = 'COW_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                        db.prepare(`INSERT INTO dbt005 (cow_name, cow_nickname, cow_token, collar_id, timestamp,
                          collar_state, user_token, registered_at, connected_at, last_seen)
                          VALUES (?,NULL,?,?,?,'connected',?,?,?,?)
                        `).run(dbt5Name, dbt5Token, mac, ts, emailUserToken, ts, ts, ts);
                        console.log(`[ESP32][MOVE] dbt006 → dbt005 (no history): ${dbt5Name} | MAC: ${mac}`);
                      }
                    }
                    // Resync total_cows — old owner was a developer (dbt006), new owner may be farmer or dev
                    db.prepare('UPDATE dbt010 SET total_cows = (SELECT COUNT(*) FROM dbt006 WHERE user_token = ?) WHERE user_token = ?').run(macUserToken, macUserToken);
                    if (newOwnerIsFarmer) {
                      db.prepare('UPDATE dbt001 SET total_cows = (SELECT COUNT(*) FROM dbt004 WHERE user_token = ?) WHERE user_token = ?').run(emailUserToken, emailUserToken);
                    } else {
                      db.prepare('UPDATE dbt010 SET total_cows = (SELECT COUNT(*) FROM dbt006 WHERE user_token = ?) WHERE user_token = ?').run(emailUserToken, emailUserToken);
                    }
                  })();
                  resolvedUserToken = emailUserToken;
                  console.log(`[ESP32][REASSIGN] dbt006 — MAC ${mac} reassigned → ${emailUserToken}`);
                  notifyReassignedOwner(emailUserToken, mac, message.deviceId);
                  socket.emit('esp32:cow_reassigned', { macAddress: mac, deviceId: message.deviceId, oldUserToken: macUserToken, newUserToken: emailUserToken, timestamp: Date.now() });
                } else {
                  resolvedUserToken = emailUserToken || macUserToken;
                  db.prepare(`UPDATE dbt006 SET collar_state='connected', connected_at=?, last_seen=? WHERE collar_id=?`).run(ts, ts, mac);
                  console.log(`[ESP32][CONNECT] dbt006 — MAC ${mac} | user_token: ${resolvedUserToken}`);
                }

              } else {
                // dbt005 or brand new device
                const inDbt5 = db.prepare('SELECT user_token FROM dbt005 WHERE collar_id = ?').get(mac);
                if (inDbt5) {
                  const macUserToken = inDbt5.user_token;
                  if (emailUserToken && emailUserToken !== macUserToken) {
                    db.prepare(`UPDATE dbt005 SET user_token=?, collar_state='connected', connected_at=?, last_seen=? WHERE collar_id=?`).run(emailUserToken, ts, ts, mac);
                    resolvedUserToken = emailUserToken;
                    console.log(`[ESP32][REASSIGN] dbt005 — MAC ${mac} reassigned → ${emailUserToken}`);
                    notifyReassignedOwner(emailUserToken, mac, message.deviceId);
                    socket.emit('esp32:cow_reassigned', { macAddress: mac, deviceId: message.deviceId, oldUserToken: macUserToken, newUserToken: emailUserToken, timestamp: Date.now() });
                  } else {
                    resolvedUserToken = emailUserToken || macUserToken;
                    db.prepare(`UPDATE dbt005 SET collar_state='connected', connected_at=?, last_seen=? WHERE collar_id=?`).run(ts, ts, mac);
                    console.log(`[ESP32][CONNECT] dbt005 — MAC ${mac} | user_token: ${resolvedUserToken}`);
                  }
                } else {
                  // Brand new device
                  resolvedUserToken = emailUserToken;
                  if (!resolvedUserToken) console.warn(`[ESP32][!] codeEmail "${codeEmail}" not found in DB — device will be unowned in dbt005`);
                  const count    = db.prepare('SELECT COUNT(*) as total FROM dbt005').get();
                  const cowName  = 'cow' + (count.total + 1);
                  const cowToken = 'COW_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                  db.prepare(`INSERT INTO dbt005 (cow_name, cow_nickname, cow_token, collar_id, timestamp, collar_state, user_token, registered_at, connected_at, last_seen) VALUES (?,?,?,?,?,'connected',?,?,?,?)`)
                    .run(cowName, null, cowToken, mac, ts, resolvedUserToken, ts, ts, ts);
                  console.log(`[ESP32][NEW] dbt005 insert: ${cowName} | MAC: ${mac} | user_token: ${resolvedUserToken}`);
                  if (resolvedUserToken) {
                    try {
                      let userEmail = null, userName = null;
                      const fr2 = db.prepare('SELECT user_id AS email, farmer_name AS name FROM dbt001 WHERE user_token = ?').get(resolvedUserToken);
                      if (fr2) { userEmail = fr2.email; userName = fr2.name; }
                      else {
                        const dr2 = db.prepare('SELECT email, developer_name AS name FROM dbt010 WHERE user_token = ?').get(resolvedUserToken);
                        if (dr2) { userEmail = dr2.email; userName = dr2.name; }
                      }
                      if (userEmail) {
                        sendESP32ConnectedEmail(userEmail, userName, message.deviceId, mac).catch(() => {});
                        notifyESP32Connected(resolvedUserToken, mac, message.deviceId);
                      }
                    } catch (notifErr) {
                      console.error('[ESP32] msg8 notification error:', notifErr.message);
                    }
                  }
                }
              }
            }

            // After reassignment: update email1 to codeEmail, clear email2
            responseEmail1 = codeEmail || email1;
            responseEmail2 = '';
          }

          // ── Fetch alarm settings from user_parameter (dbt001 or dbt010) ──
          if (resolvedUserToken) {
            let userRow = db.prepare('SELECT user_parameter FROM dbt001 WHERE user_token = ?').get(resolvedUserToken);
            if (!userRow) userRow = db.prepare('SELECT user_parameter FROM dbt010 WHERE user_token = ?').get(resolvedUserToken);
            if (userRow?.user_parameter) {
              try {
                const prefs = JSON.parse(userRow.user_parameter);
                alarmConfig = {
                  alarm1TriggerTime:                  prefs.alarm1TriggerTime                  ?? 10,
                  alarm1AudioDuration:                prefs.alarm1AudioDuration                ?? 20,
                  alarm2MomentOfActivation:           prefs.alarm2MomentOfActivation           ?? 25,
                  alarm3DistanceOfActivation:         prefs.alarm3DistanceOfActivation         ?? 1.0,
                  exo_section1_led1_enabled:          prefs.exo_section1_led1_enabled          ?? true,
                  exo_section2_led2led3_enabled:      prefs.exo_section2_led2led3_enabled      ?? true,
                  exo_section2_led2led3_parameter:    prefs.exo_section2_led2led3_parameter    ?? 15,
                  exo_section3_led4_enabled:          prefs.exo_section3_led4_enabled          ?? true,
                  exo_section3_led4_parameter:        prefs.exo_section3_led4_parameter        ?? 25,
                  exo_section4_led5_enabled:          prefs.exo_section4_led5_enabled          ?? true,
                  exo_section4_led5_parameter:        prefs.exo_section4_led5_parameter        ?? 15,
                  exo_section5_led6led7led8_enabled:  prefs.exo_section5_led6led7led8_enabled  ?? true
                };
              } catch (_) {}
            }
          }
        } catch (dbErr) {
          console.error('[ESP32] DB registration error:', dbErr.message);
        }

        // Store resolved user token in deviceInfo for later lookups (e.g. config reset)
        if (deviceInfo) deviceInfo.userToken = resolvedUserToken;
        // ─────────────────────────────────────────────────────────────────

        // Determine account type: developer if token is in dbt010, else farmer
        let accountType = 'farmer';
        if (resolvedUserToken) {
          const devCheck = db.prepare('SELECT user_token FROM dbt010 WHERE user_token = ?').get(resolvedUserToken);
          if (devCheck) accountType = 'developer';
        }

        // register_ack — include email1/email2/accountType so ESP32 can update NVS
        ws.send(JSON.stringify({
          type: 'register_ack',
          status: 'success',
          deviceId: deviceId,
          email1: responseEmail1,    // ESP32 saves to NVS key "email1"
          email2: responseEmail2,    // ESP32 saves to NVS key "email2"
          accountType: accountType,  // feature flag for ESP32 (GPS accuracy etc.)
          serverTime: Date.now()
        }));

        if (alarmConfig) {
          ws.send(JSON.stringify({ type: 'config_update', config: alarmConfig, timestamp: Date.now() }));
          console.log(`[ESP32] ✓ Sent config_update to ${deviceId}:`, alarmConfig);
        }

        // Also notify main server for broadcasting / active-connection tracking
        socket.emit('esp32:register', {
          deviceId: message.deviceId,
          macAddress: message.macAddress,
          ipAddress: message.ipAddress,
          codeEmail: message.codeEmail,
          timestamp: Date.now()
        });
      }

      // Handle GPS data
      else if (message.type === 'gps_data') {
        const src = message.positionSource || 'gps';
        console.log(`[ESP32] ${deviceId || 'Unknown'} - GPS: ${message.latitude},${message.longitude} | Zone: ${message.currentZone} | Source: ${src}${message.accuracy != null ? ' | Acc: ' + Math.round(message.accuracy) + 'm' : ''}`);

        // Forward to main server via Socket.IO (include positionSource + accuracy for developer display)
        socket.emit('esp32:gps_update', {
          deviceId:       deviceId || message.deviceId,
          macAddress:     deviceInfo?.macAddress || mac,
          latitude:       message.latitude,
          longitude:      message.longitude,
          altitude:       message.altitude,
          speed:          message.speed,
          satellites:     message.satellites,
          currentZone:    message.currentZone,
          insideFence:    message.insideFence,
          positionSource: src,
          accuracy:       message.accuracy != null ? message.accuracy : null,
          timestamp:      message.timestamp
        });
      }

      // Handle alarm events
      else if (message.type === 'alarm') {
        console.log(`[ESP32] ${deviceId || 'Unknown'} - ALARM: ${message.alarmType} | ${message.message}`);

        // Forward alarm to main server
        socket.emit('esp32:alarm', {
          deviceId:   deviceId || message.deviceId,
          macAddress: deviceInfo?.macAddress || mac,
          alarmType: message.alarmType,
          alarmLevel: message.alarmLevel,
          message: message.message,
          latitude: message.latitude,
          longitude: message.longitude,
          timestamp: message.timestamp
        });
      }

      // Handle zone change
      else if (message.type === 'zone_change') {
        console.log(`[ESP32] ${deviceId || 'Unknown'} - Zone changed: ${message.oldZone} → ${message.newZone}`);

        // Forward to main server
        socket.emit('esp32:zone_change', {
          deviceId: deviceId || message.deviceId,
          oldZone: message.oldZone,
          newZone: message.newZone,
          latitude: message.latitude,
          longitude: message.longitude,
          timestamp: message.timestamp
        });
      }

      // Handle status update
      else if (message.type === 'status') {
        // Forward status to main server
        socket.emit('esp32:status', {
          deviceId: deviceId || message.deviceId,
          wifiRSSI: message.wifiRSSI,
          freeHeap: message.freeHeap,
          uptime: message.uptime,
          timestamp: message.timestamp
        });
      }

      // Handle heartbeat
      else if (message.type === 'heartbeat') {
        ws.send(JSON.stringify({
          type: 'heartbeat_ack',
          serverTime: Date.now()
        }));
      }

      // NEO6M GPS fix acquired — auto-disable virtual mode on the server/browser side
      else if (message.type === 'neo6m_fix_acquired') {
        console.log(`[ESP32] ${deviceId} — NEO6M fix acquired, auto-disabling virtual mode`);
        socket.emit('esp32:neo6m_fix_acquired', {
          deviceId:   deviceId || message.deviceId,
          macAddress: deviceInfo?.macAddress,
          timestamp:  Date.now()
        });
      }

      else if (message.type === 'neo6m_fix_lost') {
        console.log(`[ESP32] ${deviceId} — NEO6M fix lost`);
        socket.emit('esp32:neo6m_fix_lost', {
          deviceId:   deviceId || message.deviceId,
          macAddress: deviceInfo?.macAddress,
          timestamp:  Date.now()
        });
      }

    } catch (error) {
      console.error('[ESP32] Message parse error:', error.message);
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeatInterval);

    if (deviceId) {
      console.log(`[ESP32] Device disconnected: ${deviceId}`);
      connectedDevices.delete(deviceId);

      // Mark as disconnected directly in DB
      try {
        if (deviceInfo && deviceInfo.macAddress) {
          const mac = deviceInfo.macAddress;
          const updated4 = db.prepare(`UPDATE dbt004 SET collar_state = 'disconnected' WHERE collar_id = ?`).run(mac);
          if (updated4.changes === 0) {
            const updated6 = db.prepare(`UPDATE dbt006 SET collar_state = 'disconnected' WHERE collar_id = ?`).run(mac);
            if (updated6.changes === 0) {
              db.prepare(`UPDATE dbt005 SET collar_state = 'disconnected' WHERE collar_id = ?`).run(mac);
            }
          }
        }
      } catch (e) { console.error('[ESP32] DB disconnect update error:', e.message); }

      // Extract MAC address from deviceId (format: ESP32_MACADDRESS)
      const macAddress = deviceId.replace('ESP32_', '').match(/.{1,2}/g).join(':');

      // Notify main server
      socket.emit('esp32:disconnect', {
        deviceId: deviceId,
        macAddress: macAddress,
        timestamp: Date.now()
      });
    } else {
      console.log(`[ESP32] Unknown device disconnected from ${clientIp}`);
    }
  });

  ws.on('error', (error) => {
    console.error('[ESP32] WebSocket error:', error.message);
    clearInterval(heartbeatInterval); // Clean up heartbeat interval on error
  });
});

// Handle commands from main server to ESP32 devices
socket.on('command:fence_update', (data) => {
  console.log(`[Server] Fence update command for ${data.deviceId}`);

  const device = connectedDevices.get(data.deviceId);
  if (device && device.ws.readyState === WebSocket.OPEN) {
    device.ws.send(JSON.stringify({
      type: 'fence_update',
      fenceData: data.fenceData,
      timestamp: Date.now()
    }));
    console.log(`  → Sent to ESP32: ${data.deviceId}`);
  } else {
    console.log(`  ✗ Device not connected: ${data.deviceId}`);
  }
});

socket.on('command:config_update', (data) => {
  console.log(`[Server] Config update command for ${data.deviceId}`);

  const device = connectedDevices.get(data.deviceId);
  if (device && device.ws.readyState === WebSocket.OPEN) {
    device.ws.send(JSON.stringify({
      type: 'config_update',
      config: data.config,
      timestamp: Date.now()
    }));
    console.log(`  → Sent to ESP32: ${data.deviceId}`);
  }
});

socket.on('command:alarm', (data) => {
  console.log(`[Server] Alarm command for ${data.deviceId} — zone: ${data.zone}`);
  const device = connectedDevices.get(data.deviceId);
  if (device && device.ws.readyState === WebSocket.OPEN) {
    device.ws.send(JSON.stringify({
      type:      'alarm_command',
      zone:      data.zone,
      cowToken:  data.cowToken,
      timestamp: Date.now()
    }));
    console.log(`  → alarm_command sent to ESP32: ${data.deviceId} (zone: ${data.zone})`);
  } else {
    console.log(`  ✗ ESP32 not connected: ${data.deviceId}`);
  }
});

socket.on('command:virtual_mode', (data) => {
  console.log(`[Server] Virtual mode command for ${data.deviceId} — enabled: ${data.enabled}`);

  const device = connectedDevices.get(data.deviceId);
  if (device && device.ws.readyState === WebSocket.OPEN) {
    device.ws.send(JSON.stringify({
      type:      'virtual_mode',
      enabled:   data.enabled,
      latitude:  data.latitude  || 0,
      longitude: data.longitude || 0,
      zone:      data.zone      || 'zone1',
      timestamp: Date.now()
    }));
    console.log(`  → Virtual mode sent to ESP32: ${data.deviceId}`);
  } else {
    console.log(`  ✗ ESP32 not connected: ${data.deviceId}`);
  }
});

socket.on('command:offline_mode', (data) => {
  console.log(`[Server] Offline mode command for ${data.deviceId} — enabled: ${data.enabled}`);
  const device = connectedDevices.get(data.deviceId);
  if (device && device.ws.readyState === WebSocket.OPEN) {
    device.ws.send(JSON.stringify({
      type:      'offline_mode',
      enabled:   data.enabled,
      timestamp: Date.now()
    }));
    console.log(`  → offline_mode sent to ESP32: ${data.deviceId} (enabled: ${data.enabled})`);
  } else {
    console.log(`  ✗ ESP32 not connected: ${data.deviceId}`);
  }
});

// Status endpoint
setInterval(() => {
  const deviceCount = connectedDevices.size;
  if (deviceCount > 0) {
    console.log(`\n[Bridge] Active ESP32 devices: ${deviceCount}`);
    connectedDevices.forEach((device, id) => {
      console.log(`  - ${id} (${device.macAddress}) - Connected ${Math.floor((Date.now() - new Date(device.connectedAt).getTime()) / 1000)}s ago`);
    });
  }
}, 30000); // Every 30 seconds

// Error handling
wss.on('error', (error) => {
  console.error('WebSocket server error:', error);
});

process.on('SIGINT', () => {
  console.log('\nShutting down WebSocket bridge...');
  connectedDevices.forEach((device) => {
    if (device.ws.readyState === WebSocket.OPEN) {
      device.ws.close();
    }
  });
  wss.close();
  socket.disconnect();
  process.exit(0);
});

console.log('\n✓ WebSocket Bridge Server ready');
console.log('Waiting for ESP32 connections on port 8081...\n');

// Broadcast function to send messages to all connected WebSocket clients
function broadcastToWebSocketClients(message) {
  const messageStr = JSON.stringify(message);
  let sentCount = 0;

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
      sentCount++;
    }
  });

  if (sentCount > 0) {
    console.log(`📡 Broadcast to ${sentCount} WebSocket client(s):`, message.type);
  }
}

// Export for use by main server
module.exports = { wss, broadcastToWebSocketClients, connectedDevices };
