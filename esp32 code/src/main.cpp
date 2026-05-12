#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <TinyGPS++.h>
#include <HardwareSerial.h>
#include <Preferences.h>

// ============================================
// FUNCTION PROTOTYPES
// ============================================
void connectToWiFi();
void setupWebSocket();
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length);
void registerDevice();
void handleWebSocketMessage(char* payload);
void updateZoneData(JsonObject fenceData);
void gpsTask(void* param);
void readGPS();
void sendGPSData();
void sendHeartbeat();
void updateZoneStatus();
void sendZoneChange();
double calculateDistance(double lat1, double lng1, double lat2, double lng2);
void updateLEDs();
void startAlarm();
void stopAlarm();
void handleAlarmSystem();
void sendAlarm(String alarmType, int level, String message);
void handleExoSystem();
void exoReset();

// ============================================
// CONFIGURATION
// ============================================

// WiFi credentials
const char* WIFI_SSID = "SaiyanSpeed";
const char* WIFI_PASSWORD = "05953271";

// Server configuration (WebSocket Bridge)
const char* WS_HOST = "192.168.0.101";  // Server local IP
const uint16_t WS_PORT = 8081;
const char* WS_PATH = "/";

// User configuration
const char* FARMER_EMAIL = "modeblackmng@gmail.com";


// Pin definitions
#define ONBOARD_LED_PIN 2   // WiFi status (solid = connected)
#define GPS_RX_PIN 16
#define GPS_TX_PIN 17
// Exo system LEDs (stand-ins for real deterrent hardware)
#define LED1_PIN 22   // Section 1 — electricity deterrent
#define LED2_PIN 4    // Section 2 — intermittent electricity (pulse A)
#define LED3_PIN 5    // Section 2 — intermittent electricity (pulse B)
#define LED4_PIN 18   // Section 3 — dog sound
#define LED5_PIN 19   // Section 4 — vibrator
#define LED6_PIN 21   // Section 5 — night LED
#define LED7_PIN 23   // Section 5 — night LED
#define LED8_PIN 25   // Section 5 — night LED

// ============================================
// GLOBAL OBJECTS
// ============================================

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
WebSocketsClient webSocket;
Preferences preferences;

// ============================================
// DEVICE IDENTIFICATION
// ============================================

String deviceId;
String macAddress;

// NVS-stored owner emails — set by server on registration/reassignment
String storedEmail1 = "";  // primary owner email (confirmed by server)
String storedEmail2 = "";  // secondary override email (set by server when user changes email)

// Account type received from server ("farmer" or "developer"), feature flag only
String accountType = "farmer";

// ============================================
// GPS AND LOCATION VARIABLES
// ============================================

volatile double currentLat = 0.0;
volatile double currentLng = 0.0;
volatile double currentAltitude = 0.0;
volatile double currentSpeed = 0.0;
volatile uint32_t satellites = 0;

// GPS detection state
volatile bool gpsModuleDetected  = false;   // true once we receive any NMEA bytes
volatile bool gpsHasValidFix     = false;   // true while GPS fix is current
volatile bool gpsJustGotFix      = false;   // set by GPS task on fix transition (no-fix → fix)
unsigned long gpsInitTime        = 0; // millis() when gpsSerial.begin() was called
volatile unsigned long lastGpsByteTime  = 0; // millis() of last byte received from GPS serial
volatile unsigned long lastValidFixTime = 0; // millis() of last valid gps.location update
const unsigned long GPS_DETECT_TIMEOUT_MS = 15000; // 15s with no bytes → no module
const unsigned long GPS_LOCK_TIMEOUT_MS   = 90000; // 90s module present but no fix → no lock
const unsigned long GPS_FIX_STALE_MS      = 10000; // 10s without update → fix considered lost


// Zone definitions (will be updated from server)
struct Zone {
  String name;
  double centerLat;
  double centerLng;
  double radius; // in meters
};

Zone zones[3] = {
  {"zone1", 0.0, 0.0, 50.0},
  {"zone2", 0.0, 0.0, 50.0},
  {"zone3", 0.0, 0.0, 50.0}
};

String currentZone = "none";
String previousZone = "none";
bool insideFence = false;

// ============================================
// ALARM SYSTEM VARIABLES
// ============================================

bool alarmActive = false;
unsigned long alarmStartTime = 0;
int alarmLevel = 0; // 0 = none, 1 = warning, 2 = alert, 3 = critical

// Alarm timing — all 4 are configurable from server and persisted in NVS
// Defaults match the system defaults: alarm1=10s, alarm2=25s, audio=20s, distance=1.0m
unsigned long alarm1TriggerMs       = 10000; // alarm1: audio after 10s in zone2
unsigned long alarm2TriggerMs       = 25000; // alarm2: email after 25s in zone2
unsigned long alarmAudioDurationMs  = 20000; // alarm1 audio plays for 20s
float         alarmDistanceThreshold = 1.0;  // alarm3: within 1.0m of fence → immediate email

bool  alarmAudioActive = false;
unsigned long alarmAudioStart = 0;

// ============================================
// EXO SYSTEM PARAMETERS (loaded from NVS)
// ============================================

bool  exo_s1_led1_enabled       = true;
bool  exo_s2_led2led3_enabled   = true;
int   exo_s2_led2led3_param     = 15;   // section2 blink duration in zone2 (seconds)
bool  exo_s3_led4_enabled       = true;
int   exo_s3_led4_param         = 25;   // section3 active duration (seconds)
bool  exo_s4_led5_enabled       = true;
int   exo_s4_led5_param         = 15;   // section4 active duration (seconds)
bool  exo_s5_led678_enabled     = true;

// ============================================
// EXO SYSTEM STATE
// ============================================

String exoPreviousZone = "zone1";
String exoCurrentZone  = "zone1";

unsigned long exoZone2EntryTime  = 0;
unsigned long exoZone3EntryTime  = 0;

// Section1 (LED1) — stays ON while cow is in line1 band
unsigned long exoLed1PulseEnd    = 0;

// Section2 (LED2+3) — zone2 blink
bool          exoLed2led3Active  = false;
unsigned long exoBlinkLastToggle = 0;
bool          exoBlinkState      = false;

// Section3 (LED4/speaker) — zone2 and zone3
bool          exoLed4Zone2Active    = false;
unsigned long exoLed4Zone2StartTime = 0;
bool          exoLed4Zone3Active    = false;
unsigned long exoLed4Zone3StartTime = 0;

// Section4 (LED5/vibrator) — zone3 instant start
bool          exoLed5Zone3Active    = false;
unsigned long exoLed5Zone3StartTime = 0;

// Section5 (LED6+7+8) — dedicated 1s blink timer
unsigned long exoSection5BlinkToggle = 0;
uint8_t       exoSection5Step        = 0;   // 0-3 sweep step for section5

