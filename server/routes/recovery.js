const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { now } = require('../utils/dateFormatter');
const { notifyCowRecovery } = require('../services/notificationService');
const { sendCowRecoveryNotification } = require('../services/emailService');

/**
 * Generate recovery ID (recovery1, recovery2, etc.)
 */
function generateRecoveryId() {
  try {
    // Get the highest recovery ID from both dbt007 and dbt11
    const dbt7Max = db.prepare("SELECT recovery_id FROM dbt007 ORDER BY CAST(SUBSTR(recovery_id, 9) AS INTEGER) DESC LIMIT 1").get();
    const dbt11Max = db.prepare("SELECT recovery_id FROM dbt011 ORDER BY CAST(SUBSTR(recovery_id, 9) AS INTEGER) DESC LIMIT 1").get();

    let maxNumber = 0;

    if (dbt7Max && dbt7Max.recovery_id) {
      const num = parseInt(dbt7Max.recovery_id.replace('recovery', ''));
      if (!isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }

    if (dbt11Max && dbt11Max.recovery_id) {
      const num = parseInt(dbt11Max.recovery_id.replace('recovery', ''));
      if (!isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }

    return `recovery${maxNumber + 1}`;
  } catch (error) {
    console.error('Error generating recovery ID:', error);
    return `recovery${Date.now()}`;
  }
}

/**
 * Generate virtual agent ID (agent1, agent2, etc.)
 */
function generateVirtualAgentId() {
  try {
    const maxAgent = db.prepare("SELECT virtual_agent_id FROM dbt011 ORDER BY CAST(SUBSTR(virtual_agent_id, 6) AS INTEGER) DESC LIMIT 1").get();

    if (maxAgent && maxAgent.virtual_agent_id) {
      const num = parseInt(maxAgent.virtual_agent_id.replace('agent', ''));
      if (!isNaN(num)) {
        return `agent${num + 1}`;
      }
    }

    return 'agent1';
  } catch (error) {
    console.error('Error generating virtual agent ID:', error);
    return `agent${Date.now()}`;
  }
}

/**
 * Generate 4-digit numeric recovery code (1000-9999)
 */
function generateRecoveryCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Create a physical agent recovery request (farmer collaborative recovery)
 * POST /api/recovery/create
 * Body: { agentId, farmToken, lostCowTokens: [cowToken1, cowToken2, ...], expiresIn }
 */
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const farmerToken = req.user.token;
    const { agentId, farmToken, lostCowTokens, expiresIn = 24 } = req.body;

    if (!agentId || !farmToken || !lostCowTokens || !Array.isArray(lostCowTokens) || lostCowTokens.length === 0) {
      return res.status(400).json({ error: 'Missing required fields: agentId, farmToken, lostCowTokens (array)' });
    }

    // Verify all cows exist and belong to the farmer
    const cows = [];
    for (const cowToken of lostCowTokens) {
      const cow = db.prepare('SELECT cow_token, cow_name, user_token FROM dbt004 WHERE cow_token = ?').get(cowToken);
      if (!cow) {
        return res.status(404).json({ error: `Cow ${cowToken} not found` });
      }
      if (cow.user_token !== farmerToken) {
        return res.status(403).json({ error: `You do not own cow ${cow.cow_name}` });
      }
      cows.push(cow);
    }

    // Verify the farm belongs to the farmer
    const farm = db.prepare('SELECT user_token FROM dbt002 WHERE farm_token = ?').get(farmToken);
    if (!farm || farm.user_token !== farmerToken) {
      return res.status(403).json({ error: 'Farm not found or does not belong to you' });
    }

    // Generate recovery ID and code
    const recoveryId = generateRecoveryId();
    const recoveryCode = generateRecoveryCode();

    // Calculate expiration time (default 24 hours)
    const expiresAt = new Date(Date.now() + (expiresIn * 60 * 60 * 1000));
    const expiresAtStr = expiresAt.toISOString().slice(0, 19).replace('T', ' ');

    // Create recovery request (use first cow's token for backward compatibility)
    const stmt = db.prepare(`
      INSERT INTO dbt007 (
        recovery_id, agent_id, user_token, farm_token, lost_cow_token,
        expires_at, created_at, connection_state, agent_accept_state, recovery_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'disconnected', 'pending', ?)
    `);

    stmt.run(
      recoveryId,
      agentId,
      farmerToken,
      farmToken,
      lostCowTokens[0], // First cow for backward compatibility
      expiresAtStr,
      now(),
      recoveryCode
    );

    // Insert all cows into junction table dbt013
    const junctionStmt = db.prepare(`
      INSERT INTO dbt013 (recovery_id, cow_token) VALUES (?, ?)
    `);

    for (const cowToken of lostCowTokens) {
      junctionStmt.run(recoveryId, cowToken);
    }

    // Create notifications for all cows
    const cowNames = cows.map(c => c.cow_name); // Array of cow names for email
    for (const cow of cows) {
      notifyCowRecovery(
        farmerToken,
        cow.cow_token,
        cow.cow_name,
        `Agent ${agentId}`,
        recoveryId
      );
    }

    // Send email notification to the farmer
    try {
      const farmer = db.prepare('SELECT user_id, farmer_name FROM dbt001 WHERE user_token = ?').get(farmerToken);
      if (farmer && farmer.user_id) {
        await sendCowRecoveryNotification(
          farmer.user_id,
          farmer.farmer_name,
          cowNames, // Pass array of cow names
          recoveryId,
          recoveryCode,
          agentId,
          expiresAtStr
        );
        console.log(`Recovery email sent to ${farmer.user_id} for recovery ${recoveryId}`);
      }
    } catch (emailError) {
      // Log email error but don't fail the recovery creation
      console.error('Error sending recovery email:', emailError);
    }

    res.json({
      success: true,
      recoveryId,
      recoveryCode,
      expiresAt: expiresAtStr,
      cows: cows.map(c => ({ cow_token: c.cow_token, cow_name: c.cow_name })),
      message: `Recovery request created for ${cows.length} cow(s). Share code ${recoveryCode} with the agent.`
    });

  } catch (error) {
    console.error('Error creating recovery request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Create a virtual agent recovery (developer recovery)
 * POST /api/recovery/virtual/create
 * Body: { farmToken, lostCowTokens: [cowToken1, cowToken2, ...], expiresIn }
 */
router.post('/virtual/create', authenticateToken, async (req, res) => {
  try {
    console.log('[VIRTUAL RECOVERY] Starting recovery creation...');
    console.log('[VIRTUAL RECOVERY] User:', req.user);
    console.log('[VIRTUAL RECOVERY] Body:', req.body);

    const developerToken = req.user.token;
    const { farmToken, lostCowTokens, expiresIn = 24 } = req.body;

    if (!farmToken || !lostCowTokens || !Array.isArray(lostCowTokens) || lostCowTokens.length === 0) {
      console.log('[VIRTUAL RECOVERY] Validation failed - missing fields');
      return res.status(400).json({ error: 'Missing required fields: farmToken, lostCowTokens (array)' });
    }

    console.log('[VIRTUAL RECOVERY] Verifying cows in dbt006...');
    // Verify all cows exist in dbt006 (virtual cows only - dbt014 requires dbt006 foreign key)
    const cows = [];
    for (const cowToken of lostCowTokens) {
      // Only check dbt006 (virtual cows) - dbt014 foreign key constraint requires dbt006
      const cow = db.prepare('SELECT cow_token, cow_name FROM dbt006 WHERE cow_token = ?').get(cowToken);
      console.log(`[VIRTUAL RECOVERY] Cow ${cowToken} lookup:`, cow);
      if (!cow) {
        console.log(`[VIRTUAL RECOVERY] Error: Virtual cow ${cowToken} not found in dbt006`);
        return res.status(404).json({ error: `Virtual cow ${cowToken} not found in dbt006` });
      }
      cows.push(cow);
    }
    console.log('[VIRTUAL RECOVERY] All cows verified:', cows);

    // Generate recovery ID, virtual agent ID, and recovery code
    const recoveryId = generateRecoveryId();
    const virtualAgentId = generateVirtualAgentId();
    const recoveryCode = generateRecoveryCode(); // Now virtual agents also get recovery codes
    console.log('[VIRTUAL RECOVERY] Generated IDs:', { recoveryId, virtualAgentId, recoveryCode });

    // Calculate expiration time
    const expiresAt = new Date(Date.now() + (expiresIn * 60 * 60 * 1000));
    const expiresAtStr = expiresAt.toISOString().slice(0, 19).replace('T', ' ');
    console.log('[VIRTUAL RECOVERY] Expiration time:', expiresAtStr);

    // Create virtual agent recovery (use first cow's token for backward compatibility)
    console.log('[VIRTUAL RECOVERY] Inserting into dbt11...');
    const stmt = db.prepare(`
      INSERT INTO dbt011 (
        recovery_id, virtual_agent_id, developer_token, farm_token, lost_cow_token,
        expires_at, created_at, connection_state, virtual_agent_accept_state, recovery_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'disconnected', 'pending', ?)
    `);

    try {
      stmt.run(
        recoveryId,
        virtualAgentId,
        developerToken,
        farmToken,
        lostCowTokens[0], // First cow for backward compatibility
        expiresAtStr,
        now(),
        recoveryCode
      );
      console.log('[VIRTUAL RECOVERY] dbt011 insert successful');
    } catch (dbError) {
      console.error('[VIRTUAL RECOVERY] dbt011 insert failed:', dbError);
      throw dbError;
    }

    // Insert all cows into junction table dbt014
    console.log('[VIRTUAL RECOVERY] Inserting into dbt014...');
    const junctionStmt = db.prepare(`
      INSERT INTO dbt014 (recovery_id, cow_token) VALUES (?, ?)
    `);

    for (const cowToken of lostCowTokens) {
      try {
        junctionStmt.run(recoveryId, cowToken);
        console.log(`[VIRTUAL RECOVERY] dbt014 insert successful for cow ${cowToken}`);
      } catch (dbError) {
        console.error(`[VIRTUAL RECOVERY] dbt014 insert failed for cow ${cowToken}:`, dbError);
        throw dbError;
      }
    }

    // Send email notification to the developer
    const cowNames = cows.map(c => c.cow_name); // Array of cow names for email
    try {
      const developer = db.prepare('SELECT email, developer_name FROM dbt010 WHERE user_token = ?').get(developerToken);
      if (developer && developer.email) {
        await sendCowRecoveryNotification(
          developer.email,
          developer.developer_name,
          cowNames, // Pass array of cow names
          recoveryId,
          recoveryCode,
          virtualAgentId,
          expiresAtStr
        );
        console.log(`Virtual recovery email sent to ${developer.email} for recovery ${recoveryId}`);
      }
    } catch (emailError) {
      // Log email error but don't fail the recovery creation
      console.error('Error sending virtual recovery email:', emailError);
    }

    console.log('[VIRTUAL RECOVERY] Success! Sending response...');
    res.json({
      success: true,
      recoveryId,
      recoveryCode,
      virtualAgentId,
      expiresAt: expiresAtStr,
      cows: cows.map(c => ({ cow_token: c.cow_token, cow_name: c.cow_name })),
      message: `Virtual recovery created for ${cows.length} cow(s). Recovery code: ${recoveryCode}`
    });

  } catch (error) {
    console.error('[VIRTUAL RECOVERY] ERROR:', error);
    console.error('[VIRTUAL RECOVERY] Error stack:', error.stack);
    console.error('[VIRTUAL RECOVERY] Error message:', error.message);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * Accept recovery request with code (for physical agents)
 * POST /api/recovery/accept
 * Body: { recoveryId, recoveryCode }
 */
router.post('/accept', async (req, res) => {
  try {
    const { recoveryId, recoveryCode } = req.body;

    if (!recoveryId || !recoveryCode) {
      return res.status(400).json({ error: 'Missing recoveryId or recoveryCode' });
    }

    // Find recovery request
    const recovery = db.prepare('SELECT * FROM dbt007 WHERE recovery_id = ?').get(recoveryId);

    if (!recovery) {
      return res.status(404).json({ error: 'Recovery request not found' });
    }

    // Check if expired
    const expiresAt = new Date(recovery.expires_at);
    if (expiresAt < new Date()) {
      return res.status(400).json({ error: 'Recovery request has expired' });
    }

    // Verify code (numeric 4-digit code)
    if (recovery.recovery_code !== recoveryCode.toString()) {
      return res.status(401).json({ error: 'Invalid recovery code' });
    }

    // Update connection state and accept state
    const updateStmt = db.prepare(`
      UPDATE dbt007
      SET connection_state = 'connected', agent_accept_state = 'accepted'
      WHERE recovery_id = ?
    `);
    updateStmt.run(recoveryId);

    res.json({
      success: true,
      message: 'Recovery request accepted. You can now access the recovery page.',
      recoveryId,
      lostCowToken: recovery.lost_cow_token
    });

  } catch (error) {
    console.error('Error accepting recovery:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get recovery details
 * GET /api/recovery/:recoveryId
 */
router.get('/:recoveryId', authenticateToken, async (req, res) => {
  try {
    const { recoveryId } = req.params;

    // Try dbt007 first (physical agent)
    let recovery = db.prepare(`
      SELECT r.*
      FROM dbt007 r
      WHERE r.recovery_id = ?
    `).get(recoveryId);

    let type = 'physical';
    let junctionTable = 'dbt013';
    let cowTable = 'dbt004';

    // If not found, try dbt011 (virtual agent)
    if (!recovery) {
      recovery = db.prepare(`
        SELECT r.*
        FROM dbt011 r
        WHERE r.recovery_id = ?
      `).get(recoveryId);
      type = 'virtual';
      junctionTable = 'dbt014';
      cowTable = 'dbt006'; // Virtual cows are in dbt006, not dbt004
    }

    if (!recovery) {
      return res.status(404).json({ error: 'Recovery not found' });
    }

    // Get all cows from junction table
    // Note: Both dbt004 (real cows) and dbt006 (virtual cows) have 'collar_state'
    let cows;
    if (type === 'virtual') {
      // Virtual cows from dbt006
      cows = db.prepare(`
        SELECT c.cow_token, c.cow_name, c.cow_nickname, c.gps_latitude, c.gps_longitude, c.state_fence, c.collar_state, c.collar_id
        FROM ${junctionTable} j
        LEFT JOIN ${cowTable} c ON j.cow_token = c.cow_token
        WHERE j.recovery_id = ?
      `).all(recoveryId);
    } else {
      // Real cows from dbt004
      cows = db.prepare(`
        SELECT c.cow_token, c.cow_name, c.cow_nickname, c.gps_latitude, c.gps_longitude, c.state_fence, c.collar_state, c.collar_id
        FROM ${junctionTable} j
        LEFT JOIN ${cowTable} c ON j.cow_token = c.cow_token
        WHERE j.recovery_id = ?
      `).all(recoveryId);
    }

    // If no cows in junction table, fall back to lost_cow_token for backward compatibility
    if (cows.length === 0 && recovery.lost_cow_token) {
      let singleCow;
      if (type === 'virtual') {
        singleCow = db.prepare(`
          SELECT cow_token, cow_name, cow_nickname, gps_latitude, gps_longitude, state_fence, collar_state, collar_id
          FROM ${cowTable}
          WHERE cow_token = ?
        `).get(recovery.lost_cow_token);
      } else {
        singleCow = db.prepare(`
          SELECT cow_token, cow_name, cow_nickname, gps_latitude, gps_longitude, state_fence, collar_state, collar_id
          FROM ${cowTable}
          WHERE cow_token = ?
        `).get(recovery.lost_cow_token);
      }

      if (singleCow) {
        cows.push(singleCow);
      }
    }

    // Get fences for the farm associated with this recovery
    console.log(`Querying fences for farm_token: ${recovery.farm_token}`);
    const fences = db.prepare(`
      SELECT fence_name, fence_coordinate, fence_token
      FROM dbt003
      WHERE farm_token = ? AND is_used = 1
    `).all(recovery.farm_token);
    console.log(`Found ${fences.length} fence(s) for farm ${recovery.farm_token}`);

    res.json({
      success: true,
      recovery: {
        ...recovery,
        type,
        cows,
        fences
      }
    });

  } catch (error) {
    console.error('Error getting recovery details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get all active recoveries for a farmer
 * GET /api/recovery/active
 */
router.get('/active/list', authenticateToken, async (req, res) => {
  try {
    const farmerToken = req.user.token;

    const recoveries = db.prepare(`
      SELECT r.*, c.cow_name
      FROM dbt007 r
      LEFT JOIN dbt004 c ON r.lost_cow_token = c.cow_token
      WHERE r.user_token = ? AND r.expires_at > datetime('now')
      ORDER BY r.created_at DESC
    `).all(farmerToken);

    res.json({
      success: true,
      recoveries
    });

  } catch (error) {
    console.error('Error getting active recoveries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Disconnect recovery (close the recovery session)
 * POST /api/recovery/disconnect
 * Body: { recoveryId }
 */
router.post('/disconnect', authenticateToken, async (req, res) => {
  try {
    const { recoveryId } = req.body;

    if (!recoveryId) {
      return res.status(400).json({ error: 'Missing recoveryId' });
    }

    // Try updating dbt7
    let updated = db.prepare(`
      UPDATE dbt007
      SET connection_state = 'disconnected'
      WHERE recovery_id = ?
    `).run(recoveryId);

    // If not found in dbt7, try dbt11
    if (updated.changes === 0) {
      updated = db.prepare(`
        UPDATE dbt011
        SET connection_state = 'disconnected'
        WHERE recovery_id = ?
      `).run(recoveryId);
    }

    if (updated.changes === 0) {
      return res.status(404).json({ error: 'Recovery not found' });
    }

    res.json({
      success: true,
      message: 'Recovery session disconnected'
    });

  } catch (error) {
    console.error('Error disconnecting recovery:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Cancel recovery (owner cancels the recovery session)
 * POST /api/recovery/:recoveryId/cancel
 */
router.post('/:recoveryId/cancel', authenticateToken, async (req, res) => {
  try {
    const { recoveryId } = req.params;
    const userToken = req.user.token;

    // Check if recovery exists and belongs to user
    let recovery = db.prepare('SELECT * FROM dbt007 WHERE recovery_id = ? AND user_token = ?').get(recoveryId, userToken);
    let type = 'physical';

    if (!recovery) {
      recovery = db.prepare('SELECT * FROM dbt011 WHERE recovery_id = ? AND developer_token = ?').get(recoveryId, userToken);
      type = 'virtual';
    }

    if (!recovery) {
      return res.status(404).json({ error: 'Recovery not found or you do not own this recovery' });
    }

    // Update connection state to cancelled
    if (type === 'physical') {
      db.prepare(`
        UPDATE dbt007
        SET connection_state = 'cancelled'
        WHERE recovery_id = ?
      `).run(recoveryId);
    } else {
      db.prepare(`
        UPDATE dbt011
        SET connection_state = 'cancelled'
        WHERE recovery_id = ?
      `).run(recoveryId);
    }

    res.json({
      success: true,
      message: 'Recovery cancelled successfully'
    });

  } catch (error) {
    console.error('Error cancelling recovery:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get recovery share link
 * POST /api/recovery/:recoveryId/share-link
 */
router.post('/:recoveryId/share-link', authenticateToken, async (req, res) => {
  try {
    const { recoveryId } = req.params;
    const userToken = req.user.token;

    // Check if recovery exists and belongs to user
    let recovery = db.prepare('SELECT recovery_code FROM dbt007 WHERE recovery_id = ? AND user_token = ?').get(recoveryId, userToken);
    let pageType = '7'; // page 7 for farmers

    if (!recovery) {
      recovery = db.prepare('SELECT recovery_code FROM dbt011 WHERE recovery_id = ? AND developer_token = ?').get(recoveryId, userToken);
      pageType = '18'; // page 18 for developers
    }

    if (!recovery) {
      return res.status(404).json({ error: 'Recovery not found or you do not own this recovery' });
    }

    // Generate share link
    const protocol = req.protocol;
    const host = req.get('host');
    const shareLink = `${protocol}://${host}/html/page${pageType}_assistive-collaboration.html?code=${recovery.recovery_code}`;

    res.json({
      success: true,
      recoveryCode: recovery.recovery_code,
      shareLink,
      message: 'Recovery link generated successfully'
    });

  } catch (error) {
    console.error('Error generating share link:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Validate recovery code and get recovery details (for agents - no authentication required)
 * GET /api/recovery/validate/:code
 */
router.get('/validate/:code', async (req, res) => {
  try {
    const { code } = req.params;

    if (!code || code.length !== 4) {
      return res.status(400).json({ error: 'Invalid recovery code format. Must be 4 digits.' });
    }

    // Try to find recovery by code in dbt7
    let recovery = db.prepare(`
      SELECT r.*, f.farm_name
      FROM dbt007 r
      LEFT JOIN dbt002 f ON r.farm_token = f.farm_token
      WHERE r.recovery_code = ?
    `).get(code);

    let type = 'physical';
    let junctionTable = 'dbt013';
    let pageType = '7';

    // If not found in dbt7, try dbt11
    if (!recovery) {
      recovery = db.prepare(`
        SELECT r.*, f.farm_name
        FROM dbt011 r
        LEFT JOIN dbt002 f ON r.farm_token = f.farm_token
        WHERE r.recovery_code = ?
      `).get(code);
      type = 'virtual';
      junctionTable = 'dbt014';
      pageType = '18';
    }

    if (!recovery) {
      return res.status(404).json({ error: 'Invalid recovery code' });
    }

    // Check if expired
    const expiresAt = new Date(recovery.expires_at);
    if (expiresAt < new Date()) {
      return res.status(400).json({ error: 'Recovery request has expired' });
    }

    // Check if cancelled
    if (recovery.connection_state === 'cancelled') {
      return res.status(400).json({ error: 'Recovery has been cancelled' });
    }

    // Get all cows from junction table
    const cows = db.prepare(`
      SELECT c.cow_token, c.cow_name, c.cow_nickname, c.gps_latitude, c.gps_longitude, c.state_fence
      FROM ${junctionTable} j
      LEFT JOIN dbt004 c ON j.cow_token = c.cow_token
      WHERE j.recovery_id = ?
    `).all(recovery.recovery_id);

    // If no cows in junction table, fall back to lost_cow_token
    if (cows.length === 0 && recovery.lost_cow_token) {
      const singleCow = db.prepare(`
        SELECT cow_token, cow_name, cow_nickname, gps_latitude, gps_longitude, state_fence
        FROM dbt004
        WHERE cow_token = ?
      `).get(recovery.lost_cow_token);

      if (singleCow) {
        cows.push(singleCow);
      }
    }

    res.json({
      success: true,
      recovery: {
        recovery_id: recovery.recovery_id,
        farm_name: recovery.farm_name,
        expires_at: recovery.expires_at,
        connection_state: recovery.connection_state,
        type,
        pageType,
        cows
      }
    });

  } catch (error) {
    console.error('Error validating recovery code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
