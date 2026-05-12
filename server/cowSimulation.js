const { db } = require('../config/database');
const { now } = require('../utils/dateFormatter');

// Cow movement simulation for non-ESP32 cows
function simulateCowMovement(wss) {
  setInterval(() => {
    try {
      const stmt = db.prepare(`
        SELECT cow_name, cow_token, state_fence
        FROM dbt004
        WHERE collar_id NOT LIKE 'ESP%'
      `);
      const cows = stmt.all();

      for (const cow of cows) {
        // Randomly toggle state between inside and outside occasionally
        const shouldToggleState = Math.random() < 0.1; // 10% chance to change state
        if (shouldToggleState) {
          const newState = cow.state_fence === 'inside' ? 'outside' : 'inside';
          const updateStateStmt = db.prepare('UPDATE dbt004 SET state_fence = ? WHERE cow_token = ?');
          updateStateStmt.run(newState, cow.cow_token);

          // Update time spent (5 seconds since last update)
          if (newState === 'inside') {
            const updateTimeStmt = db.prepare('UPDATE dbt004 SET time_outside = time_outside + 5 WHERE cow_token = ?');
            updateTimeStmt.run(cow.cow_token);
          } else {
            const updateTimeStmt = db.prepare('UPDATE dbt004 SET time_inside = time_inside + 5 WHERE cow_token = ?');
            updateTimeStmt.run(cow.cow_token);
          }

          // Broadcast state change via WebSocket
          const stateUpdate = {
            type: 'cow_state',
            cowId: cow.cow_name,
            state: newState
          };

          wss.clients.forEach((client) => {
            if (client.readyState === 1) { // WebSocket.OPEN
              client.send(JSON.stringify(stateUpdate));
            }
          });
        } else {
          // Just increment time for current state
          if (cow.state_fence === 'inside') {
            const updateTimeStmt = db.prepare('UPDATE dbt004 SET time_inside = time_inside + 5 WHERE cow_token = ?');
            updateTimeStmt.run(cow.cow_token);
          } else {
            const updateTimeStmt = db.prepare('UPDATE dbt004 SET time_outside = time_outside + 5 WHERE cow_token = ?');
            updateTimeStmt.run(cow.cow_token);
          }
        }
      }
    } catch (error) {
      console.error('Cow simulation error:', error);
    }
  }, 5000); // Update every 5 seconds
}

// Create test cows if they don't exist
function createTestCows() {
  try {
    const testCowsStmt = db.prepare('SELECT COUNT(*) as count FROM dbt004 WHERE collar_id LIKE ?');
    const testCows = testCowsStmt.get('Random%');

    if (testCows.count === 0) {
      const testFarmerStmt = db.prepare('SELECT user_token FROM dbt001 LIMIT 1');
      const testFarmer = testFarmerStmt.get();

      if (testFarmer) {
        const farmerToken = testFarmer.user_token;
        const insertCowStmt = db.prepare('INSERT INTO dbt004 (cow_name, cow_nickname, collar_id, cow_token, user_token, farm_token, timestamp, state_fence, time_inside, time_outside, total_breach, alarm1_triggered, alarm2_triggered, alarm3_triggered) VALUES (?, NULL, ?, ?, ?, NULL, ?, \'inside\', 0, 0, 0, 0, 0, 0)');

        for (let i = 1; i <= 5; i++) {
          const collarId = `Random_Cow_${i}`;
          const cowName = `cow${i}`;
          const cowToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
          insertCowStmt.run(cowName, collarId, cowToken, farmerToken, now());
        }

        // Update farmer's total_cow counter
        const updateStmt = db.prepare('UPDATE dbt001 SET total_cow = total_cow + 5 WHERE user_token = ?');
        updateStmt.run(farmerToken);

        console.log('Test cows created');
      }
    }
  } catch (error) {
    console.error('Error creating test cows:', error);
  }
}

module.exports = { simulateCowMovement, createTestCows };