// Section3 "fired" flags — prevents re-trigger within the same zone visit
bool exoLed4Zone2Fired = false;
bool exoLed4Zone3Fired = false;

// Virtual mode: when true, exo uses virtualLat/Lng instead of GPS
bool   virtualModeActive = false;
double virtualLat        = 0.0;
double virtualLng        = 0.0;
String virtualZone       = "zone1";

// Offline mode: when true, ESP32 stops sending GPS/heartbeat to server (simulated disconnect)
bool offlineModeActive = false;

// ============================================
// COMMUNICATION VARIABLES
// ============================================

unsigned long lastGPSSend = 0;
const unsigned long GPS_SEND_INTERVAL = 5000;

unsigned long lastHeartbeat = 0;
const unsigned long HEARTBEAT_INTERVAL = 10000;

unsigned long lastStatusPrint = 0;
const unsigned long STATUS_PRINT_INTERVAL = 30000; // print system status every 30s

bool wsConnected = false;
bool deviceRegistered = false;

// ============================================
// SETUP
// ============================================

void setup() {
  // Initialize Serial Monitor
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n\n========================================");
  Serial.println("    SafeZone ESP32 Cow Tracker");
  Serial.println("========================================\n");

  // Initialize all LED pins
  int ledPins[] = { ONBOARD_LED_PIN, LED1_PIN, LED2_PIN, LED3_PIN,
                    LED4_PIN, LED5_PIN, LED6_PIN, LED7_PIN, LED8_PIN };
  for (int p : ledPins) {
    pinMode(p, OUTPUT);
    digitalWrite(p, LOW);
  }

  // Get device ID (MAC address)
  macAddress = WiFi.macAddress();
  deviceId = "ESP32_" + macAddress;
  deviceId.replace(":", "");

  // Load persisted values from NVS
  preferences.begin("safezone", true); // read-only
  storedEmail1           = preferences.getString("email1",       "");
  storedEmail2           = preferences.getString("email2",       "");
  accountType            = preferences.getString("accountType",  "farmer");
  alarm1TriggerMs        = preferences.getULong("a1trigger",     10000);
  alarm2TriggerMs        = preferences.getULong("a2trigger",     25000);
  alarmAudioDurationMs   = preferences.getULong("audiodur",      20000);
  alarmDistanceThreshold = preferences.getFloat("a3dist",        1.0f);
  // Exo system parameters
  exo_s1_led1_enabled     = preferences.getBool("exo_s1_en",    true);
  exo_s2_led2led3_enabled = preferences.getBool("exo_s2_en",    true);
  exo_s2_led2led3_param   = preferences.getInt("exo_s2_par",    15);
  exo_s3_led4_enabled     = preferences.getBool("exo_s3_en",    true);
  exo_s3_led4_param       = preferences.getInt("exo_s3_par",    25);
  exo_s4_led5_enabled     = preferences.getBool("exo_s4_en",    true);
  exo_s4_led5_param       = preferences.getInt("exo_s4_par",    15);
  exo_s5_led678_enabled   = preferences.getBool("exo_s5_en",    true);
  // Load last-known zone data (survives power cycle until server sends fresh fence data)
  for (int i = 0; i < 3; i++) {
    char key[16];
    snprintf(key, sizeof(key), "z%d_lat", i); zones[i].centerLat = preferences.getDouble(key, 0.0);
    snprintf(key, sizeof(key), "z%d_lng", i); zones[i].centerLng = preferences.getDouble(key, 0.0);
    snprintf(key, sizeof(key), "z%d_rad", i); zones[i].radius    = preferences.getDouble(key, 50.0);
  }
  preferences.end();

  Serial.println("[SETUP] Device Information:");
  Serial.println("  Device ID: " + deviceId);
  Serial.println("  MAC Address: " + macAddress);
  Serial.println("  Code Email (firmware): " + String(FARMER_EMAIL));
  Serial.println("  NVS email1:            " + (storedEmail1.length() > 0 ? storedEmail1 : "(empty)"));
  Serial.println("  NVS email2:            " + (storedEmail2.length() > 0 ? storedEmail2 : "(empty)"));
  Serial.println("  Account Type:          " + accountType);
  Serial.println("  alarm1TriggerMs:       " + String(alarm1TriggerMs));
  Serial.println("  alarm2TriggerMs:       " + String(alarm2TriggerMs));
  Serial.println("  alarmAudioDurationMs:  " + String(alarmAudioDurationMs));
  Serial.println("  alarmDistanceThreshold:" + String(alarmDistanceThreshold, 1) + "m");
  Serial.println();

  // Initialize GPS
  Serial.println("[SETUP] Initializing GPS...");
  gpsSerial.setRxBufferSize(1024);  // increase before begin() to survive loop jitter
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  gpsInitTime = millis();
  Serial.println("  GPS RX Pin: " + String(GPS_RX_PIN));
  Serial.println("  GPS TX Pin: " + String(GPS_TX_PIN));
  // GPS task on Core 0 — runs independently of WiFi/WebSocket on Core 1
  xTaskCreatePinnedToCore(gpsTask, "GPS_Task", 8192, NULL, 1, NULL, 0);
  Serial.println("  GPS task started on Core 0");
  Serial.println();

  // Connect to WiFi
  connectToWiFi();

  // Setup WebSocket
  setupWebSocket();

  Serial.println("[SETUP] Initialization complete!\n");
  Serial.println("========================================\n");
}

// ============================================
// MAIN LOOP
// ============================================

