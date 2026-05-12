// Authentication UI and Modal Management
const API_BASE_URL = '/api';

// Store email for confirmation flow
let pendingConfirmationEmail = '';
let pendingRecoveryCode = '';
let failedLoginEmail = ''; // Store failed login email for password recovery

// Initialize authentication event listeners
document.addEventListener('DOMContentLoaded', () => {
    initializeAuthModals();
    initializeAuthForms();
});

function initializeAuthModals() {
    // Signup modal
    const signupBtn = document.getElementById('signupBtn');
    const signupModal = document.getElementById('signupModal');
    const closeSignup = document.getElementById('closeSignup');

    if (signupBtn && signupModal) {
        signupBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openModal(signupModal);
        });
    }

    if (closeSignup && signupModal) {
        closeSignup.addEventListener('click', () => closeModal(signupModal));
    }

    // Email confirmation modal
    const confirmEmailModal = document.getElementById('confirmEmailModal');
    const closeConfirmEmail = document.getElementById('closeConfirmEmail');

    if (closeConfirmEmail && confirmEmailModal) {
        closeConfirmEmail.addEventListener('click', () => closeModal(confirmEmailModal));
    }

    // Password recovery modal
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    const recoveryModal = document.getElementById('recoveryModal');
    const closeRecovery = document.getElementById('closeRecovery');

    if (forgotPasswordLink && recoveryModal) {
        forgotPasswordLink.addEventListener('click', async (e) => {
            e.preventDefault();

            // If user just failed login, skip email entry and send recovery code directly
            if (failedLoginEmail) {
                console.log('Using failed login email:', failedLoginEmail);

                // Send recovery code automatically
                try {
                    const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: failedLoginEmail })
                    });

                    if (response.ok) {
                        // Skip to step 2 - code verification
                        document.getElementById('requestRecoveryStep').style.display = 'none';
                        document.getElementById('verifyRecoveryStep').style.display = 'block';
                        document.getElementById('recoveryEmailDisplay').textContent = `Recovery code sent to: ${failedLoginEmail}`;
                        openModal(recoveryModal);
                    } else {
                        // If failed, show step 1
                        document.getElementById('requestRecoveryStep').style.display = 'block';
                        document.getElementById('verifyRecoveryStep').style.display = 'none';
                        document.getElementById('recoveryEmail').value = failedLoginEmail;
                        openModal(recoveryModal);
                    }
                } catch (error) {
                    console.error('Error sending recovery code:', error);
                    // If error, show step 1
                    document.getElementById('requestRecoveryStep').style.display = 'block';
                    document.getElementById('verifyRecoveryStep').style.display = 'none';
                    document.getElementById('recoveryEmail').value = failedLoginEmail;
                    openModal(recoveryModal);
                }
            } else {
                // No failed login email - show step 1 normally
                document.getElementById('requestRecoveryStep').style.display = 'block';
                document.getElementById('verifyRecoveryStep').style.display = 'none';
                openModal(recoveryModal);
            }
        });
    }

    if (closeRecovery && recoveryModal) {
        closeRecovery.addEventListener('click', () => {
            closeModal(recoveryModal);
            // Reset to step 1 when closing
            document.getElementById('requestRecoveryStep').style.display = 'block';
            document.getElementById('verifyRecoveryStep').style.display = 'none';
        });
    }

    // Reset password modal
    const resetPasswordModal = document.getElementById('resetPasswordModal');
    const closeResetPassword = document.getElementById('closeResetPassword');

    if (closeResetPassword && resetPasswordModal) {
        closeResetPassword.addEventListener('click', () => closeModal(resetPasswordModal));
    }

    // Close modals when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeModal(e.target);
        }
    });
}

