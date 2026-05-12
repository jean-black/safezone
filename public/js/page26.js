// page26.js - Developer System Settings page

const API_BASE_URL = '/api';

// Load current settings on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadCurrentSettings();
});

// Load and display current email settings
async function loadCurrentSettings() {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            window.location.href = '/html/index.html';
            return;
        }

        const response = await fetch(`${API_BASE_URL}/settings/email`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 401) {
            localStorage.removeItem('authToken');
            window.location.href = '/html/index.html';
            return;
        }

        const data = await response.json();

        if (response.ok) {
            displayCurrentSettings(data);
        } else {
            showError(data.error || 'Failed to load settings');
        }
    } catch (error) {
        console.error('Error loading settings:', error);
        showError('Network error. Please check your connection.');
    }
}

// Display current settings
function displayCurrentSettings(data) {
    const currentSettings = document.getElementById('currentSettings');

    currentSettings.innerHTML = `
        <div class="setting-item">
            <span class="setting-label">Email Address:</span>
            <span class="setting-value">${data.email || 'Not configured'}</span>
        </div>
    `;
}

// Handle settings form submission
document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const systemEmail = document.getElementById('systemEmail').value.trim();
    let appPasscode = document.getElementById('appPasscode').value.trim();
    const developerPassword = document.getElementById('developerPassword').value;

    // Remove spaces from app passcode
    appPasscode = appPasscode.replace(/\s+/g, '');

    // Validate
    if (!systemEmail || !appPasscode || !developerPassword) {
        showError('Please fill in all fields');
        return;
    }

    if (!systemEmail.includes('@gmail.com')) {
        showError('Please use a Gmail address');
        return;
    }

    if (appPasscode.length !== 16) {
        showError('Gmail app password must be 16 characters');
        return;
    }

    // Show loading state
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Verifying...';
    submitBtn.disabled = true;

    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            window.location.href = '/html/index.html';
            return;
        }

        const response = await fetch(`${API_BASE_URL}/settings/email`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: systemEmail,
                email_app_passcode: appPasscode,
                developer_password: developerPassword
            })
        });

        const data = await response.json();

        if (response.ok) {
            showSuccess('Settings updated successfully! A test email has been sent to your account.');
            await loadCurrentSettings();
            // Clear the form
            document.getElementById('settingsForm').reset();
        } else {
            showError(data.error || 'Failed to update settings');
        }
    } catch (error) {
        console.error('Error updating settings:', error);
        showError('Network error. Please try again.');
    } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
});

// Show success message
function showSuccess(message) {
    const successMessage = document.getElementById('successMessage');
    const errorMessage = document.getElementById('errorMessage');

    errorMessage.style.display = 'none';
    successMessage.textContent = message;
    successMessage.className = 'message success';
    successMessage.style.display = 'block';

    // Hide after 5 seconds
    setTimeout(() => {
        successMessage.style.display = 'none';
    }, 5000);
}

// Show error message
function showError(message) {
    const successMessage = document.getElementById('successMessage');
    const errorMessage = document.getElementById('errorMessage');

    successMessage.style.display = 'none';
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';

    // Hide after 5 seconds
    setTimeout(() => {
        errorMessage.style.display = 'none';
    }, 5000);
}