void loop() {
  webSocket.loop();

  // GPS module / fix timeout warnings (printed once)
  static bool gpsNoModuleWarned = false;
  static bool gpsNoFixWarned    = false;
  unsigned long nowMs = millis();
  if (!gpsModuleDetected && !gpsNoModuleWarned && nowMs - gpsInitTime > GPS_DETECT_TIMEOUT_MS) {
    Serial.println("[GPS] ✗ No GPS module detected after 15s — check wiring (RX:" + String(GPS_RX_PIN) + " TX:" + String(GPS_TX_PIN) + ")");
    gpsNoModuleWarned = true;
  }
  if (gpsModuleDetected && !gpsHasValidFix && !gpsNoFixWarned && nowMs - gpsInitTime > GPS_LOCK_TIMEOUT_MS) {
    Serial.println("[GPS] ✗ Module present but no fix after 90s — check antenna / sky visibility");
    gpsNoFixWarned = true;
  }

  // GPS fix-loss: no valid NMEA update for 10s → consider fix lost
  if (gpsHasValidFix && lastValidFixTime > 0 && (millis() - lastValidFixTime > GPS_FIX_STALE_MS)) {
    gpsHasValidFix = false;
    Serial.println("[GPS] Fix lost — no valid update for 10s");
    if (wsConnected && deviceRegistered) {
      StaticJsonDocument<128> lostDoc;
      lostDoc["type"]     = "neo6m_fix_lost";
      lostDoc["deviceId"] = deviceId;
      String lostMsg;
      serializeJson(lostDoc, lostMsg);
      webSocket.sendTXT(lostMsg);
      Serial.println("[GPS] NEO6M fix lost — notifying server");
    }
  }

  // When GPS fix is first acquired while virtual mode is active, auto-disable virtual mode
  if (gpsJustGotFix) {
    gpsJustGotFix = false;
    if (virtualModeActive && wsConnected && deviceRegistered) {
      virtualModeActive = false;
      lastGPSSend       = 0; // send real GPS immediately
      exoReset();
      StaticJsonDocument<128> fixDoc;
      fixDoc["type"]     = "neo6m_fix_acquired";
      fixDoc["deviceId"] = deviceId;
      String fixMsg;
      serializeJson(fixDoc, fixMsg);
      webSocket.sendTXT(fixMsg);
      Serial.println("[GPS] NEO6M fix acquired — virtual mode auto-disabled, notifying server");
    }
  }

  updateZoneStatus();
  updateLEDs();
  handleAlarmSystem();
  handleExoSystem();

  // Suspend real GPS reporting while virtual mode is active — server holds fake coords
  if (!offlineModeActive && !virtualModeActive && wsConnected && deviceRegistered && millis() - lastGPSSend > GPS_SEND_INTERVAL) {
    sendGPSData();
    lastGPSSend = millis();
  }
  if (!offlineModeActive && wsConnected && deviceRegistered && millis() - lastHeartbeat > HEARTBEAT_INTERVAL) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }

  // Periodic system status line
  if (millis() - lastStatusPrint > STATUS_PRINT_INTERVAL) {
    lastStatusPrint = millis();
    Serial.println("\n========== System Status ==========");
    Serial.println("  WiFi:      " + String(WiFi.status() == WL_CONNECTED
                     ? "✓ Connected (" + WiFi.localIP().toString() + ")"
                     : "✗ Disconnected"));
    Serial.println("  WebSocket: " + String(wsConnected ? "✓ Connected" : "✗ Disconnected"));
    if (!gpsModuleDetected)
      Serial.println("  GPS:       ✗ No module detected");
    else if (!gpsHasValidFix)
      Serial.println("  GPS:       ⚠ Module detected, waiting for fix...");
    else
      Serial.println("  GPS:       ✓ Fix (" + String(currentLat,6) + ", " + String(currentLng,6) + ") sats=" + String(satellites));
    Serial.println("  Zone:      " + exoCurrentZone + " | VirtualMode: " + String(virtualModeActive ? "ON" : "OFF") + " | OfflineMode: " + String(offlineModeActive ? "ON" : "OFF"));
    Serial.println("====================================\n");
  }

  delay(1);
}

// ============================================
// WIFI FUNCTIONS
// ============================================

void connectToWiFi() {
  Serial.println("[WiFi] Connecting to WiFi...");
  Serial.println("  SSID: " + String(WIFI_SSID));

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // Blink LED while connecting
  int attempts = 0;
  Serial.print("  ");
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    digitalWrite(ONBOARD_LED_PIN, !digitalRead(ONBOARD_LED_PIN));
    Serial.print(".");
    delay(500);
    attempts++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    // WiFi connected - turn on LED solid
    digitalWrite(ONBOARD_LED_PIN, HIGH);
    Serial.println("[WiFi] ✓ Connected successfully!");
    Serial.println("  IP Address: " + WiFi.localIP().toString());
    Serial.println("  Signal Strength: " + String(WiFi.RSSI()) + " dBm");
    Serial.println();
  } else {
    // Failed - LED off
    digitalWrite(ONBOARD_LED_PIN, LOW);
    Serial.println("[WiFi] ✗ Connection FAILED!");
    Serial.println("  Could not connect after " + String(attempts) + " attempts");
    Serial.println();
  }
}

// ============================================
// WEBSOCKET FUNCTIONS
// ============================================

void setupWebSocket() {
  Serial.println("[WebSocket] Configuring WebSocket client...");
  Serial.println("  Server: " + String(WS_HOST) + ":" + String(WS_PORT));
  Serial.println("  Path: " + String(WS_PATH));

  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);

  Serial.println("[WebSocket] WebSocket client configured");
  Serial.println("  Reconnect Interval: 5000 ms");
  Serial.println();
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      wsConnected = false;
      deviceRegistered = false;
      Serial.println("[WebSocket] ✗ Disconnected from server");
      break;

    case WStype_CONNECTED:
      wsConnected = true;
      Serial.println("[WebSocket] ✓ Connected to server!");
      Serial.println("  URL: " + String((char*)payload));
      Serial.println("[WebSocket] Registering device...");
      // Register device with server
      registerDevice();
      break;

    case WStype_TEXT:
      Serial.println("[WebSocket] ← Message received: " + String((char*)payload));
      handleWebSocketMessage((char*)payload);
      break;

    case WStype_ERROR:
      wsConnected = false;
      Serial.println("[WebSocket] ✗ Error occurred!");
      break;

    case WStype_PING:
      Serial.println("[WebSocket] ← PING");
      break;

    case WStype_PONG:
      Serial.println("[WebSocket] → PONG");
      break;
  }
}

void registerDevice() {
  StaticJsonDocument<512> doc;
  doc["type"]       = "register";
  doc["deviceId"]   = deviceId;
  doc["macAddress"] = macAddress;
  doc["ipAddress"]  = WiFi.localIP().toString();
  doc["codeEmail"]  = FARMER_EMAIL;  // hardcoded firmware email
  doc["email1"]     = storedEmail1;  // NVS owner email (set by server)
  doc["email2"]     = storedEmail2;  // NVS secondary email (set by server for override)
  doc["timestamp"]  = millis();

  String message;
  serializeJson(doc, message);

  Serial.println("[WebSocket] → Sending registration:");
  Serial.println("  Device ID:   " + deviceId);
  Serial.println("  MAC Address: " + macAddress);
  Serial.println("  IP Address:  " + WiFi.localIP().toString());
  Serial.println("  codeEmail:   " + String(FARMER_EMAIL));
  Serial.println("  email1:      " + (storedEmail1.length() > 0 ? storedEmail1 : "(empty)"));
  Serial.println("  email2:      " + (storedEmail2.length() > 0 ? storedEmail2 : "(empty)"));

  webSocket.sendTXT(message);
}

