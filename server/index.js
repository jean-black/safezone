const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const { Server: SocketIOServer } = require('socket.io');
const path = require('path');
const fs = require('fs');
const https = require('https');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Import configuration and services
const { db, initializeDatabase } = require('./config/database');
const { initializeCronJobs } = require('./services/cronJobs');
const { notifyCowBreach, notifyESP32Offline, notifyESP32Connected } = require('./services/notificationService');
const { sendESP32OfflineEmail, sendNewCowRegisteredEmail } = require('./services/emailService');
const { now } = require('./utils/dateFormatter');
const { initializeAutonomousMonitoring } = require('./services/autonomousMonitoring');
// const { simulateCowMovement, createTestCows } = require('./services/cowSimulation');

// Import routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const farmsRoutes = require('./routes/farms');
const cowsRoutes = require('./routes/cows');
const recoveryRoutes = require('./routes/recovery');
const devVirtualRoutes = require('./routes/dev-virtual');
const alarmRoutes = require('./routes/alarms');
const settingsRoutes = require('./routes/settings');
const tryRoutes = require('./try');
const { transferDbt15ToDbt18 } = require('./try');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy
app.set('trust proxy', 1);

// Rate limiting — applied only to API routes, never to static files/CSS/JS
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50000,
  message: 'Too many requests from this IP',
  skip: (req) => !req.path.startsWith('/api/')
});

// Middleware
app.use(limiter);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://maps.googleapis.com", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "https:", "http:", "https://unpkg.com", "https://*.tile.openstreetmap.org", "https://*.basemaps.cartocdn.com"],
      connectSrc: ["'self'", "ws:", "wss:", "https:", "http:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      upgradeInsecureRequests: null  // disable — server runs HTTP locally
    }
  },
  hsts: false  // disable HSTS — server runs HTTP, not HTTPS
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api', dashboardRoutes); // For /api/notifications and /api/database/test
app.use('/api/farms', farmsRoutes); // Includes fence routes at /api/farms/fences
app.use('/api/cows', cowsRoutes);
app.use('/api/recovery', recoveryRoutes); // Collaborative recovery routes
app.use('/api/collaborative', cowsRoutes); // Collaborative routes are in cows.js
app.use('/api/esp32', cowsRoutes); // ESP32 routes are in cows.js
app.use('/api/dev', devVirtualRoutes); // Developer virtual cow routes
app.use('/api/alarms', alarmRoutes); // Alarm notification routes
app.use('/api/settings', settingsRoutes); // System settings routes (page26)
app.use('/api/try', tryRoutes); // Histogram test routes for page24
app.use('/api', cowsRoutes); // For /api/test-email

// Collaborative page route
app.get('/collaborative/:linkId', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/html', 'index.html'));
});

// Redirect root to login page
app.get('/', (req, res) => {
  res.redirect('/html/index.html');
});

// Initialize database
initializeDatabase();

// Initialize autonomous cow monitoring (24/7 email notifications)
initializeAutonomousMonitoring();

// Create test cows (disabled - keeping clean database)
// createTestCows();

// Start HTTP server
const server = app.listen(PORT, () => {
  console.log(`SafeZone HTTP  server → http://localhost:${PORT}`);
  console.log(`SafeZone HTTP  server → http://192.168.0.103:${PORT}  (ESP32 → ws://192.168.0.103:8081)`);
  console.log(`Database: modeblack.db (SQLite)`);
  console.log(`Server structure: Modularized`);

  // Transfer breach events from dbt015 → dbt018 every 10 seconds
  setInterval(() => { transferDbt15ToDbt18(); }, 10000);
  console.log('✓ Breach transfer started (dbt015 → dbt018 every 10s)');

  // Start ESP32 WebSocket bridge (port 8081) after HTTP server is up
  require('./websocket-bridge');
  console.log('✓ ESP32 WebSocket bridge started (port 8081)');
});

// Start HTTPS server (required for GPS/geolocation on mobile browsers)
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const certPath = path.join(__dirname, '../cert');
try {
  const httpsServer = https.createServer({
    key: fs.readFileSync(path.join(certPath, 'key.pem')),
    cert: fs.readFileSync(path.join(certPath, 'cert.pem'))
  }, app);
  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`SafeZone HTTPS server → https://192.168.0.103:${HTTPS_PORT}  ← use this URL on your phone for GPS`);
  });
} catch (e) {
  console.warn('HTTPS not started (cert missing):', e.message);
}

// WebSocket setup for web browsers
const wss = new WebSocket.Server({ server });

// Pass WebSocket server to dev-virtual routes for real-time broadcasting
devVirtualRoutes.setWebSocketServer(wss);

// ── Offline mode command endpoint (developer only) ──────────────────────────
// POST /api/dev/esp32-cows/:deviceId/offline-mode
// body: { enabled: bool }
app.post('/api/dev/esp32-cows/:deviceId/offline-mode', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const payload = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'safezone-secret-key');
    const isDev = db.prepare('SELECT user_token FROM dbt010 WHERE user_token = ?').get(payload.token || payload.developerId);
    if (!isDev) return res.status(403).json({ error: 'Developer access only' });

    const { deviceId } = req.params;
    const { enabled } = req.body;

    if (!bridgeSocket) return res.status(503).json({ error: 'ESP32 bridge not connected' });

    bridgeSocket.emit('command:offline_mode', {
      deviceId,           // already in 'ESP32_XXXXXX' format from frontend
      enabled: !!enabled,
      timestamp: Date.now()
    });

    console.log(`[Offline Mode] ${enabled ? 'OFFLINE' : 'ONLINE'} command sent to ${deviceId}`);
    res.json({ success: true, deviceId, enabled: !!enabled });
  } catch (err) {
    console.error('[Offline Mode API]', err.message);
    res.status(500).json({ error: 'Failed to send offline mode command' });
  }
});

