// page25.js - Developer Sign-up page

const API_BASE_URL = '/api';

// Handle developer sign-up form submission
document.getElementById('devSignupForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const devName = document.getElementById('devName').value.trim();
    const devEmail = document.getElementById('devEmail').value.trim();
    const devPassword = document.getElementById('devPassword').value;
    const devPasswordConfirm = document.getElementById('devPasswordConfirm').value;
    const devPasscode = document.getElementById('devPasscode').value;

    const errorMessage = document.getElementById('errorMessage');
    const successMessage = document.getElementById('successMessage');

    // Clear previous messages
    errorMessage.textContent = '';
    successMessage.textContent = '';
    errorMessage.style.display = 'none';
    successMessage.style.display = 'none';

    // Validate inputs
    if (!devName || !devEmail || !devPassword || !devPasswordConfirm || !devPasscode) {
        errorMessage.textContent = 'All fields are required';
        errorMessage.style.display = 'block';
        return;
    }

    if (devPassword.length < 10) {
        errorMessage.textContent = 'Password must be at least 10 characters long';
        errorMessage.style.display = 'block';
        return;
    }

    if (devPassword !== devPasswordConfirm) {
        errorMessage.textContent = 'Passwords do not match';
        errorMessage.style.display = 'block';
        return;
    }

    if (devPasscode.length !== 4) {
        errorMessage.textContent = 'Developer passcode must be 4 digits';
        errorMessage.style.display = 'block';
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/developer-signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                developer_name: devName,
                email: devEmail,
                password: devPassword,
                passcode: devPasscode
            })
        });

        const data = await response.json();

        if (response.ok) {
            // Success
            successMessage.innerHTML = `
                <strong>Developer account created successfully!</strong><br><br>
                <strong>Developer Name:</strong> ${data.developer_name}<br>
                <strong>Developer Token:</strong> ${data.developer_token}<br><br>
                <strong>IMPORTANT:</strong> Check your email for:<br>
                1. Confirmation code (6 digits)<br>
                2. Recovery code (8 characters) - Save it for password recovery<br><br>
                Redirecting to login page in 5 seconds...
            `;
            successMessage.style.display = 'block';

            // Clear form
            document.getElementById('devSignupForm').reset();

            // Redirect to login page after 5 seconds
            setTimeout(() => {
                window.location.href = '/html/index.html';
            }, 5000);
        } else {
            // Error
            errorMessage.textContent = data.error || 'Failed to create developer account';
            errorMessage.style.display = 'block';
        }
    } catch (error) {
        console.error('Developer signup error:', error);
        errorMessage.textContent = 'Network error. Please try again.';
        errorMessage.style.display = 'block';
    }
});

// Back to login button
document.getElementById('backToLoginBtn').addEventListener('click', () => {
    window.location.href = '/html/index.html';
});
