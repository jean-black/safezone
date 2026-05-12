/**
 * Date formatting utilities for consistent timestamp formatting across the application
 * Standard format: YYYY-MM-DD HH:MM:SS (e.g., "2025-12-13 12:33:12")
 */

/**
 * Format a date to SQLite-compatible datetime string
 * Format: YYYY-MM-DD HH:MM:SS
 * @param {Date} date - The date to format (defaults to current date/time)
 * @returns {string} Formatted datetime string
 */
function formatDateTime(date = new Date()) {
  const d = new Date(date);

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Get current datetime as formatted string
 * Format: YYYY-MM-DD HH:MM:SS
 * @returns {string} Current datetime formatted
 */
function now() {
  return formatDateTime(new Date());
}

/**
 * Format a date to SQLite-compatible date string (date only, no time)
 * Format: YYYY-MM-DD
 * @param {Date} date - The date to format (defaults to current date)
 * @returns {string} Formatted date string
 */
function formatDate(date = new Date()) {
  const d = new Date(date);

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Convert ISO string or any date format to SQLite datetime format
 * @param {string|Date} dateInput - The date to convert
 * @returns {string} Formatted datetime string
 */
function toSQLiteDateTime(dateInput) {
  if (!dateInput) return null;

  try {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) {
      return null;
    }
    return formatDateTime(date);
  } catch (error) {
    console.error('Error converting date:', error);
    return null;
  }
}

module.exports = {
  formatDateTime,
  now,
  formatDate,
  toSQLiteDateTime
};