// ── Virtual mode command endpoint (developer only) ───────────────────────────
// POST /api/dev/esp32-cows/:deviceId/virtual-mode
// body: { enabled: bool, latitude?, longitude?, zone? }
app.post('/api/dev/esp32-cows/:deviceId/virtual-mode', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const payload = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'safezone-secret-key');
    const isDev = db.prepare('SELECT user_token FROM dbt010 WHERE user_token = ?').get(payload.token || payload.developerId);
    if (!isDev) return res.status(403).json({ error: 'Developer access only' });

    const { deviceId } = req.params;
    const { enabled, latitude, longitude, zone } = req.body;

    if (!bridgeSocket) return res.status(503).json({ error: 'ESP32 bridge not connected' });

    bridgeSocket.emit('command:virtual_mode', {
      deviceId,
      enabled: !!enabled,
      latitude:  latitude  || 0,
      longitude: longitude || 0,
      zone:      zone      || 'zone1'
    });

    // Keep DB in sync with virtual mode state so page refresh shows correct GPS label.
    // On enable: mark source as 'virtual' immediately so a refreshed page shows "fake gps".
    // On disable: do NOT flip to 'gps' here — the NEO6M may not have a lock yet.
    //   The next real gps_data packet from the ESP32 will write 'gps' once it actually locks,
    //   so the stored position (last valid DB coords) is shown with "fake gps" label until then.
    try {
      const mac = deviceIdToMac(deviceId);
      if (mac) {
        const tbl = getEsp32CowTable(mac);
        if (enabled) {
          db.prepare(`UPDATE ${tbl} SET last_position_source = 'virtual' WHERE collar_id = ?`).run(mac);
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'neo6m_fix_lost', deviceId, macAddress: mac, timestamp: Date.now() }));
            }
          });
        }
        // When disabled: leave last_position_source as 'virtual' until ESP32 sends real GPS.
      }
    } catch (dbErr) {
      console.warn('[Virtual Mode API] DB sync failed:', dbErr.message);
    }

    res.json({ success: true, deviceId, enabled: !!enabled });
  } catch (err) {
    console.error('[Virtual Mode API]', err.message);
    res.status(500).json({ error: 'Failed to set virtual mode' });
  }
});

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(data));
        }
      });
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

// Periodic update for actual time tracking (every 10 seconds)
setInterval(() => {
  try {
    const currentTime = Date.now();

    // Update dbt006 (virtual cows)
    const virtualCows = db.prepare(`
      SELECT cow_token, cow_name, state_fence, zone_changed_at,
             time_inside, time_outside,
             actual_time_inside_fence, actual_time_outside_fence
      FROM dbt006
      WHERE zone_changed_at IS NOT NULL
    `).all();

    for (const cow of virtualCows) {
      if (!cow.zone_changed_at) continue;

      const zoneChangedTime = new Date(cow.zone_changed_at).getTime();
      const elapsedSeconds = Math.floor((currentTime - zoneChangedTime) / 1000);

      // Calculate new actual time based on current zone
      let newActualInside = cow.actual_time_inside_fence || 0;
      let newActualOutside = cow.actual_time_outside_fence || 0;

      if (cow.state_fence === 'zone1' || cow.state_fence === 'line1') {
        newActualInside = elapsedSeconds;
      } else if (cow.state_fence === 'zone2' || cow.state_fence === 'zone3') {
        newActualOutside = elapsedSeconds;
      }

      // Update database
      db.prepare(`
        UPDATE dbt006
        SET actual_time_inside_fence = ?,
            actual_time_outside_fence = ?
        WHERE cow_token = ?
      `).run(newActualInside, newActualOutside, cow.cow_token);
    }

    // Update dbt004 (real cows)
    const realCows = db.prepare(`
      SELECT cow_token, cow_name, state_fence, zone_changed_at,
             time_inside, time_outside,
             actual_time_inside_fence, actual_time_outside_fence
      FROM dbt004
      WHERE zone_changed_at IS NOT NULL
    `).all();

    for (const cow of realCows) {
      if (!cow.zone_changed_at) continue;

      const zoneChangedTime = new Date(cow.zone_changed_at).getTime();
      const elapsedSeconds = Math.floor((currentTime - zoneChangedTime) / 1000);

      // Calculate new actual time based on current zone
      let newActualInside = cow.actual_time_inside_fence || 0;
      let newActualOutside = cow.actual_time_outside_fence || 0;

      if (cow.state_fence === 'zone1' || cow.state_fence === 'line1') {
        newActualInside = elapsedSeconds;
      } else if (cow.state_fence === 'zone2' || cow.state_fence === 'zone3') {
        newActualOutside = elapsedSeconds;
      }

      // Update database
      db.prepare(`
        UPDATE dbt004
        SET actual_time_inside_fence = ?,
            actual_time_outside_fence = ?
        WHERE cow_token = ?
      `).run(newActualInside, newActualOutside, cow.cow_token);
    }
  } catch (error) {
    console.error('Error updating actual time:', error);
  }
}, 10000); // Run every 10 seconds

console.log('✓ Periodic actual time update started (every 10 seconds)');

// Socket.IO setup for ESP32 bridge
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