void handleWebSocketMessage(char* payload) {
  StaticJsonDocument<1024> doc;
  DeserializationError error = deserializeJson(doc, payload);

  if (error) {
    Serial.println("[WebSocket] ✗ JSON parse error: " + String(error.c_str()));
    return;
  }

  const char* msgType = doc["type"];

  if (strcmp(msgType, "register_ack") == 0) {
    deviceRegistered = true;
    Serial.println("[WebSocket] ✓ DEVICE REGISTERED SUCCESSFULLY!");

    bool nvsChanged = false;

    // Update email1 (owner email confirmed by server)
    const char* receivedEmail1 = doc["email1"];
    if (receivedEmail1) {
      String newEmail1 = String(receivedEmail1);
      if (newEmail1 != storedEmail1) {
        if (storedEmail1.length() > 0)
          Serial.println("  ⚠ OWNER CHANGED — email1: " + storedEmail1 + " → " + newEmail1);
        storedEmail1 = newEmail1;
        nvsChanged = true;
        Serial.println("  NVS email1: " + (storedEmail1.length() > 0 ? storedEmail1 : "(cleared)"));
      } else {
        Serial.println("  NVS email1 unchanged: " + storedEmail1);
      }
    }

    // Update email2 (server-set override — empty string clears it)
    const char* receivedEmail2 = doc["email2"];
    if (receivedEmail2 != nullptr) {
      String newEmail2 = String(receivedEmail2);
      if (newEmail2 != storedEmail2) {
        storedEmail2 = newEmail2;
        nvsChanged = true;
        Serial.println(storedEmail2.length() > 0
          ? "  NVS email2: " + storedEmail2
          : "  NVS email2 cleared");
      }
    }

    // Update accountType (feature flag: developer = richer GPS data)
    const char* receivedAccountType = doc["accountType"];
    if (receivedAccountType && strlen(receivedAccountType) > 0) {
      String newType = String(receivedAccountType);
      if (newType != accountType) {
        accountType = newType;
        nvsChanged = true;
        Serial.println("  Account Type updated: " + accountType);
      } else {
        Serial.println("  Account Type: " + accountType + " (unchanged)");
      }
    }

    if (nvsChanged) {
      preferences.begin("safezone", false);
      preferences.putString("email1",      storedEmail1);
      preferences.putString("email2",      storedEmail2);
      preferences.putString("accountType", accountType);
      preferences.end();
    }

    Serial.println("  Status: Ready to send data");
    Serial.println();
  }
  else if (strcmp(msgType, "fence_update") == 0) {
    Serial.println("[Server] Fence/Zone update received");
    // Update fence/zone data from server
    JsonObject fenceData = doc["fenceData"];
    if (!fenceData.isNull()) {
      updateZoneData(fenceData);
      Serial.println("  Zones updated successfully");
    }
  }
  else if (strcmp(msgType, "config_update") == 0) {
    Serial.println("[Server] Configuration update received");
    JsonObject config = doc["config"];
    if (!config.isNull()) {
      bool changed = false;

      // ── Alarm params ────────────────────────────────────────────────
      if (config.containsKey("alarm1TriggerTime")) {
        alarm1TriggerMs = (unsigned long)(config["alarm1TriggerTime"].as<int>() * 1000);
        Serial.println("  alarm1TriggerTime → " + String(alarm1TriggerMs) + "ms");
        changed = true;
      }
      if (config.containsKey("alarm1AudioDuration")) {
        alarmAudioDurationMs = (unsigned long)(config["alarm1AudioDuration"].as<int>() * 1000);
        Serial.println("  alarm1AudioDuration → " + String(alarmAudioDurationMs) + "ms");
        changed = true;
      }
      if (config.containsKey("alarm2MomentOfActivation")) {
        alarm2TriggerMs = (unsigned long)(config["alarm2MomentOfActivation"].as<int>() * 1000);
        Serial.println("  alarm2MomentOfActivation → " + String(alarm2TriggerMs) + "ms");
        changed = true;
      }
      if (config.containsKey("alarm3DistanceOfActivation")) {
        alarmDistanceThreshold = config["alarm3DistanceOfActivation"].as<float>();
        Serial.println("  alarm3DistanceOfActivation → " + String(alarmDistanceThreshold, 1) + "m");
        changed = true;
      }

      // ── Exo system params ───────────────────────────────────────────
      if (config.containsKey("exo_section1_led1_enabled")) {
        exo_s1_led1_enabled = config["exo_section1_led1_enabled"].as<bool>();
        Serial.println("  exo_s1_led1_enabled → " + String(exo_s1_led1_enabled));
        changed = true;
      }
      if (config.containsKey("exo_section2_led2led3_enabled")) {
        exo_s2_led2led3_enabled = config["exo_section2_led2led3_enabled"].as<bool>();
        changed = true;
      }
      if (config.containsKey("exo_section2_led2led3_parameter")) {
        exo_s2_led2led3_param = config["exo_section2_led2led3_parameter"].as<int>();
        Serial.println("  exo_s2_led2led3_param → " + String(exo_s2_led2led3_param) + "s");
        changed = true;
      }
      if (config.containsKey("exo_section3_led4_enabled")) {
        exo_s3_led4_enabled = config["exo_section3_led4_enabled"].as<bool>();
        changed = true;
      }
      if (config.containsKey("exo_section3_led4_parameter")) {
        exo_s3_led4_param = config["exo_section3_led4_parameter"].as<int>();
        Serial.println("  exo_s3_led4_param → " + String(exo_s3_led4_param) + "s");
        changed = true;
      }
      if (config.containsKey("exo_section4_led5_enabled")) {
        exo_s4_led5_enabled = config["exo_section4_led5_enabled"].as<bool>();
        changed = true;
      }
      if (config.containsKey("exo_section4_led5_parameter")) {
        exo_s4_led5_param = config["exo_section4_led5_parameter"].as<int>();
        Serial.println("  exo_s4_led5_param → " + String(exo_s4_led5_param) + "s");
        changed = true;
      }
      if (config.containsKey("exo_section5_led6led7led8_enabled")) {
        exo_s5_led678_enabled = config["exo_section5_led6led7led8_enabled"].as<bool>();
        changed = true;
      }

      if (changed) {
        preferences.begin("safezone", false);
        preferences.putULong("a1trigger",   alarm1TriggerMs);
        preferences.putULong("a2trigger",   alarm2TriggerMs);
        preferences.putULong("audiodur",    alarmAudioDurationMs);
        preferences.putFloat("a3dist",      alarmDistanceThreshold);
        preferences.putBool("exo_s1_en",   exo_s1_led1_enabled);
        preferences.putBool("exo_s2_en",   exo_s2_led2led3_enabled);
        preferences.putInt("exo_s2_par",   exo_s2_led2led3_param);
        preferences.putBool("exo_s3_en",   exo_s3_led4_enabled);
        preferences.putInt("exo_s3_par",   exo_s3_led4_param);
        preferences.putBool("exo_s4_en",   exo_s4_led5_enabled);
        preferences.putInt("exo_s4_par",   exo_s4_led5_param);
        preferences.putBool("exo_s5_en",   exo_s5_led678_enabled);
        preferences.end();
        Serial.println("  [OK] Config applied and saved to NVS");
      }
    }
  }
  else if (strcmp(msgType, "virtual_mode") == 0) {
    // Developer virtual controller: override position with server-provided coordinates
    bool enable = doc["enabled"].as<bool>();
    if (enable) {
      virtualModeActive = true;
      virtualLat  = doc["latitude"].as<double>();
      virtualLng  = doc["longitude"].as<double>();
      virtualZone = doc["zone"] | "zone1";
      Serial.println("[Virtual] Virtual mode ENABLED");
      Serial.println("  Position: " + String(virtualLat, 6) + ", " + String(virtualLng, 6));
      Serial.println("  Zone: " + virtualZone);
      handleExoSystem(); // respond immediately to zone change
    } else {
      virtualModeActive = false;
      lastGPSSend = 0; // send real GPS immediately so it overwrites fake coords in DB
      Serial.println("[Virtual] Virtual mode DISABLED — resuming real GPS");
      exoReset(); // reset exo state when virtual control ends
    }
  }
  else if (strcmp(msgType, "alarm_command") == 0) {
    String zone = doc["zone"] | "zone1";
    Serial.println("[Server] ← alarm_command received — zone: " + zone);
    if (zone == "zone1") {
      virtualModeActive = false;
      virtualZone       = "zone1";
      exoReset();
      exoCurrentZone = "zone1";
      Serial.println("[Exo] Reset — cow returned to safe zone");
    } else {
      virtualModeActive = true;
      virtualZone       = zone;
      Serial.println("[Exo] Virtual breach set to: " + zone);
      handleExoSystem(); // respond immediately — don't wait for next loop tick
    }
  }
  else if (strcmp(msgType, "heartbeat_ack") == 0) {
    // Heartbeat acknowledged (silent - too verbose)
  }
  else if (strcmp(msgType, "offline_mode") == 0) {
    bool enabled = doc["enabled"] | false;
    offlineModeActive = enabled;
    if (offlineModeActive) {
      Serial.println("[Server] ← OFFLINE MODE ON — GPS and heartbeat suspended");
      Serial.println("  (Click Offline/Online button on controller to resume)");
    } else {
      Serial.println("[Server] ← OFFLINE MODE OFF — resuming normal communication");
      lastGPSSend  = 0; // send GPS immediately on resume
      lastHeartbeat = 0;
    }
  }
  else {
    Serial.println("[Server] Unknown message type: " + String(msgType));
  }
}

