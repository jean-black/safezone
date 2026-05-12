const jwt = require('jsonwebtoken');
const { db } = require('../config/database');

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  console.log('Auth Header:', authHeader);
  console.log('Token:', token ? token.substring(0, 20) + '...' : 'none');

  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ error: 'Access token required' });
  }

  const secret = process.env.JWT_SECRET || 'safezone-secret-key';
  console.log('Using JWT secret:', secret.substring(0, 10) + '...');

  jwt.verify(token, secret, (err, user) => {
    if (err) {
      console.log('JWT verification error:', err.message);
      return res.status(403).json({ error: 'Invalid token' });
    }
    console.log('Token verified successfully for user:', user.farmerId, 'type:', user.userType);
    req.user = user;

    // Update last_seen timestamp for the user
    try {
      if (user.userType === 'developer') {
        // For developers, update dbt010 using user_token
        const updateLastSeenStmt = db.prepare(`
          UPDATE dbt010
          SET last_seen = CURRENT_TIMESTAMP
          WHERE user_token = ?
        `);
        updateLastSeenStmt.run(user.token);
        console.log('Updated last_seen for developer:', user.token);
      } else {
        // For farmers, update dbt001 using user_id (email)
        const updateLastSeenStmt = db.prepare(`
          UPDATE dbt001
          SET last_seen = CURRENT_TIMESTAMP
          WHERE user_id = ?
        `);
        updateLastSeenStmt.run(user.farmerId);
        console.log('Updated last_seen for farmer:', user.farmerId);
      }
    } catch (updateError) {
      console.error('Error updating last_seen:', updateError);
      // Don't fail the request if last_seen update fails
    }

    next();
  });
};

// Generate random token
const generateToken = () => {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
};

// Helper function to calculate polygon area in square meters
function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateFencePerimeter(nodes) {
  if (!nodes || nodes.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < nodes.length; i++) {
    const p1 = nodes[i];
    const p2 = nodes[(i + 1) % nodes.length];
    total += haversineDistanceMeters(p1.lat, p1.lng, p2.lat, p2.lng);
  }
  return Math.round(total * 10) / 10; // round to 0.1 m
}

function calculatePolygonArea(nodes) {
  if (nodes.length < 3) return 0;

  // Calculate area using Shoelace formula (in degrees²)
  let areaDegrees = 0;
  for (let i = 0; i < nodes.length; i++) {
    const j = (i + 1) % nodes.length;
    areaDegrees += nodes[i].lat * nodes[j].lng;
    areaDegrees -= nodes[j].lat * nodes[i].lng;
  }
  areaDegrees = Math.abs(areaDegrees) / 2;

  // Convert from degrees² to square meters
  // Get average latitude for the polygon
  const avgLat = nodes.reduce((sum, node) => sum + node.lat, 0) / nodes.length;

  // Conversion factors at this latitude
  const metersPerDegreeLat = 111320; // meters per degree latitude (constant)
  const metersPerDegreeLng = 111320 * Math.cos(avgLat * Math.PI / 180); // meters per degree longitude (varies by latitude)

  // Convert area from degrees² to m²
  const areaMeters = areaDegrees * metersPerDegreeLat * metersPerDegreeLng;

  return areaMeters;
}

module.exports = {
  authenticateToken,
  generateToken,
  calculatePolygonArea,
  calculateFencePerimeter
};