// Mark all collars as disconnected on server startup
// (since any previously connected devices lost connection when server stopped)
try {
  const r4 = db.prepare("UPDATE dbt004 SET collar_state = 'disconnected' WHERE collar_state = 'connected'").run();
  const r6 = db.prepare("UPDATE dbt006 SET collar_state = 'disconnected' WHERE collar_state = 'connected' AND cow_type = 'esp32'").run();
  const total = r4.changes + r6.changes;
  if (total > 0) console.log(`✓ Marked ${total} collar(s) as disconnected on startup`);
} catch (error) {
  console.error('Error marking collars as disconnected:', error);
}

// Track active ESP32 connections in memory
const activeESP32Connections = new Map(); // Map<deviceId, { socketId, lastSeen }>

// Returns 'dbt004' (farmer) or 'dbt006' (developer) depending on where the collar is registered
function getEsp32CowTable(collarId) {
  if (!collarId) return 'dbt004';
  const inDbt6 = db.prepare("SELECT collar_id FROM dbt006 WHERE collar_id = ? AND cow_type = 'esp32'").get(collarId);
  return inDbt6 ? 'dbt006' : 'dbt004';
}

// Convert ESP32 deviceId (ESP32_XXXXXXXXXXXX) to MAC address (XX:XX:XX:XX:XX:XX)
function deviceIdToMac(deviceId) {
  if (!deviceId) return null;
  const hex = deviceId.replace(/^ESP32_/i, '');
  return hex.match(/.{1,2}/g).join(':').toUpperCase();
}

// Send offline alert (gmail + in-app) to the owner of a disconnected collar
async function triggerOfflineAlert(macAddress, cowTable) {
  try {
    const cowRow = db.prepare(`SELECT user_token, cow_token, cow_name FROM ${cowTable} WHERE collar_id = ?`).get(macAddress);
    if (!cowRow) return;

    const isDevTable = cowTable === 'dbt006';
    const userTable  = isDevTable ? 'dbt010' : 'dbt001';
    const emailCol   = isDevTable ? 'email'   : 'user_id';
    const nameCol    = isDevTable ? 'developer_name' : 'farmer_name';

    const userRow = db.prepare(`SELECT ${emailCol}, ${nameCol}, user_parameter FROM ${userTable} WHERE user_token = ?`).get(cowRow.user_token);
    if (!userRow) return;

    const prefs = userRow.user_parameter ? JSON.parse(userRow.user_parameter) : {};
    if (prefs.offlineAlertEnabled === false) return; // default is true if key absent

    const email    = userRow[emailCol];
    const userName = userRow[nameCol];
    const cowName  = cowRow.cow_name || cowRow.cow_token;

    notifyESP32Offline(cowRow.user_token, cowRow.cow_token, cowName, macAddress);

    if (prefs.gmailAlertsEnabled !== false) {
      await sendESP32OfflineEmail(email, userName, cowName, macAddress).catch(err =>
        console.error('[Offline Alert] Gmail send failed:', err.message)
      );
    }
    console.log(`[Offline Alert] Sent for cow "${cowName}" (${macAddress}) to ${email}`);
  } catch (err) {
    console.error('[Offline Alert Error]', err);
  }
}

// Reference to the websocket-bridge Socket.IO connection
let bridgeSocket = null;