void updateZoneData(JsonObject fenceData) {
  // Update zone coordinates from server
  if (fenceData.containsKey("zones")) {
    JsonArray zonesArray = fenceData["zones"];
    for (size_t i = 0; i < zonesArray.size() && i < 3; i++) {
      JsonObject zone = zonesArray[i];
      zones[i].name      = zone["name"].as<String>();
      zones[i].centerLat = zone["centerLat"].as<double>();
      zones[i].centerLng = zone["centerLng"].as<double>();
      zones[i].radius    = zone["radius"].as<double>();
    }
    // Persist zone data to NVS so they survive power cycles
    preferences.begin("safezone", false);
    for (int i = 0; i < 3; i++) {
      char key[16];
      snprintf(key, sizeof(key), "z%d_lat", i); preferences.putDouble(key, zones[i].centerLat);
      snprintf(key, sizeof(key), "z%d_lng", i); preferences.putDouble(key, zones[i].centerLng);
      snprintf(key, sizeof(key), "z%d_rad", i); preferences.putDouble(key, zones[i].radius);
    }
    preferences.end();
    Serial.println("[NVS] Zone data saved to flash");
  }
}

// ============================================
// GPS FUNCTIONS
// ============================================

void readGPS() {
  static bool firstFixReported = false;

  while (gpsSerial.available() > 0) {
    char c = gpsSerial.read();
    lastGpsByteTime = millis();

    if (!gpsModuleDetected) {
      gpsModuleDetected = true;
      Serial.println("[GPS] Module detected — receiving NMEA data");
    }

    if (gps.encode(c)) {
      if (gps.location.isValid()) {
        bool wasZero = (currentLat == 0.0 && currentLng == 0.0);

        if (!gpsHasValidFix) gpsJustGotFix = true; // signal main loop: fix transitioned from none → active
        gpsHasValidFix   = true;
        lastValidFixTime = millis();
        currentLat       = gps.location.lat();
        currentLng       = gps.location.lng();

        if (gps.altitude.isValid()) currentAltitude = gps.altitude.meters();
        if (gps.speed.isValid())    currentSpeed    = gps.speed.kmph();
        if (gps.satellites.isValid()) satellites    = gps.satellites.value();

        if (wasZero && !firstFixReported) {
          Serial.println("[GPS] ✓ GPS FIX ACQUIRED!");
          Serial.println("  Location: " + String(currentLat, 6) + ", " + String(currentLng, 6));
          Serial.println("  Satellites: " + String(satellites));
          firstFixReported = true;
        }
      }
    }
  }
}

// Runs on Core 0 — drains UART buffer every 2 ms regardless of what Core 1 is doing.
// Prevents NMEA sentence corruption from webSocket.loop() blocking the main loop.
void gpsTask(void* param) {
  for (;;) {
    readGPS();
    vTaskDelay(2 / portTICK_PERIOD_MS);
  }
}

void sendGPSData() {
  if (!gpsHasValidFix) {
    Serial.println("[GPS] ⚠ No valid GPS data yet (waiting for fix...)");
    return;
  }

  StaticJsonDocument<512> doc;
  doc["type"]        = "gps_data";
  doc["deviceId"]    = deviceId;
  doc["latitude"]    = currentLat;
  doc["longitude"]   = currentLng;
  doc["altitude"]    = currentAltitude;
  doc["speed"]       = currentSpeed;
  doc["satellites"]  = satellites;
  doc["currentZone"] = currentZone;
  doc["insideFence"] = insideFence;
  doc["timestamp"]   = millis();

  // Developer accounts include GPS accuracy for the alarm window display
  if (accountType == "developer") {
    // hdop * 5.0 gives a rough meter estimate (hdop 1.0 ≈ 5m, hdop 2.0 ≈ 10m)
    float gpsAccuracy = 5.0f;
    if (gps.hdop.isValid()) gpsAccuracy = gps.hdop.hdop() * 5.0f;
    doc["accuracy"] = gpsAccuracy;
  }

  String message;
  serializeJson(doc, message);

  Serial.println("[GPS] → Sending GPS data:");
  Serial.println("  Lat: " + String(currentLat, 6) + " | Lng: " + String(currentLng, 6));
  Serial.println("  Alt: " + String(currentAltitude, 1) + "m | Speed: " + String(currentSpeed, 1) + " km/h");
  Serial.println("  Satellites: " + String(satellites));
  if (accountType == "developer" && gps.hdop.isValid())
    Serial.println("  Accuracy: ~" + String(gps.hdop.hdop() * 5.0f, 0) + "m");
  Serial.println("  Zone: " + currentZone + " | Inside Fence: " + String(insideFence ? "YES" : "NO"));
  webSocket.sendTXT(message);
}