function initializeAuthForms() {
    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // Signup form
    const signupForm = document.getElementById('signupForm');
    if (signupForm) {
        signupForm.addEventListener('submit', handleSignup);
    }

    // Email confirmation form
    const confirmEmailForm = document.getElementById('confirmEmailForm');
    if (confirmEmailForm) {
        confirmEmailForm.addEventListener('submit', handleEmailConfirmation);
    }

    // Resend confirmation code
    const resendCodeBtn = document.getElementById('resendCodeBtn');
    if (resendCodeBtn) {
        resendCodeBtn.addEventListener('click', handleResendConfirmation);
    }

    // Request recovery code form (Step 1)
    const requestRecoveryForm = document.getElementById('requestRecoveryForm');
    if (requestRecoveryForm) {
        requestRecoveryForm.addEventListener('submit', handleRequestRecoveryCode);
    }

    // Recovery code verification form (Step 2)
    const recoveryForm = document.getElementById('recoveryForm');
    if (recoveryForm) {
        recoveryForm.addEventListener('submit', handleRecoveryCodeVerification);
    }

    // Back to email button
    const backToEmailBtn = document.getElementById('backToEmailBtn');
    if (backToEmailBtn) {
        backToEmailBtn.addEventListener('click', showRequestRecoveryStep);
    }

    // Reset password form
    const resetPasswordForm = document.getElementById('resetPasswordForm');
    if (resetPasswordForm) {
        resetPasswordForm.addEventListener('submit', handlePasswordReset);
    }
}

// Modal helper functions
function openModal(modal) {
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
}

// Get user's geolocation (WiFi positioning)
function getUserLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            console.log('Geolocation is not supported by this browser');
            resolve({ latitude: null, longitude: null });
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                });
            },
            (error) => {
                console.log('Geolocation error:', error.message);
                // Don't block login if geolocation fails
                resolve({ latitude: null, longitude: null });
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0
            }
        );
    });
}

// Handle login
async function handleLogin(e) {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorElement = document.getElementById('errorMessage');
    const successElement = document.getElementById('successMessage');

    clearMessages();

    try {
        // Get user's location (WiFi positioning)
        const { latitude, longitude } = await getUserLocation();

        // Prepare login data
        const loginData = { email, password };

        // Add location if available
        if (latitude && longitude) {
            loginData.latitude = latitude;
            loginData.longitude = longitude;
            console.log(`Login with location: ${latitude}, ${longitude}`);
        } else {
            console.log('Login without location (will use IP-based geolocation)');
        }

        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loginData)
        });

        const data = await response.json();

        if (response.ok) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('safezone_user', data.farmer_id);
            localStorage.setItem('userType', data.userType); // Store user type (developer or farmer)
            showSuccess(successElement, 'Login successful! Redirecting...');
            setTimeout(() => window.location.href = '/html/page2_dashboard.html', 1000);
        } else {
            // Store failed login email for password recovery
            failedLoginEmail = email;

            // Check if email confirmation is required
            if (data.requiresConfirmation) {
                pendingConfirmationEmail = data.email;
                showError(errorElement, 'Email not confirmed. Please check your email.');
                setTimeout(() => {
                    closeModal(document.getElementById('loginModal'));
                    openModal(document.getElementById('confirmEmailModal'));
                }, 2000);
            } else {
                showError(errorElement, data.error || 'Login failed');
            }
        }
    } catch (error) {
        console.error('Login error:', error);
        showError(errorElement, 'Network error. Please try again.');
    }
}

// Handle signup
async function handleSignup(e) {
    e.preventDefault();

    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const passwordConfirm = document.getElementById('signupPasswordConfirm').value;
    const errorElement = document.getElementById('signupError');

    clearMessages();

    if (password !== passwordConfirm) {
        showError(errorElement, 'Passwords do not match');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok) {
            // Store email for confirmation
            pendingConfirmationEmail = data.email;

            // Show success message
            alert(`Account created successfully!

Username: ${data.farmer_name}

IMPORTANT: Check your email for:
1. Confirmation code (6 digits) - Enter it in the next step
2. Recovery code (8 characters) - Save it for password recovery

Please check your inbox and spam folder.`);

            // Close signup modal and open confirmation modal
            closeModal(document.getElementById('signupModal'));
            openModal(document.getElementById('confirmEmailModal'));
        } else {
            showError(errorElement, data.error || 'Signup failed');
        }
    } catch (error) {
        console.error('Signup error:', error);
        showError(errorElement, 'Network error. Please try again.');
    }
}