io.on('connection', (socket) => {
  console.log('\n🔌 [Socket.IO] NEW CLIENT CONNECTED');
  console.log('   Socket ID:', socket.id);
  console.log('   Time:', now());

  // Handle ESP32 device registration
  socket.on('esp32:register', (data) => {
    bridgeSocket = socket; // store bridge reference for API route use
    devVirtualRoutes.setBridgeSocket(socket); // give dev-virtual access for command:alarm
    authRoutes.setBridgeSocket(socket);        // give auth preferences access for live config push
    console.log('[ESP32 Register]', data.deviceId);

    try {
      // Add to active connections map
      const currentTime = now();
      activeESP32Connections.set(data.macAddress, {
        socketId: socket.id,
        lastSeen: currentTime,
        deviceId: data.deviceId
      });
      console.log('[ESP32] Added to active connections:', data.macAddress);

      // Check dbt004 and dbt006 (developer ESP32 cows live in dbt006)
      const cowTable = getEsp32CowTable(data.macAddress);
      const existingInDbt4 = db.prepare(`SELECT * FROM ${cowTable} WHERE collar_id = ?`).get(data.macAddress);

      if (existingInDbt4) {
        // Cow already registered and assigned - update connection state + notify owner
        console.log(`[ESP32] Cow already exists in ${cowTable}:`, existingInDbt4.cow_name);

        const currentTime = now();
        db.prepare(`UPDATE ${cowTable} SET collar_state = 'connected', connected_at = ?, last_seen = ? WHERE collar_id = ?`)
          .run(currentTime, currentTime, data.macAddress);
        console.log('[ESP32] ✓ Updated collar_state to CONNECTED for', data.macAddress);

        // msg8 — in-app + Gmail: send ONCE on first ownership confirmation, never on reconnects
        if (existingInDbt4.user_token && !existingInDbt4.registration_notified) {
          try {
            notifyESP32Connected(existingInDbt4.user_token, data.macAddress, data.deviceId);
            const isDev = cowTable === 'dbt006';
            const userRow = isDev
              ? db.prepare('SELECT email, developer_name AS name, user_parameter FROM dbt010 WHERE user_token = ?').get(existingInDbt4.user_token)
              : db.prepare('SELECT user_id AS email, farmer_name AS name, user_parameter FROM dbt001 WHERE user_token = ?').get(existingInDbt4.user_token);
            if (userRow?.email) {
              const prefs = userRow.user_parameter ? JSON.parse(userRow.user_parameter) : {};
              if (prefs.gmailAlertsEnabled !== false) {
                sendNewCowRegisteredEmail(userRow.email, userRow.name, existingInDbt4.cow_name, data.macAddress, 'esp32')
                  .catch(err => console.error('[msg8] Connect Gmail failed:', err.message));
              }
            }
            // Mark notified so subsequent reconnects are silent
            db.prepare(`UPDATE ${cowTable} SET registration_notified = 1 WHERE collar_id = ?`).run(data.macAddress);
          } catch (notifErr) {
            console.error('[msg8] Connect notify error:', notifErr.message);
          }
        }
      } else {
        // Not in dbt4, check if in dbt5
        const existingInDbt5 = db.prepare('SELECT * FROM dbt005 WHERE collar_id = ?').get(data.macAddress);

        if (!existingInDbt5) {
          // New cow - create entry in dbt5
          const count = db.prepare('SELECT COUNT(*) as total FROM dbt005').get();
          const cowName = 'cow' + (count.total + 1);

          const stmt = db.prepare(`
            INSERT INTO dbt005 (
              cow_name, cow_nickname, collar_id, cow_token, timestamp
            ) VALUES (?, ?, ?, ?, ?)
          `);

          const cowToken = 'COW_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
          const timestamp = now();

          // Look up user_token from codeEmail — check farmer (dbt001) and developer (dbt010)
          const farmerRow = db.prepare('SELECT user_token FROM dbt001 WHERE user_id = ?').get(data.codeEmail)
                         || db.prepare('SELECT user_token FROM dbt010 WHERE email = ?').get(data.codeEmail);
          const farmerUserToken = farmerRow ? farmerRow.user_token : null;

          stmt.run(
            cowName,              // cow_name (e.g., "cow1", "cow2")
            null,                 // cow_nickname (NULL - not set yet)
            data.macAddress,      // collar_id (MAC address)
            cowToken,             // cow_token
            timestamp             // timestamp
          );

          // Store user_token association
          if (farmerUserToken) {
            db.prepare('UPDATE dbt005 SET user_token = ? WHERE collar_id = ?').run(farmerUserToken, data.macAddress);
          }

          console.log('[ESP32] New cow created in dbt5:', cowName, '(MAC:', data.macAddress + ') user_token:', farmerUserToken);
        } else {
          console.log('[ESP32] Cow already exists in dbt5:', existingInDbt5.cow_name);
        }
      }

      // Send alarm settings to the ESP32 from user_parameter (dbt001 or dbt010)
      try {
        let userRow = db.prepare('SELECT user_parameter, user_token FROM dbt001 WHERE user_id = ?').get(data.codeEmail);
        if (!userRow) userRow = db.prepare('SELECT user_parameter, user_token FROM dbt010 WHERE email = ?').get(data.codeEmail);
        if (userRow?.user_parameter) {
          const prefs = JSON.parse(userRow.user_parameter);
          const config = {
            alarm1TriggerTime:                    prefs.alarm1TriggerTime                    ?? 10,
            alarm1AudioDuration:                  prefs.alarm1AudioDuration                  ?? 20,
            alarm2MomentOfActivation:             prefs.alarm2MomentOfActivation             ?? 25,
            alarm3DistanceOfActivation:           prefs.alarm3DistanceOfActivation           ?? 1.0,
            exo_section1_led1_enabled:            prefs.exo_section1_led1_enabled            ?? true,
            exo_section2_led2led3_enabled:        prefs.exo_section2_led2led3_enabled        ?? true,
            exo_section2_led2led3_parameter:      prefs.exo_section2_led2led3_parameter      ?? 15,
            exo_section3_led4_enabled:            prefs.exo_section3_led4_enabled            ?? true,
            exo_section3_led4_parameter:          prefs.exo_section3_led4_parameter          ?? 25,
            exo_section4_led5_enabled:            prefs.exo_section4_led5_enabled            ?? true,
            exo_section4_led5_parameter:          prefs.exo_section4_led5_parameter          ?? 15,
            exo_section5_led6led7led8_enabled:    prefs.exo_section5_led6led7led8_enabled    ?? true
          };
          socket.emit('command:config_update', { deviceId: data.deviceId, config });
          console.log('[ESP32] ✓ Sent config_update to', data.deviceId, config);
        } else {
          console.log('[ESP32] No alarm settings in user_parameter for', data.codeEmail, '- using ESP32 defaults');
        }
      } catch (cfgErr) {
        console.error('[ESP32 Config Send Error]', cfgErr.message);
      }

    } catch (error) {
      console.error('[ESP32 Register Error]', error);
    }
  });

  // Handle GPS data updates
  socket.on('esp32:gps_update', (data) => {
    console.log('[ESP32 GPS]', data.deviceId, '- Lat:', data.latitude, 'Lng:', data.longitude);

    // Reject 0,0 — NEO6M sends this before it has a real fix; treat as no data
    const isValidCoord = data.latitude != null && data.longitude != null &&
                         !(data.latitude === 0 && data.longitude === 0);

    try {
      const mac = data.macAddress || deviceIdToMac(data.deviceId);
      const gpsCowTable = getEsp32CowTable(mac);

      if (isValidCoord) {
        // Check whether the virtual controller is currently the active source.
        // Only treat as virtual-active when:
        //   1. table is dbt006 (developer ESP32 cow — dbt004 has no virtual columns)
        //   2. last_position_source = 'virtual'
        //   3. virtual_latitude is non-null/non-zero (user actually moved the controller)
        // If all three hold: silently preserve real GPS in gps_latitude/gps_longitude
        // WITHOUT changing last_position_source or broadcasting — page refresh keeps
        // showing the virtual position until the user explicitly stops the controller.
        let currentlyVirtual = false;
        if (gpsCowTable === 'dbt006') {
          const sourceRow = db.prepare(`SELECT last_position_source, virtual_latitude FROM dbt006 WHERE collar_id = ?`).get(mac);
          currentlyVirtual = sourceRow?.last_position_source === 'virtual' &&
                             sourceRow?.virtual_latitude != null &&
                             sourceRow?.virtual_latitude !== 0;
        }

        if (currentlyVirtual) {
          db.prepare(`UPDATE dbt006 SET gps_latitude = ?, gps_longitude = ? WHERE collar_id = ?`)
            .run(data.latitude, data.longitude, mac);
          console.log('[ESP32 GPS] Virtual mode active — real GPS stored silently, no broadcast');
        } else {
          // dbt004 (farmer cows) has no last_position_source column — only set it for dbt006
          if (gpsCowTable === 'dbt006') {
            db.prepare(`UPDATE dbt006 SET gps_latitude = ?, gps_longitude = ?, timestamp = ?, last_position_source = 'gps' WHERE collar_id = ?`)
              .run(data.latitude, data.longitude, now(), mac);
          } else {
            db.prepare(`UPDATE dbt004 SET gps_latitude = ?, gps_longitude = ?, timestamp = ? WHERE collar_id = ?`)
              .run(data.latitude, data.longitude, now(), mac);
          }

          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type:           'gps_update',
                deviceId:       data.deviceId,
                latitude:       data.latitude,
                longitude:      data.longitude,
                currentZone:    data.currentZone,
                insideFence:    data.insideFence,
                positionSource: data.positionSource || 'gps',
                accuracy:       data.accuracy != null ? data.accuracy : null
              }));
            }
          });
        }
      } else {
        console.log('[ESP32 GPS] Ignoring 0,0 coordinates from', data.deviceId);
      }
    } catch (error) {
      console.error('[ESP32 GPS Error]', error);
    }
  });

  // Handle zone change events
  socket.on('esp32:zone_change', (data) => {
    console.log('[ESP32 Zone Change]', data.deviceId, '-', data.oldZone, '→', data.newZone);

    // Broadcast to WebSocket clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'zone_change',
          deviceId: data.deviceId,
          oldZone: data.oldZone,
          newZone: data.newZone
        }));
      }
    });
  });

  // Handle alarm events
  socket.on('esp32:alarm', (data) => {
    console.log('[ESP32 Alarm]', data.deviceId, '-', data.alarmType, 'Level:', data.alarmLevel);

    try {
      const alarmMac = data.macAddress || deviceIdToMac(data.deviceId);
      const alarmCowTable = getEsp32CowTable(alarmMac);
      // Update breach count and state
      if (data.alarmType === 'breach' || data.alarmType.startsWith('level')) {
        db.prepare(`UPDATE ${alarmCowTable} SET state_fence = 'outside', total_breach = total_breach + 1 WHERE collar_id = ?`)
          .run(alarmMac);

        // Record in dbt015 so the histogram pipeline picks it up (skip if no farm assigned)
        const cow15 = db.prepare(`SELECT user_token, farm_token FROM ${alarmCowTable} WHERE collar_id = ?`).get(alarmMac);
        if (cow15?.user_token && cow15?.farm_token) {
          try {
            db.prepare('INSERT INTO dbt015 (user_token, farm_token, minute_timestamp, breach_count_minute) VALUES (?, ?, datetime("now"), 1)')
              .run(cow15.user_token, cow15.farm_token);
            console.log('[ESP32 Alarm] Breach recorded in dbt015 for user', cow15.user_token);
          } catch (_) {}
        }

        // Send notification for level 2 breaches
        if (data.alarmLevel === 2 || data.alarmType === 'level2') {
          const cow = db.prepare(`
            SELECT c.cow_name, c.cow_nickname, c.cow_token, c.user_token, c.reg_number,
              ROW_NUMBER() OVER (PARTITION BY c.user_token ORDER BY c.reg_number) AS queue_pos
            FROM ${alarmCowTable} c WHERE c.collar_id = ?
          `).get(alarmMac);
          if (cow) {
            const suffix = alarmCowTable === 'dbt006' ? '_E' : '';
            const cowDisplayName = cow.reg_number
              ? `cow${cow.reg_number}_${cow.queue_pos}${suffix}`
              : (cow.cow_name || cow.cow_nickname);
            const location = data.latitude && data.longitude ? `${data.latitude}, ${data.longitude}` : 'Unknown location';
            notifyCowBreach(cow.user_token, cow.cow_token, cowDisplayName, location);
          }
        }
      } else if (data.alarmType === 'return') {
        db.prepare(`UPDATE ${alarmCowTable} SET state_fence = 'inside' WHERE collar_id = ?`).run(alarmMac);
      }

      // Broadcast alarm to WebSocket clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'alarm',
            deviceId: data.deviceId,
            alarmType: data.alarmType,
            alarmLevel: data.alarmLevel,
            message: data.message
          }));
        }
      });
    } catch (error) {
      console.error('[ESP32 Alarm Error]', error);
    }
  });

  // Handle ESP32 disconnect from WebSocket bridge
  socket.on('esp32:disconnect', (data) => {
    console.log('[ESP32] ✗ Disconnect event received:', data.deviceId);

    try {
      // Remove from active connections
      if (activeESP32Connections.has(data.macAddress)) {
        activeESP32Connections.delete(data.macAddress);
        console.log('[ESP32] Removed from active connections:', data.macAddress);
      }

      // Update database to mark as disconnected; also clear virtual offline state (dbt006 only)
      const currentTime = now();
      const dcTable = getEsp32CowTable(data.macAddress);
      if (dcTable === 'dbt006') {
        db.prepare(`UPDATE dbt006 SET collar_state = 'disconnected', last_seen = ?, offline_mode_active = 0 WHERE collar_id = ?`)
          .run(currentTime, data.macAddress);
      } else {
        db.prepare(`UPDATE dbt004 SET collar_state = 'disconnected', last_seen = ? WHERE collar_id = ?`)
          .run(currentTime, data.macAddress);
      }
      console.log('[ESP32] ✓ Updated collar_state to DISCONNECTED for', data.macAddress);

      // Send offline alert (gmail + in-app) if the owner has enabled it
      triggerOfflineAlert(data.macAddress, dcTable);

      // Broadcast to all browser WebSocket clients so page19 can react
      let broadcastCount = 0;
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type:       'esp32_disconnect',
            deviceId:   data.deviceId,
            macAddress: data.macAddress,
            timestamp:  Date.now()
          }));
          broadcastCount++;
        }
      });
      console.log(`[ESP32] esp32_disconnect broadcast to ${broadcastCount} browser client(s) — deviceId: ${data.deviceId}`);
    } catch (error) {
      console.error('[ESP32 Disconnect Error]', error);
    }
  });

  // NEO6M fix lost — broadcast to clients so UI can react; do NOT change last_position_source.
  // The virtual controller sets last_position_source='virtual'; losing GPS fix does not mean
  // the virtual controller is active. Keeping source='gps' here means the page still shows
  // the last known real position on refresh, and gps_update broadcasts resume naturally once
  // the fix is reacquired (no intervention needed).
  socket.on('esp32:neo6m_fix_lost', (data) => {
    console.log('[ESP32] NEO6M fix lost:', data.deviceId);

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type:       'neo6m_fix_lost',
          deviceId:   data.deviceId,
          macAddress: data.macAddress,
          timestamp:  Date.now()
        }));
      }
    });
  });

  // NEO6M fix acquired — tell browser to deselect the cow from the virtual controller
  socket.on('esp32:neo6m_fix_acquired', (data) => {
    console.log('[ESP32] NEO6M fix acquired:', data.deviceId);

    // Server-side: tell the ESP32 to exit virtual mode so it starts sending real GPS
    if (bridgeSocket) {
      bridgeSocket.emit('command:virtual_mode', {
        deviceId:  data.deviceId,
        enabled:   false,
        latitude:  0,
        longitude: 0,
        zone:      'zone1'
      });
      console.log('[ESP32] Auto-disabled virtual mode for', data.deviceId, 'on NEO6M fix');
    }

    // Mark DB source as 'gps' now — this is the authoritative switch from virtual → real.
    // The gps_update handler is silent while source='virtual', so we must flip it here.
    // A 0,0 packet may still arrive first but that is rejected; the next valid gps_update
    // will then broadcast normally because source is already 'gps'.
    try {
      const fixMac = deviceIdToMac(data.deviceId);
      if (fixMac) {
        const fixTbl = getEsp32CowTable(fixMac);
        db.prepare(`UPDATE ${fixTbl} SET last_position_source = 'gps' WHERE collar_id = ?`).run(fixMac);
        console.log('[ESP32] last_position_source → gps for', fixMac);
      }
    } catch (e) { console.warn('[NEO6M fix acquired] DB update failed:', e.message); }

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type:       'neo6m_fix_acquired',
          deviceId:   data.deviceId,
          macAddress: data.macAddress,
          timestamp:  Date.now()
        }));
      }
    });
  });

  // Broadcast cow reassignment to all browser clients so their UI refreshes immediately
  socket.on('esp32:cow_reassigned', (data) => {
    console.log(`[ESP32] Cow reassigned: ${data.macAddress} from ${data.oldUserToken} → ${data.newUserToken}`);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type:         'cow_reassigned',
          macAddress:   data.macAddress,
          deviceId:     data.deviceId,
          oldUserToken: data.oldUserToken,
          newUserToken: data.newUserToken,
          timestamp:    data.timestamp
        }));
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('Socket.IO client disconnected:', socket.id);

    // Find and remove ESP32 from active connections
    for (const [macAddress, connection] of activeESP32Connections.entries()) {
      if (connection.socketId === socket.id) {
        console.log('[ESP32] ✗ Connection lost:', macAddress);
        activeESP32Connections.delete(macAddress);

        // Update database to mark as disconnected; also clear virtual offline state (dbt006 only)
        try {
          const currentTime = now();
          const lostTable = getEsp32CowTable(macAddress);
          if (lostTable === 'dbt006') {
            db.prepare(`UPDATE dbt006 SET collar_state = 'disconnected', last_seen = ?, offline_mode_active = 0 WHERE collar_id = ?`)
              .run(currentTime, macAddress);
          } else {
            db.prepare(`UPDATE dbt004 SET collar_state = 'disconnected', last_seen = ? WHERE collar_id = ?`)
              .run(currentTime, macAddress);
          }
          console.log('[ESP32] ✓ Updated collar_state to DISCONNECTED for', macAddress);

          // Send offline alert (gmail + in-app) if the owner has enabled it
          triggerOfflineAlert(macAddress, lostTable);
        } catch (error) {
          console.error('[ESP32 Disconnect Error]', error);
        }

        // Broadcast to browser clients
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type:       'esp32_disconnect',
              deviceId:   connection.deviceId,
              macAddress: macAddress,
              timestamp:  Date.now()
            }));
          }
        });
        break;
      }
    }
  });

  // ============================================
  // RECOVERY COLLABORATIVE WEBSOCKET EVENTS
  // ============================================

  // Join recovery room
  socket.on('join-recovery', (data) => {
    const { recoveryId } = data;
    console.log('\n📥 [Recovery] JOIN RECOVERY ROOM');
    console.log('   Recovery ID:', recoveryId);
    console.log('   Socket ID:', socket.id);
    socket.join(`recovery:${recoveryId}`);
    console.log('   ✅ Joined room: recovery:' + recoveryId);
  });

  // Agent position update
  socket.on('recovery:agent-position', (data) => {
    const { recoveryId, latitude, longitude } = data;
    console.log('[Recovery] Agent position update:', recoveryId, latitude, longitude);

    // Broadcast to all clients in this recovery room (except sender)
    socket.to(`recovery:${recoveryId}`).emit('recovery:agent-position-update', {
      recoveryId,
      latitude,
      longitude
    });
  });

  // Cow position update (when cow moves)
  socket.on('recovery:cow-position', (data) => {
    const { recoveryId, cowToken, latitude, longitude, zone } = data;

    console.log('\n========================================');
    console.log('📡 [Recovery] COW POSITION UPDATE RECEIVED');
    console.log('========================================');
    console.log('Recovery ID:', recoveryId);
    console.log('Cow Token:', cowToken);
    console.log('Position:', `(${latitude}, ${longitude})`);
    console.log('Zone:', zone);
    console.log('Timestamp:', now());

    // Determine which table to update based on recovery type
    // Check dbt011 (virtual recoveries) first
    console.log('\n🔍 [Recovery] Checking recovery type...');
    const virtualRecovery = db.prepare('SELECT recovery_id FROM dbt011 WHERE recovery_id = ?').get(recoveryId);
    const cowTable = virtualRecovery ? 'dbt006' : 'dbt004';

    console.log(`✓ Recovery type: ${virtualRecovery ? 'VIRTUAL' : 'PHYSICAL'}`);
    console.log(`✓ Target table: ${cowTable}`);

    // Check if cow exists before updating
    const cowExists = db.prepare(`SELECT cow_token, cow_name, state_fence, zone_changed_at, time_inside, time_outside, actual_time_inside_fence, actual_time_outside_fence, total_breach, user_token, farm_token, alarm1_triggered, alarm2_triggered, alarm3_triggered, alarm1_triggered_at, alarm2_triggered_at, alarm3_triggered_at FROM ${cowTable} WHERE cow_token = ?`).get(cowToken);
    if (cowExists) {
      console.log(`✓ Cow found in ${cowTable}:`, cowExists.cow_name);
      console.log(`  Current zone: ${cowExists.state_fence}`);
      console.log(`  New zone: ${zone}`);
    } else {
      console.error(`❌ ERROR: Cow ${cowToken} NOT FOUND in ${cowTable}!`);
    }

    // Check if zone changed and calculate time updates
    let cumulativeTimeInside = cowExists?.time_inside || 0;
    let cumulativeTimeOutside = cowExists?.time_outside || 0;
    let actualTimeInside = cowExists?.actual_time_inside_fence || 0;
    let actualTimeOutside = cowExists?.actual_time_outside_fence || 0;
    let totalBreach = cowExists?.total_breach || 0;
    const oldZone = cowExists?.state_fence;
    const zoneChanged = oldZone && oldZone !== zone;

    if (zoneChanged) {
      console.log(`\n🔄 Zone transition detected: ${oldZone} → ${zone}`);

      // Calculate elapsed time since last zone change
      if (cowExists.zone_changed_at) {
        const lastChangeTime = new Date(cowExists.zone_changed_at);
        const currentTime = new Date();
        const elapsedSeconds = Math.floor((currentTime - lastChangeTime) / 1000);
        console.log(`  Time in previous zone: ${elapsedSeconds} seconds`);

        // Add elapsed time — line1 counts as inside
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
      if (zone === 'zone1' || zone === 'line1') {
        actualTimeOutside = 0;
        console.log(`  🔄 Reset actual_time_outside_fence to 0 (now inside)`);
      } else if (zone === 'zone2' || zone === 'zone3') {
        actualTimeInside = 0;
        console.log(`  🔄 Reset actual_time_inside_fence to 0 (now outside)`);
      }

      // Breach: cow exited fence from zone1 or line1
      if ((oldZone === 'zone1' || oldZone === 'line1') && (zone === 'zone2' || zone === 'zone3')) {
        totalBreach += 1;
        console.log(`  🚨 BREACH DETECTED! Total breaches: ${totalBreach}`);

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
        }
      }

      // Reset alarm triggers when cow returns to safe zone (zone1 or line1)
      if ((zone === 'zone1' || zone === 'line1') && (oldZone === 'zone2' || oldZone === 'zone3')) {
        console.log(`  🔔 Cow returned to safe zone - resetting all alarm triggers`);
      }

      console.log(`  💾 Final values - Cumulative: inside=${cumulativeTimeInside}s, outside=${cumulativeTimeOutside}s | Actual: inside=${actualTimeInside}s, outside=${actualTimeOutside}s | Breaches: ${totalBreach}`);
    }

    // Reset alarm triggered flags when cow returns to safe zone (zone1 or line1)
    const shouldResetAlarms = zoneChanged && (zone === 'zone1' || zone === 'line1') && (oldZone === 'zone2' || oldZone === 'zone3');

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
      alarm1Triggered = ((zone === 'zone2' || zone === 'zone3') && cowExists?.alarm1_triggered_at !== null) ? 1 : 0;
      alarm2Triggered = ((zone === 'zone2' || zone === 'zone3') && cowExists?.alarm2_triggered_at !== null) ? 1 : 0;
      alarm3Triggered = ((zone === 'zone2' || zone === 'zone3') && cowExists?.alarm3_triggered_at !== null) ? 1 : 0;
    }
    // If shouldResetAlarms, all stay 0

    // Update cow position in database
    console.log(`\n💾 [Recovery] Executing UPDATE on ${cowTable}...`);
    try {
      const updateStmt = db.prepare(
        `UPDATE ${cowTable}
         SET gps_latitude = ?,
             gps_longitude = ?,
             state_fence = ?,
             time_inside = ?,
             time_outside = ?,
             actual_time_inside_fence = ?,
             actual_time_outside_fence = ?,
             total_breach = ?,
             zone_changed_at = ?,
             alarm1_triggered = ?,
             alarm2_triggered = ?,
             alarm3_triggered = ?,
             alarm1_triggered_at = ?,
             alarm2_triggered_at = ?,
             alarm3_triggered_at = ?
         WHERE cow_token = ?`
      );

      const result = updateStmt.run(
        latitude,
        longitude,
        zone,
        cumulativeTimeInside,
        cumulativeTimeOutside,
        actualTimeInside,
        actualTimeOutside,
        totalBreach,
        zoneChanged ? now() : cowExists?.zone_changed_at,
        alarm1Triggered,
        alarm2Triggered,
        alarm3Triggered,
        shouldResetAlarms ? null : cowExists?.alarm1_triggered_at, // Reset timestamps to null
        shouldResetAlarms ? null : cowExists?.alarm2_triggered_at,
        shouldResetAlarms ? null : cowExists?.alarm3_triggered_at,
        cowToken
      );

      console.log('✅ UPDATE SUCCESSFUL!');
      console.log('   Rows affected:', result.changes);

      if (result.changes > 0) {
        // Verify the update
        const updatedCow = db.prepare(`SELECT cow_token, cow_name, gps_latitude, gps_longitude, state_fence, time_inside, time_outside, actual_time_inside_fence, actual_time_outside_fence, total_breach, zone_changed_at FROM ${cowTable} WHERE cow_token = ?`).get(cowToken);
        console.log('✓ Verified update in database:');
        console.log(`  Cow: ${updatedCow.cow_name}`);
        console.log(`  Position: (${updatedCow.gps_latitude}, ${updatedCow.gps_longitude})`);
        console.log(`  Zone: ${updatedCow.state_fence}`);
        console.log(`  Cumulative time inside: ${updatedCow.time_inside}s`);
        console.log(`  Cumulative time outside: ${updatedCow.time_outside}s`);
        console.log(`  Actual time inside: ${updatedCow.actual_time_inside_fence}s`);
        console.log(`  Actual time outside: ${updatedCow.actual_time_outside_fence}s`);
        console.log(`  Total breaches: ${updatedCow.total_breach}`);

        // Broadcast position update to all WebSocket clients (including page19)
        console.log('\n📡 [Recovery] Broadcasting to WebSocket clients...');
        const broadcastData = {
          type: 'virtual_cow_position',
          cow_token: cowToken,
          latitude: latitude,
          longitude: longitude,
          zone: zone,
          time_inside: updatedCow.time_inside,
          time_outside: updatedCow.time_outside,
          actual_time_inside_fence: updatedCow.actual_time_inside_fence,
          actual_time_outside_fence: updatedCow.actual_time_outside_fence,
          total_breach: updatedCow.total_breach,
          zone_changed_at: updatedCow.zone_changed_at,
          timestamp: now()
        };
        console.log('Broadcast data:', JSON.stringify(broadcastData));
        broadcastToWebSocketClients(broadcastData);
      } else {
        console.warn('⚠️ WARNING: No rows updated! Cow may not exist.');
      }
    } catch (err) {
      console.error('❌ DATABASE UPDATE FAILED!');
      console.error('Error:', err.message);
      console.error('Stack:', err.stack);
    }

    // Broadcast to all clients in this recovery room
    console.log('\n📡 [Recovery] Broadcasting to recovery room...');
    io.to(`recovery:${recoveryId}`).emit('recovery:cow-position-update', {
      recoveryId,
      cowToken,
      latitude,
      longitude,
      zone
    });
    console.log('========================================\n');
  });

  // Recovery cancelled by owner
  socket.on('recovery:cancel', (data) => {
    const { recoveryId } = data;
    console.log('[Recovery] Recovery cancelled:', recoveryId);

    // Broadcast to all clients in this recovery room
    io.to(`recovery:${recoveryId}`).emit('recovery:cancelled', {
      recoveryId
    });
  });

  // Recovery completed (all cows returned)
  socket.on('recovery:complete', (data) => {
    const { recoveryId } = data;
    console.log('[Recovery] Recovery completed:', recoveryId);

    // Broadcast to all clients in this recovery room
    io.to(`recovery:${recoveryId}`).emit('recovery:completed', {
      recoveryId
    });
  });
});

// Start cow movement simulation (disabled - using real ESP32 data)
// setTimeout(() => {
//   simulateCowMovement(wss);
//   console.log('Cow movement simulation started');
// }, 2000);

// Initialize cron jobs
initializeCronJobs();

// Start WebSocket bridge for ESP32 devices
const { broadcastToWebSocketClients } = require('./websocket-bridge');

module.exports = app;