void sendHeartbeat() {
  StaticJsonDocument<256> doc;
  doc["type"] = "heartbeat";
  doc["deviceId"] = deviceId;
  doc["timestamp"] = millis();

  String message;
  serializeJson(doc, message);
  webSocket.sendTXT(message);
}

// ============================================
// ZONE AND FENCE FUNCTIONS
// ============================================

void updateZoneStatus() {
  if (currentLat == 0.0 && currentLng == 0.0) {
    return; // No valid GPS data
  }

  // Check which zone the cow is in
  String newZone = "none";

  for (int i = 0; i < 3; i++) {
    if (zones[i].centerLat != 0.0 && zones[i].centerLng != 0.0) {
      double distance = calculateDistance(currentLat, currentLng,
                                         zones[i].centerLat, zones[i].centerLng);

      if (distance <= zones[i].radius) {
        newZone = zones[i].name;
        insideFence = true;
        break;
      }
    }
  }

  // Check boundary distance warning: if inside a zone but within alarmDistanceThreshold of its edge
  bool nearBoundary = false;
  if (newZone != "none") {
    for (int i = 0; i < 3; i++) {
      if (zones[i].name == newZone && zones[i].centerLat != 0.0) {
        double dist = calculateDistance(currentLat, currentLng, zones[i].centerLat, zones[i].centerLng);
        if ((zones[i].radius - dist) <= (double)alarmDistanceThreshold) {
          nearBoundary = true;
          break;
        }
      }
    }
  }
  static bool wasNearBoundary = false;
  if (nearBoundary && !wasNearBoundary) {
    Serial.println("[ALARM] ⚠ Near boundary (within " + String(alarmDistanceThreshold, 1) + "m of fence edge)");
    sendAlarm("near_boundary", 1, "Cow within " + String(alarmDistanceThreshold, 1) + "m of fence boundary");
  }
  wasNearBoundary = nearBoundary;

  // Check if zone changed
  if (newZone != currentZone) {
    previousZone = currentZone;
    currentZone = newZone;

    // Send zone change event
    sendZoneChange();

    // If cow left all zones, trigger alarm
    if (currentZone == "none" && previousZone != "none") {
      startAlarm();
    }

    // If cow returned to a zone, stop alarm
    if (currentZone != "none" && previousZone == "none") {
      stopAlarm();
    }
  }

  // Update insideFence status
  insideFence = (currentZone != "none");
}

void sendZoneChange() {
  StaticJsonDocument<256> doc;
  doc["type"] = "zone_change";
  doc["deviceId"] = deviceId;
  doc["oldZone"] = previousZone;
  doc["newZone"] = currentZone;
  doc["latitude"] = currentLat;
  doc["longitude"] = currentLng;
  doc["timestamp"] = millis();

  String message;
  serializeJson(doc, message);

  Serial.println("[ZONE] *** ZONE CHANGE ***");
  Serial.println("  " + previousZone + " → " + currentZone);
  Serial.println("  Location: " + String(currentLat, 6) + ", " + String(currentLng, 6));

  webSocket.sendTXT(message);
}

double calculateDistance(double lat1, double lng1, double lat2, double lng2) {
  const double R = 6371000; // Earth's radius in meters
  double dLat = (lat2 - lat1) * PI / 180.0;
  double dLng = (lng2 - lng1) * PI / 180.0;

  double a = sin(dLat/2) * sin(dLat/2) +
             cos(lat1 * PI / 180.0) * cos(lat2 * PI / 180.0) *
             sin(dLng/2) * sin(dLng/2);
  double c = 2 * atan2(sqrt(a), sqrt(1-a));

  return R * c; // Distance in meters
}

// ============================================
// LED CONTROL FUNCTIONS
// ============================================

void updateLEDs() {
  // LED1–LED8 are controlled exclusively by handleExoSystem()

  // Onboard LED (pin 2) states:
  //  GPS fix active         → very fast blink (100 ms)  [top priority]
  //  WiFi off               → off
  //  WiFi on + WS connected → solid on
  //  WiFi on + WS off       → slow blink (800 ms)
  //  boot (handled inline in connectToWiFi)

  static unsigned long lastToggle = 0;
  static bool          ledState   = false;

  bool wifiOn = (WiFi.status() == WL_CONNECTED);

  if (!wifiOn) {
    // WiFi disconnected → LED off
    digitalWrite(ONBOARD_LED_PIN, LOW);
    ledState = false;
    return;
  }

  if (gpsHasValidFix) {
    // GPS fix → very fast blink 100 ms
    if (millis() - lastToggle >= 100) {
      lastToggle = millis();
      ledState = !ledState;
      digitalWrite(ONBOARD_LED_PIN, ledState ? HIGH : LOW);
    }
    return;
  }

  // No GPS fix, WiFi connected
  if (wsConnected) {
    // Solid on
    digitalWrite(ONBOARD_LED_PIN, HIGH);
    ledState = true;
  } else {
    // Slow blink 800 ms
    if (millis() - lastToggle >= 800) {
      lastToggle = millis();
      ledState = !ledState;
      digitalWrite(ONBOARD_LED_PIN, ledState ? HIGH : LOW);
    }
  }
}

// ============================================
// ALARM SYSTEM FUNCTIONS
// ============================================

void startAlarm() {
  if (!alarmActive) {
    alarmActive = true;
    alarmStartTime = millis();
    alarmLevel = 0;

    Serial.println("[ALARM] ⚠ ALARM ACTIVATED!");
    Serial.println("  Reason: Cow has left all safe zones");

    sendAlarm("breach", 1, "Cow has left all safe zones");
  }
}

void stopAlarm() {
  if (alarmActive) {
    alarmActive = false;
    alarmLevel = 0;

    Serial.println("[ALARM] ✓ ALARM DEACTIVATED");
    Serial.println("  Reason: Cow has returned to safe zone");

    sendAlarm("return", 0, "Cow has returned to safe zone");
  }
}

