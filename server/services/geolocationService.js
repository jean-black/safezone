const axios = require('axios');

/**
 * Get country name from latitude and longitude coordinates
 * Uses OpenStreetMap Nominatim API for reverse geocoding
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @returns {Promise<object>} Object containing country and formatted location
 */
async function getLocationFromCoordinates(latitude, longitude) {
  try {
    // Validate coordinates
    if (!latitude || !longitude ||
        latitude < -90 || latitude > 90 ||
        longitude < -180 || longitude > 180) {
      return {
        country: 'Unknown',
        location: `${latitude || 'N/A'}, ${longitude || 'N/A'}`,
        city: null,
        state: null
      };
    }

    // Use OpenStreetMap Nominatim API for reverse geocoding
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: {
        lat: latitude,
        lon: longitude,
        format: 'json',
        addressdetails: 1
      },
      headers: {
        'User-Agent': 'SafeZone-Cow-Tracker/1.0'
      },
      timeout: 5000 // 5 second timeout
    });

    const address = response.data.address || {};

    // Extract location details
    const country = address.country || 'Unknown';
    const city = address.city || address.town || address.village || null;
    const state = address.state || address.region || null;

    // Format location string
    let locationParts = [];
    if (city) locationParts.push(city);
    if (state) locationParts.push(state);
    if (country !== 'Unknown') locationParts.push(country);

    const formattedLocation = locationParts.length > 0
      ? locationParts.join(', ')
      : `${latitude}, ${longitude}`;

    return {
      country: country,
      location: formattedLocation,
      city: city,
      state: state,
      coordinates: `${latitude}, ${longitude}`
    };
  } catch (error) {
    console.error('Error getting location from coordinates:', error.message);

    // Return coordinates as fallback
    return {
      country: 'Unknown',
      location: `${latitude}, ${longitude}`,
      city: null,
      state: null,
      coordinates: `${latitude}, ${longitude}`
    };
  }
}

/**
 * Get location from IP address
 * Uses ip-api.com for IP geolocation (free, no API key needed)
 * @param {string} ip - IP address
 * @returns {Promise<object>} Object containing country and location
 */
async function getLocationFromIP(ip) {
  try {
    // Skip localhost/private IPs
    if (!ip || ip === 'Unknown' || ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('::ffff:127.0.0.1')) {
      return {
        country: 'Unknown',
        location: 'localhost',
        city: null,
        state: null,
        coordinates: null
      };
    }

    // Clean IPv6-mapped IPv4 addresses
    const cleanIP = ip.replace('::ffff:', '');

    // Use ip-api.com for IP geolocation
    const response = await axios.get(`http://ip-api.com/json/${cleanIP}`, {
      params: {
        fields: 'status,country,regionName,city,lat,lon'
      },
      timeout: 5000
    });

    if (response.data.status !== 'success') {
      return {
        country: 'Unknown',
        location: cleanIP,
        city: null,
        state: null,
        coordinates: null
      };
    }

    const data = response.data;
    const country = data.country || 'Unknown';
    const city = data.city || null;
    const state = data.regionName || null;
    const coordinates = (data.lat && data.lon) ? `${data.lat}, ${data.lon}` : null;

    // Format location string
    let locationParts = [];
    if (city) locationParts.push(city);
    if (state) locationParts.push(state);
    if (country !== 'Unknown') locationParts.push(country);

    const formattedLocation = locationParts.length > 0
      ? locationParts.join(', ')
      : cleanIP;

    return {
      country: country,
      location: formattedLocation,
      city: city,
      state: state,
      coordinates: coordinates
    };
  } catch (error) {
    console.error('Error getting location from IP:', error.message);

    return {
      country: 'Unknown',
      location: ip || 'Unknown',
      city: null,
      state: null,
      coordinates: null
    };
  }
}

module.exports = {
  getLocationFromCoordinates,
  getLocationFromIP
};