// Handle email confirmation
async function handleEmailConfirmation(e) {
    e.preventDefault();

    const confirmationCode = document.getElementById('confirmationCode').value;
    const errorElement = document.getElementById('confirmError');

    clearMessages();

    try {
        const response = await fetch(`${API_BASE_URL}/auth/confirm-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: pendingConfirmationEmail,
                confirmationCode
            })
        });

        const data = await response.json();

        if (response.ok) {
            alert('Email confirmed successfully! You can now log in.');
            closeModal(document.getElementById('confirmEmailModal'));
            document.getElementById('confirmEmailForm').reset();
        } else {
            showError(errorElement, data.error || 'Invalid confirmation code');
        }
    } catch (error) {
        console.error('Confirmation error:', error);
        showError(errorElement, 'Network error. Please try again.');
    }
}

// Handle resend confirmation
async function handleResendConfirmation() {
    const errorElement = document.getElementById('confirmError');

    if (!pendingConfirmationEmail) {
        showError(errorElement, 'Email address not found. Please try signing up again.');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/resend-confirmation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: pendingConfirmationEmail })
        });

        const data = await response.json();

        if (response.ok) {
            alert('New confirmation code sent to your email!\n\nPlease check your inbox and spam folder.');
        } else {
            showError(errorElement, data.error || 'Failed to resend code');
        }
    } catch (error) {
        console.error('Resend error:', error);
        showError(errorElement, 'Network error. Please try again.');
    }
}

// Helper function to show request recovery step
function showRequestRecoveryStep() {
    document.getElementById('requestRecoveryStep').style.display = 'block';
    document.getElementById('verifyRecoveryStep').style.display = 'none';
    document.getElementById('recoveryEmail').value = '';
    document.getElementById('recoveryCode').value = '';
    clearMessages();
}

// Helper function to show verify recovery step
function showVerifyRecoveryStep() {
    document.getElementById('requestRecoveryStep').style.display = 'none';
    document.getElementById('verifyRecoveryStep').style.display = 'block';
    clearMessages();
}

// Handle request recovery code (Step 1)
async function handleRequestRecoveryCode(e) {
    e.preventDefault();

    const email = document.getElementById('recoveryEmail').value.trim();
    const errorElement = document.getElementById('requestRecoveryError');

    clearMessages();

    try {
        const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (response.ok) {
            alert('Recovery code sent to your email!\n\nPlease check your inbox and spam folder.');
            showVerifyRecoveryStep();
        } else {
            showError(errorElement, data.error || 'Failed to send recovery code');
        }
    } catch (error) {
        console.error('Request recovery error:', error);
        showError(errorElement, 'Network error. Please try again.');
    }
}

// Handle recovery code verification (Step 2)
async function handleRecoveryCodeVerification(e) {
    e.preventDefault();

    const recoveryCode = document.getElementById('recoveryCode').value.toUpperCase();
    const errorElement = document.getElementById('recoveryError');

    clearMessages();

    try {
        const response = await fetch(`${API_BASE_URL}/auth/verify-recovery-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recoveryCode })
        });

        const data = await response.json();

        if (response.ok) {
            // Store recovery code and show reset password modal
            pendingRecoveryCode = recoveryCode;
            document.getElementById('resetEmailDisplay').textContent = `Resetting password for: ${data.email}`;

            closeModal(document.getElementById('recoveryModal'));
            openModal(document.getElementById('resetPasswordModal'));
        } else {
            showError(errorElement, data.error || 'Invalid recovery code');
        }
    } catch (error) {
        console.error('Recovery verification error:', error);
        showError(errorElement, 'Network error. Please try again.');
    }
}

// Handle password reset
async function handlePasswordReset(e) {
    e.preventDefault();

    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;
    const errorElement = document.getElementById('resetError');

    clearMessages();

    if (newPassword !== confirmNewPassword) {
        showError(errorElement, 'Passwords do not match');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recoveryCode: pendingRecoveryCode,
                newPassword
            })
        });

        const data = await response.json();

        if (response.ok) {
            alert('Password reset successfully! You can now log in with your new password.');
            closeModal(document.getElementById('resetPasswordModal'));
            document.getElementById('resetPasswordForm').reset();
            document.getElementById('recoveryForm').reset();
        } else {
            showError(errorElement, data.error || 'Password reset failed');
        }
    } catch (error) {
        console.error('Password reset error:', error);
        showError(errorElement, 'Network error. Please try again.');
    }
}

// Helper functions
function showError(element, message) {
    if (element) {
        element.textContent = message;
        element.style.display = 'block';
    }
}

function showSuccess(element, message) {
    if (element) {
        element.textContent = message;
        element.classList.add('show');
    }
}

function clearMessages() {
    const errorElements = document.querySelectorAll('.error-message');
    const successElements = document.querySelectorAll('.success-message');

    errorElements.forEach(el => {
        el.textContent = '';
        el.style.display = 'none';
    });

    successElements.forEach(el => {
        el.textContent = '';
        el.classList.remove('show');
    });
}