void handleAlarmSystem() {
  // Handle audio auto-stop regardless of whether alarm is still active
  if (alarmAudioActive && (millis() - alarmAudioStart >= alarmAudioDurationMs)) {
    alarmAudioActive = false;
    Serial.println("[ALARM] Audio stopped (" + String(alarmAudioDurationMs / 1000) + "s elapsed)");
    sendAlarm("audio_end", alarmLevel, "Alarm audio stopped after " + String(alarmAudioDurationMs / 1000) + " seconds");
  }

  if (!alarmActive) {
    return;
  }

  unsigned long timeOutside = millis() - alarmStartTime;

  // alarm1: audio after alarm1TriggerMs (default 10s) in zone2
  if (alarmLevel == 0 && timeOutside >= alarm1TriggerMs) {
    alarmLevel = 1;
    alarmAudioActive = true;
    alarmAudioStart = millis();
    Serial.println("[ALARM] ⚠ ALARM1 - " + String(alarm1TriggerMs / 1000) + "s outside → audio started");
    sendAlarm("alarm1", 1, "Cow outside for " + String(alarm1TriggerMs / 1000) + " seconds - audio alarm");
  }

  // alarm2: email after alarm2TriggerMs (default 25s) in zone2
  if (alarmLevel == 1 && timeOutside >= alarm2TriggerMs) {
    alarmLevel = 2;
    Serial.println("[ALARM] ⚠⚠ ALARM2 - " + String(alarm2TriggerMs / 1000) + "s outside → email alert");
    sendAlarm("alarm2", 2, "Cow outside for " + String(alarm2TriggerMs / 1000) + " seconds - email sent");
  }
}

// ============================================
// EXO SYSTEM (cow training deterrents)
// ============================================

void exoReset() {
  digitalWrite(LED1_PIN, LOW);
  digitalWrite(LED2_PIN, LOW);
  digitalWrite(LED3_PIN, LOW);
  digitalWrite(LED4_PIN, LOW);
  digitalWrite(LED5_PIN, LOW);
  digitalWrite(LED6_PIN, LOW);
  digitalWrite(LED7_PIN, LOW);
  digitalWrite(LED8_PIN, LOW);
  exoLed1PulseEnd       = 0;
  exoLed2led3Active     = false;
  exoBlinkState         = false;
  exoLed4Zone2Active    = false;
  exoLed4Zone2StartTime = 0;
  exoLed4Zone3Active    = false;
  exoLed4Zone3StartTime = 0;
  exoLed5Zone3Active    = false;
  exoLed5Zone3StartTime = 0;
  exoZone2EntryTime     = 0;
  exoZone3EntryTime     = 0;
  exoLed4Zone2Fired     = false;
  exoLed4Zone3Fired     = false;
  exoSection5Step       = 0;
}

void handleExoSystem() {
  String zone = virtualModeActive ? virtualZone : currentZone;
  unsigned long now = millis();

  // ── Zone transition detection ──────────────────────────────────────
  if (zone != exoCurrentZone) {
    exoPreviousZone = exoCurrentZone;
    exoCurrentZone  = zone;

    // Entering zone1 (safe) — reset everything
    if (zone == "zone1" || zone == "none") {
      if (zone == "zone1") Serial.println("[Exo] ✓ Zone1 (safe) — exo system RESET");
      else                 Serial.println("[Exo] Zone unknown (no GPS fix) — exo system RESET");
      exoReset();
      exoCurrentZone = zone;
      return;
    }

    // Entering line1: Exo1 — Section1 (LED1) ON and stays ON while in line1
    if (zone == "line1") {
      Serial.println("[Exo] ⚠ LINE1 — cow at fence boundary");
      exoReset(); // immediately turn off all zone2/3 LEDs and clear all flags
      if (exo_s1_led1_enabled) {
        digitalWrite(LED1_PIN, HIGH);
        exoLed1PulseEnd = 0;  // no timeout — LED1 stays ON until zone changes
        Serial.println("[Exo] Section1 LED1 ON — stays ON at line1");
      }
      return;
    }

    // zone1/line1 → zone2: start zone2 timers; turn LED1 OFF if coming from line1
    if (zone == "zone2" && exoPreviousZone != "zone3") {
      if (exoPreviousZone == "line1") {
        digitalWrite(LED1_PIN, LOW);
        exoLed1PulseEnd = 0;
        Serial.println("[Exo] Section1 LED1 OFF — left line1, entering zone2");
      }
      Serial.println("[Exo] ⚠ ZONE2 BREACH");
      exoZone2EntryTime     = now;
      exoLed2led3Active     = false;
      exoLed4Zone2Active    = false;
      exoLed4Zone2StartTime = 0;
      exoBlinkState         = false;
    }

    // Entering zone3: Exo3 — Section4 (LED5/vibrator) instant ON
    if (zone == "zone3") {
      // Turn LED1 OFF if coming from line1
      if (exoPreviousZone == "line1") {
        digitalWrite(LED1_PIN, LOW);
        exoLed1PulseEnd = 0;
        Serial.println("[Exo] Section1 LED1 OFF — left line1, entering zone3");
      }
      Serial.println("[Exo] ⚠⚠ ZONE3 BREACH");
      // Stop zone2 section2 blinking
      if (exoLed2led3Active) {
        digitalWrite(LED2_PIN, LOW);
        digitalWrite(LED3_PIN, LOW);
        exoLed2led3Active = false;
        Serial.println("[Exo] Section2 LED2+3 OFF (cow left zone2)");
      }
      // Clear zone2 section3 state (LED4 may still be on from zone2)
      if (exoLed4Zone2Active) {
        digitalWrite(LED4_PIN, LOW);
        exoLed4Zone2Active    = false;
        exoLed4Zone2StartTime = 0;
        Serial.println("[Exo] Section3 LED4 OFF — cleared zone2 section3 on zone3 entry");
      }
      exoLed4Zone2Fired = false;
      exoLed4Zone3Fired = false;
      // Section4 (LED5/vibrator) — instant start
      if (exo_s4_led5_enabled) {
        digitalWrite(LED5_PIN, HIGH);
        exoLed5Zone3Active    = true;
        exoLed5Zone3StartTime = now;
        Serial.println("[Exo] Section4 LED5 ON — vibrator instant (zone3 entry)");
      }
      exoZone3EntryTime     = now;
      exoLed4Zone3Active    = false;
      exoLed4Zone3StartTime = 0;
    }

    // zone3 → zone2: clean up zone3 state, restart zone2 timer
    if (exoPreviousZone == "zone3" && zone == "zone2") {
      if (exoLed5Zone3Active) {
        digitalWrite(LED5_PIN, LOW);
        exoLed5Zone3Active = false;
        Serial.println("[Exo] Section4 LED5 OFF (left zone3)");
      }
      if (exoLed4Zone3Active) {
        digitalWrite(LED4_PIN, LOW);
        exoLed4Zone3Active = false;
        Serial.println("[Exo] Section3 LED4 OFF (left zone3)");
      }
      exoLed4Zone3Fired = false;
      exoZone3EntryTime = 0;
      if (exoZone2EntryTime == 0) exoZone2EntryTime = now;
    }
  }

  // ── Section1 (LED1) pulse timeout ─────────────────────────────────
  if (exoLed1PulseEnd > 0 && now >= exoLed1PulseEnd) {
    digitalWrite(LED1_PIN, LOW);
    exoLed1PulseEnd = 0;
    Serial.println("[Exo] Section1 LED1 OFF — pulse complete");
  }

  // ── Zone2 continuous ──────────────────────────────────────────────
  if (exoCurrentZone == "zone2" && exoZone2EntryTime > 0) {
    unsigned long timeInZone2 = (now - exoZone2EntryTime) / 1000;

    // Section2 (LED2+3): blink 1s on/off instantly, lasts exo_s2_led2led3_param seconds then off
    if (exo_s2_led2led3_enabled) {
      if (!exoLed2led3Active && timeInZone2 < (unsigned long)exo_s2_led2led3_param) {
        exoLed2led3Active  = true;
        exoBlinkLastToggle = now;
        exoBlinkState      = false;
        digitalWrite(LED2_PIN, HIGH);
        digitalWrite(LED3_PIN, LOW);
        Serial.println("[Exo] Section2 LED2+3 ON — intermittent electricity (zone2 entry)");
      }
      if (exoLed2led3Active) {
        if (timeInZone2 >= (unsigned long)exo_s2_led2led3_param) {
          digitalWrite(LED2_PIN, LOW);
          digitalWrite(LED3_PIN, LOW);
          exoLed2led3Active = false;
          Serial.println("[Exo] Section2 LED2+3 OFF — " + String(exo_s2_led2led3_param) + "s elapsed");
        } else {
          if (now - exoBlinkLastToggle >= 1000) {
            exoBlinkState = !exoBlinkState;
            digitalWrite(LED2_PIN, exoBlinkState ? LOW  : HIGH);
            digitalWrite(LED3_PIN, exoBlinkState ? HIGH : LOW);
            exoBlinkLastToggle = now;
          }
        }
      }
    }

    // Section3 (LED4/speaker): ON after 10s, OFF after exo_s3_led4_param seconds active
    // exoLed4Zone2Fired prevents re-trigger if cow stays in zone2 after the duty cycle
    if (exo_s3_led4_enabled) {
      if (!exoLed4Zone2Active && !exoLed4Zone2Fired && timeInZone2 >= 10UL) {
        digitalWrite(LED4_PIN, HIGH);
        exoLed4Zone2Active    = true;
        exoLed4Zone2StartTime = now;
        exoLed4Zone2Fired     = true;
        Serial.println("[Exo] Section3 LED4 ON — speaker (10s in zone2)");
      }
      if (exoLed4Zone2Active && (now - exoLed4Zone2StartTime) / 1000 >= (unsigned long)exo_s3_led4_param) {
        digitalWrite(LED4_PIN, LOW);
        exoLed4Zone2Active = false;
        Serial.println("[Exo] Section3 LED4 OFF — " + String(exo_s3_led4_param) + "s elapsed");
      }
    }
  }

  // ── Zone3 continuous ──────────────────────────────────────────────
  if (exoCurrentZone == "zone3" && exoZone3EntryTime > 0) {
    unsigned long timeInZone3 = (now - exoZone3EntryTime) / 1000;

    // Section4 (LED5/vibrator): was ON instantly at zone3 entry, OFF after exo_s4_led5_param seconds
    if (exo_s4_led5_enabled && exoLed5Zone3Active) {
      if ((now - exoLed5Zone3StartTime) / 1000 >= (unsigned long)exo_s4_led5_param) {
        digitalWrite(LED5_PIN, LOW);
        exoLed5Zone3Active = false;
        Serial.println("[Exo] Section4 LED5 OFF — " + String(exo_s4_led5_param) + "s elapsed");
      }
    }

    // Section3 (LED4/speaker): ON after 10s, OFF after exo_s3_led4_param seconds active
    // exoLed4Zone3Fired prevents re-trigger if cow stays in zone3 after the duty cycle
    if (exo_s3_led4_enabled) {
      if (!exoLed4Zone3Active && !exoLed4Zone3Fired && timeInZone3 >= 10UL) {
        digitalWrite(LED4_PIN, HIGH);
        exoLed4Zone3Active    = true;
        exoLed4Zone3StartTime = now;
        exoLed4Zone3Fired     = true;
        Serial.println("[Exo] Section3 LED4 ON — speaker (10s in zone3)");
      }
      if (exoLed4Zone3Active && (now - exoLed4Zone3StartTime) / 1000 >= (unsigned long)exo_s3_led4_param) {
        digitalWrite(LED4_PIN, LOW);
        exoLed4Zone3Active = false;
        Serial.println("[Exo] Section3 LED4 OFF — " + String(exo_s3_led4_param) + "s elapsed");
      }
    }
  }

  // ── Section5 (LED6→7→8→7→6→7→8…): fast sweep while cow is in zone2 or zone3 ──
  // Pattern: LED6 on, then LED7, then LED8, then LED7, then repeat (50ms per step)
  if (exo_s5_led678_enabled && (exoCurrentZone == "zone2" || exoCurrentZone == "zone3")) {
    if (now - exoSection5BlinkToggle >= 80) {
      exoSection5BlinkToggle = now;
      // 4-step bounce: 0=LED6, 1=LED7, 2=LED8, 3=LED7 then back to 0
      uint8_t step = exoSection5Step % 4;
      digitalWrite(LED6_PIN, step == 0 ? HIGH : LOW);
      digitalWrite(LED7_PIN, (step == 1 || step == 3) ? HIGH : LOW);
      digitalWrite(LED8_PIN, step == 2 ? HIGH : LOW);
      exoSection5Step++;
    }
  } else {
    // Cow is not outside — force Section5 LEDs off and reset sweep
    digitalWrite(LED6_PIN, LOW);
    digitalWrite(LED7_PIN, LOW);
    digitalWrite(LED8_PIN, LOW);
    exoSection5Step = 0;
  }
}

void sendAlarm(String alarmType, int level, String message) {
  StaticJsonDocument<512> doc;
  doc["type"] = "alarm";
  doc["deviceId"] = deviceId;
  doc["alarmType"] = alarmType;
  doc["alarmLevel"] = level;
  doc["message"] = message;
  doc["latitude"] = currentLat;
  doc["longitude"] = currentLng;
  doc["timestamp"] = millis();

  String jsonMessage;
  serializeJson(doc, jsonMessage);
  webSocket.sendTXT(jsonMessage);
}

