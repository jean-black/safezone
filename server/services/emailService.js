const nodemailer = require('nodemailer');
const { db } = require('../config/database');
require('dotenv').config();

/**
 * Get email credentials from dbt032
 * Falls back to environment variables or defaults if database is unavailable
 */
function getEmailCredentials() {
  try {
    const settings = db.prepare('SELECT email, email_app_passcode FROM dbt032 WHERE id = 1').get();

    if (settings && settings.email && settings.email_app_passcode) {
      return {
        user: settings.email,
        pass: settings.email_app_passcode
      };
    }
  } catch (error) {
    console.error('Error reading email settings from dbt032:', error);
  }

  // Fallback to environment variables or defaults
  return {
    user: process.env.GMAIL_USER || 'modeblackmng@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD || 'ulxnwsvdpnnojutm'
  };
}

/**
 * Create email transporter with current credentials from dbt032
 */
function createTransporter() {
  const credentials = getEmailCredentials();

  return nodemailer.createTransport({
    service: 'gmail',
    auth: credentials
  });
}

// Send confirmation email
async function sendConfirmationEmail(email, username, confirmationCode) {
  const transporter = createTransporter();
  const credentials = getEmailCredentials();

  const mailOptions = {
    from: `"SafeZone" <${credentials.user}>`,
    to: email,
    subject: 'SafeZone - Email Verification',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #ffffff;
            margin: 0;
            padding: 40px 20px;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            text-align: center;
          }
          .header {
            margin-bottom: 10px;
          }
          .title {
            color: #dc2626;
            font-size: 48px;
            font-weight: bold;
            margin: 0;
          }
          .subtitle {
            color: #6b7280;
            font-size: 18px;
            margin: 10px 0 40px 0;
          }
          .content {
            background-color: #f3f4f6;
            padding: 60px 40px;
            border-radius: 8px;
          }
          .message-title {
            font-size: 32px;
            font-weight: bold;
            color: #111827;
            margin-bottom: 20px;
          }
          .message-text {
            font-size: 16px;
            color: #6b7280;
            margin-bottom: 40px;
          }
          .code-container {
            background-color: #ffffff;
            padding: 30px;
            border-radius: 8px;
            margin: 30px 0;
          }
          .code {
            color: #dc2626;
            font-size: 48px;
            font-weight: bold;
            letter-spacing: 8px;
            margin: 0;
          }
          .expiry-text {
            font-size: 15px;
            color: #6b7280;
            margin: 30px 0 10px 0;
          }
          .disclaimer {
            font-size: 15px;
            color: #6b7280;
            margin-top: 10px;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            color: #9ca3af;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="title">SafeZone</h1>
            <p class="subtitle">Secure Authentication System</p>
          </div>

          <div class="content">
            <h2 class="message-title">Email Verification</h2>
            <p class="message-text">Please use the following code to complete your registration:</p>

            <div class="code-container">
              <p class="code">${confirmationCode}</p>
            </div>

            <p class="expiry-text">This code will expire in 10 minutes.</p>
            <p class="disclaimer">If you didn't request this code, please ignore this email.</p>
          </div>

          <div class="footer">
            SafeZone Security System
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Confirmation email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending confirmation email:', error);
    throw error;
  }
}

// Send recovery code email (when user first signs up)
async function sendRecoveryCodeEmail(email, username, recoveryCode) {
  const transporter = createTransporter();
  const credentials = getEmailCredentials();

  const mailOptions = {
    from: `"SafeZone" <${credentials.user}>`,
    to: email,
    subject: 'SafeZone - Password Recovery Code',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #ffffff;
            margin: 0;
            padding: 40px 20px;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            text-align: center;
          }
          .header {
            margin-bottom: 10px;
          }
          .title {
            color: #dc2626;
            font-size: 48px;
            font-weight: bold;
            margin: 0;
          }
          .subtitle {
            color: #6b7280;
            font-size: 18px;
            margin: 10px 0 40px 0;
          }
          .content {
            background-color: #f3f4f6;
            padding: 60px 40px;
            border-radius: 8px;
          }
          .message-title {
            font-size: 32px;
            font-weight: bold;
            color: #111827;
            margin-bottom: 20px;
          }
          .message-text {
            font-size: 16px;
            color: #6b7280;
            margin-bottom: 40px;
          }
          .code-container {
            background-color: #ffffff;
            padding: 30px;
            border-radius: 8px;
            margin: 30px 0;
          }
          .code {
            color: #dc2626;
            font-size: 48px;
            font-weight: bold;
            letter-spacing: 8px;
            margin: 0;
          }
          .expiry-text {
            font-size: 15px;
            color: #6b7280;
            margin: 30px 0 10px 0;
          }
          .disclaimer {
            font-size: 15px;
            color: #6b7280;
            margin-top: 10px;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            color: #9ca3af;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="title">SafeZone</h1>
            <p class="subtitle">Secure Authentication System</p>
          </div>

          <div class="content">
            <h2 class="message-title">Password Recovery</h2>
            <p class="message-text">Please use the following code to reset your password:</p>

            <div class="code-container">
              <p class="code">${recoveryCode}</p>
            </div>

            <p class="expiry-text">This code will expire in 10 minutes.</p>
            <p class="disclaimer">If you didn't request this code, please ignore this email.</p>
          </div>

          <div class="footer">
            SafeZone Security System
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Recovery code email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending recovery code email:', error);
    throw error;
  }
}

// Send password reset notification
async function sendPasswordResetNotification(email, username) {
  const transporter = createTransporter();
  const credentials = getEmailCredentials();

  const mailOptions = {
    from: `"SafeZone" <${credentials.user}>`,
    to: email,
    subject: 'SafeZone - Password Reset Successful',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #ffffff;
            margin: 0;
            padding: 40px 20px;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            text-align: center;
          }
          .header {
            margin-bottom: 10px;
          }
          .title {
            color: #dc2626;
            font-size: 48px;
            font-weight: bold;
            margin: 0;
          }
          .subtitle {
            color: #6b7280;
            font-size: 18px;
            margin: 10px 0 40px 0;
          }
          .content {
            background-color: #f3f4f6;
            padding: 40px;
            border-radius: 8px;
            text-align: left;
          }
          .greeting {
            font-size: 16px;
            color: #111827;
            margin-bottom: 20px;
          }
          .message-title {
            font-size: 24px;
            font-weight: bold;
            color: #111827;
            margin-bottom: 20px;
          }
          .message-text {
            font-size: 16px;
            color: #374151;
            margin-bottom: 15px;
            line-height: 1.6;
          }
          .signature {
            margin-top: 30px;
            font-size: 16px;
            color: #111827;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            color: #9ca3af;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="title">SafeZone</h1>
            <p class="subtitle">Secure Authentication System</p>
          </div>

          <div class="content">
            <p class="greeting">Hello ${username},</p>

            <p class="message-title">Password Reset Successful</p>

            <p class="message-text">Your SafeZone account password has been successfully reset.</p>

            <p class="message-text">If you did not perform this action, please contact support immediately.</p>

            <p class="message-text">You can now log in with your new password.</p>

            <p class="signature">Best regards,<br>The SafeZone Team</p>
          </div>

          <div class="footer">
            SafeZone Security System
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset notification sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending password reset notification:', error);
    throw error;
  }
}

// Send login failure notification
async function sendLoginFailureNotification(email, username, attempts, location, country, timestamp) {
  const transporter = createTransporter();
  const credentials = getEmailCredentials();

  const mailOptions = {
    from: `"SafeZone Security" <${credentials.user}>`,
    to: email,
    subject: `SafeZone - Failed Login Attempt`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #ffffff;
            margin: 0;
            padding: 40px 20px;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            text-align: center;
          }
          .header {
            margin-bottom: 10px;
          }
          .title {
            color: #dc2626;
            font-size: 48px;
            font-weight: bold;
            margin: 0;
          }
          .subtitle {
            color: #6b7280;
            font-size: 18px;
            margin: 10px 0 40px 0;
          }
          .content {
            background-color: #f3f4f6;
            padding: 40px;
            border-radius: 8px;
            text-align: left;
          }
          .greeting {
            font-size: 16px;
            color: #111827;
            margin-bottom: 20px;
          }
          .message-title {
            font-size: 24px;
            font-weight: bold;
            color: #111827;
            margin-bottom: 10px;
          }
          .message-text {
            font-size: 16px;
            color: #374151;
            margin-bottom: 30px;
          }
          .details-title {
            font-size: 18px;
            font-weight: bold;
            color: #111827;
            margin-bottom: 15px;
          }
          .detail-item {
            font-size: 16px;
            color: #374151;
            margin: 8px 0;
            line-height: 1.6;
          }
          .instructions {
            margin-top: 30px;
            font-size: 15px;
            color: #374151;
            line-height: 1.8;
          }
          .signature {
            margin-top: 30px;
            font-size: 16px;
            color: #111827;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            color: #9ca3af;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="title">SafeZone</h1>
            <p class="subtitle">Secure Authentication System</p>
          </div>

          <div class="content">
            <p class="greeting">Hello ${username},</p>

            <p class="message-title">Failed Login Attempt Detected</p>
            <p class="message-text">We detected a failed login attempt on your SafeZone account.</p>

            <p class="details-title">Attempt Details:</p>
            <div class="detail-item">GPS coordinate: ${location || 'Unknown'}</div>
            <div class="detail-item">Country: ${country || 'Unknown'}</div>
            <div class="detail-item">Time: ${new Date(timestamp).toLocaleString()}</div>

            <div class="instructions">
              If this was you, you can safely ignore this email<br>
              If this wasn't you, please secure your account immediately by changing your password<br>
              Consider enabling two-factor authentication if available<br>
              Check your account for any unauthorized access
            </div>

            <p class="signature">Best regards,<br>The SafeZone Security Team</p>
          </div>

          <div class="footer">
            SafeZone Security System
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Login failure notification sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending login failure notification:', error);
    throw error;
  }
}

async function sendCowRecoveryNotification(email, username, cowNames, recoveryId, recoveryCode, agentId, expiresAt) {
  const transporter = createTransporter();
  const credentials = getEmailCredentials();

  // Support both array and single string for backward compatibility
  const cowNamesArray = Array.isArray(cowNames) ? cowNames : [cowNames];
  const cowCount = cowNamesArray.length;
  const cowListHtml = cowNamesArray.map(name => `<li style="margin: 5px 0;">${name}</li>`).join('');

  const mailOptions = {
    from: `"SafeZone Recovery" <${credentials.user}>`,
    to: email,
    subject: `SafeZone - Cow Recovery Request Created (${cowCount} ${cowCount === 1 ? 'Cow' : 'Cows'})`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #ffffff;
            margin: 0;
            padding: 40px 20px;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            text-align: center;
          }
          .header {
            margin-bottom: 10px;
          }
          .title {
            color: #dc2626;
            font-size: 48px;
            font-weight: bold;
            margin: 0;
          }
          .subtitle {
            color: #6b7280;
            font-size: 18px;
            margin: 10px 0 40px 0;
          }
          .content {
            background-color: #f3f4f6;
            padding: 40px;
            border-radius: 8px;
            text-align: left;
          }
          .greeting {
            font-size: 16px;
            color: #111827;
            margin-bottom: 20px;
          }
          .message-title {
            font-size: 24px;
            font-weight: bold;
            color: #111827;
            margin-bottom: 10px;
          }
          .message-text {
            font-size: 16px;
            color: #374151;
            margin-bottom: 30px;
          }
          .details-title {
            font-size: 18px;
            font-weight: bold;
            color: #111827;
            margin-bottom: 15px;
          }
          .detail-item {
            font-size: 16px;
            color: #374151;
            margin: 8px 0;
            line-height: 1.6;
          }
          .cow-list {
            background-color: #ffffff;
            padding: 20px;
            border-radius: 6px;
            margin: 15px 0;
          }
          .cow-list ul {
            margin: 0;
            padding-left: 20px;
            list-style-type: disc;
          }
          .cow-list li {
            font-size: 16px;
            color: #374151;
            margin: 5px 0;
          }
          .recovery-code {
            background-color: #dc2626;
            color: white;
            padding: 15px 30px;
            border-radius: 6px;
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 3px;
            margin: 20px 0;
            display: inline-block;
          }
          .instructions {
            margin-top: 30px;
            font-size: 15px;
            color: #374151;
            line-height: 1.8;
          }
          .signature {
            margin-top: 30px;
            font-size: 16px;
            color: #111827;
          }
          .footer {
            margin-top: 40px;
            font-size: 14px;
            color: #9ca3af;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="title">SafeZone</h1>
            <p class="subtitle">Collaborative Cow Recovery System</p>
          </div>

          <div class="content">
            <p class="greeting">Hello ${username},</p>

            <p class="message-title">Cow Recovery Request Created</p>
            <p class="message-text">A recovery request has been created for ${cowCount === 1 ? 'your lost cow' : `${cowCount} lost cows`}.</p>

            <p class="details-title">Lost ${cowCount === 1 ? 'Cow' : 'Cows'}:</p>
            <div class="cow-list">
              <ul>
                ${cowListHtml}
              </ul>
            </div>

            <p class="details-title">Recovery Details:</p>
            <div class="detail-item"><strong>Recovery ID:</strong> ${recoveryId}</div>
            <div class="detail-item"><strong>Total Cows:</strong> ${cowCount}</div>
            <div class="detail-item"><strong>Agent ID:</strong> ${agentId || 'Virtual Agent'}</div>
            <div class="detail-item"><strong>Expires:</strong> ${new Date(expiresAt).toLocaleString()}</div>

            ${recoveryCode ? `
            <div style="text-align: center; margin: 30px 0;">
              <p class="details-title">Recovery Code:</p>
              <div class="recovery-code">${recoveryCode}</div>
            </div>

            <div class="instructions">
              Share this 4-digit code with the person helping you recover your ${cowCount === 1 ? 'cow' : 'cows'}.<br>
              They will need to enter this code on the recovery page to access the tracking information.<br><br>
              The recovery code will expire on ${new Date(expiresAt).toLocaleString()}.<br>
              You can track the recovery progress in real-time through your SafeZone app.
            </div>
            ` : `
            <div class="instructions">
              This is a virtual agent recovery request.<br>
              You can track the recovery progress in real-time through your SafeZone app.<br>
              The recovery request will expire on ${new Date(expiresAt).toLocaleString()}.
            </div>
            `}

            <p class="signature">Best regards,<br>The SafeZone Recovery Team</p>
          </div>

          <div class="footer">
            SafeZone Cow Recovery System
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`Cow recovery notification sent (${cowCount} cows):`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending cow recovery notification:', error);
    throw error;
  }
}

// Send recovery completion notification
async function sendRecoveryCompletionNotification(email, username, cowNames, recoveryId, totalTime) {
  const transporter = createTransporter();
  const credentials = getEmailCredentials();

  // Support both array and single string for backward compatibility
  const cowNamesArray = Array.isArray(cowNames) ? cowNames : [cowNames];
  const cowCount = cowNamesArray.length;
  const cowListHtml = cowNamesArray.map(name => `<li style="margin: 5px 0;">${name}</li>`).join('');

  const mailOptions = {
    from: `"SafeZone Recovery" <${credentials.user}>`,
    to: email,
    subject: `SafeZone - Recovery Completed Successfully (${cowCount} ${cowCount === 1 ? 'Cow' : 'Cows'})`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #ffffff;
            margin: 0;
            padding: 40px 20px;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            text-align: center;
          }
          .header {
            margin-bottom: 10px;
          }
          .title {
            color: #22c55e;
            font-size: 48px;
            font-weight: bold;
            margin: 0;
          }
          .subtitle {
            color: #6b7280;
            font-size: 18px;
            margin: 10px 0 40px 0;
          }
          .content {
            background-color: #f0fdf4;
            padding: 40px;
            border-radius: 8px;
            text-align: left;
          }
          .greeting {
            font-size: 16px;
            color: #111827;
            margin-bottom: 20px;
          }
          .message-title {
            font-size: 24px;
            font-weight: bold;
            color: #15803d;
            margin-bottom: 10px;
          }
          .message-text {
            font-size: 16px;
            color: #374151;
            margin-bottom: 30px;
          }
          .details-title {
            font-size: 18px;
            font-weight: bold;
            color: #111827;
            margin-bottom: 15px;
          }
          .detail-item {
            font-size: 16px;
            color: #374151;
            margin: 8px 0;
            line-height: 1.6;
          }
          .cow-list {
            background-color: #ffffff;
            padding: 20px;
            border-radius: 6px;
            margin: 15px 0;
          }
          .cow-list ul {
            margin: 0;
            padding-left: 20px;
            list-style-type: disc;
          }
          .cow-list li {
            font-size: 16px;
            color: #374151;
            margin: 5px 0;
          }
          .success-badge {
            background-color: #22c55e;
            color: white;
            padding: 10px 20px;
            border-radius: 6px;
            font-size: 18px;
            font-weight: bold;
            margin: 20px 0;
            display: inline-block;
          }
          .signature {
            margin-top: 30px;
            font-size: 16px;
            color: #111827;
          }
          .footer {
            margin-top: 40px;
            font-size: 14px;
            color: #9ca3af;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="title">SafeZone</h1>
            <p class="subtitle">Collaborative Cow Recovery System</p>
          </div>

          <div class="content">
            <p class="greeting">Hello ${username},</p>

            <p class="message-title">Recovery Completed Successfully!</p>
            <p class="message-text">Great news! All ${cowCount === 1 ? 'your cow has' : `${cowCount} cows have`} been successfully recovered and returned to the safe zone.</p>

            <div style="text-align: center;">
              <div class="success-badge">All Cows Safe</div>
            </div>

            <p class="details-title">Recovered ${cowCount === 1 ? 'Cow' : 'Cows'}:</p>
            <div class="cow-list">
              <ul>
                ${cowListHtml}
              </ul>
            </div>

            <p class="details-title">Recovery Summary:</p>
            <div class="detail-item"><strong>Recovery ID:</strong> ${recoveryId}</div>
            <div class="detail-item"><strong>Total Cows Recovered:</strong> ${cowCount}</div>
            ${totalTime ? `<div class="detail-item"><strong>Total Time:</strong> ${totalTime}</div>` : ''}
            <div class="detail-item"><strong>Completed:</strong> ${new Date().toLocaleString()}</div>

            <p class="message-text" style="margin-top: 30px;">
              Thank you for using SafeZone's collaborative recovery system. Your livestock are now safely back inside the fence.
            </p>

            <p class="signature">Best regards,<br>The SafeZone Recovery Team</p>
          </div>

          <div class="footer">
            SafeZone Cow Recovery System
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`Recovery completion notification sent (${cowCount} cows):`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending recovery completion notification:', error);
    throw error;
  }
}

// Send zone2 breach alarm notification
async function sendZone2BreachEmail(email, username, cowData) {
  const transporter = createTransporter();
  const credentials = getEmailCredentials();

  const mailOptions = {
    from: `"SafeZone Alerts" <${credentials.user}>`,
    to: email,
    subject: `SafeZone ALERT - ${cowData.cowNickname || cowData.cowName} in Warning Zone`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background-color: #f5f5f5;
            margin: 0;
            padding: 40px 20px;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 8px;
            overflow: hidden;
          }
          .header {
            text-align: center;
            padding: 40px 20px 20px 20px;
            background-color: #ffffff;
          }
          .title {
            color: #dc2626;
            font-size: 48px;
            font-weight: bold;
            margin: 0;
          }
          .subtitle {
            color: #6b7280;
            font-size: 18px;
            margin: 10px 0 0 0;
            font-weight: 400;
          }
          .content {
            padding: 40px;
            text-align: left;
          }
          .info-item {
            font-size: 24px;
            margin: 20px 0;
            line-height: 1.5;
          }
          .label {
            font-weight: bold;
            color: #111827;
          }
          .value {
            font-weight: 400;
            color: #4b5563;
          }
          .section-title {
            font-size: 32px;
            font-weight: bold;
            color: #111827;
            margin: 40px 0 20px 0;
          }
          .alert-message {
            font-size: 20px;
            color: #4b5563;
            line-height: 1.6;
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="title">SafeZone</h1>
            <p class="subtitle">Intelligent Cow Tracking & Farm Management</p>
          </div>

          <div class="content">
            <div class="info-item"><span class="label">Cow Name:</span> <span class="value">${cowData.cowName || cowData.cowNickname || cowData.cowToken}</span></div>
            <div class="info-item"><span class="label">Alarm Type:</span> <span class="value">warning zone</span></div>
            <div class="info-item"><span class="label">Speed:</span> <span class="value">N/A</span></div>
            <div class="info-item"><span class="label">Tag:</span> <span class="value">roaming</span></div>
            <div class="info-item"><span class="label">Time:</span> <span class="value">${new Date(cowData.timestamp).toLocaleString('en-CA', { hour12: false }).replace(',', ',')}</span></div>
            <div class="info-item"><span class="label">Position:</span> <span class="value">${cowData.latitude}, ${cowData.longitude}</span></div>

            <div class="section-title">Alert Details</div>
            <p class="alert-message">Cow has entered warning zone (0-50m outside fence).</p>
            <p class="alert-message">Attention required for livestock safety.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Zone2 breach email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending zone2 breach email:', error);
    throw error;
  }
}

// Send line2 breach alarm notification
async function sendLine2BreachEmail(email, username, cowData) {
  const transporter = createTransporter();
  const credentials = getEmailCredentials();

  const mailOptions = {
    from: `"SafeZone Alerts" <${credentials.user}>`,
    to: email,
    subject: `SafeZone ALERT - ${cowData.cowNickname || cowData.cowName} in DANGER ZONE`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background-color: #f5f5f5;
            margin: 0;
            padding: 40px 20px;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 8px;
            overflow: hidden;
          }
          .header {
            text-align: center;
            padding: 40px 20px 20px 20px;
            background-color: #ffffff;
          }
          .title {
            color: #dc2626;
            font-size: 48px;
            font-weight: bold;
            margin: 0;
          }
          .subtitle {
            color: #6b7280;
            font-size: 18px;
            margin: 10px 0 0 0;
            font-weight: 400;
          }
          .content {
            padding: 40px;
            text-align: left;
          }
          .info-item {
            font-size: 24px;
            margin: 20px 0;
            line-height: 1.5;
          }
          .label {
            font-weight: bold;
            color: #111827;
          }
          .value {
            font-weight: 400;
            color: #4b5563;
          }
          .section-title {
            font-size: 32px;
            font-weight: bold;
            color: #111827;
            margin: 40px 0 20px 0;
          }
          .alert-message {
            font-size: 20px;
            color: #4b5563;
            line-height: 1.6;
            margin: 20px 0;
          }
          .recovery-link {
            display: inline-block;
            background-color: #dc2626;
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: bold;
            margin: 20px 0;
            font-size: 18px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="title">SafeZone</h1>
            <p class="subtitle">Intelligent Cow Tracking & Farm Management</p>
          </div>

          <div class="content">
            <div class="info-item"><span class="label">Cow Name:</span> <span class="value">${cowData.cowName || cowData.cowNickname || cowData.cowToken}</span></div>
            <div class="info-item"><span class="label">Alarm Type:</span> <span class="value">danger zone</span></div>
            <div class="info-item"><span class="label">Speed:</span> <span class="value">N/A</span></div>
            <div class="info-item"><span class="label">Tag:</span> <span class="value">emergency</span></div>
            <div class="info-item"><span class="label">Time:</span> <span class="value">${new Date(cowData.timestamp).toLocaleString('en-CA', { hour12: false }).replace(',', ',')}</span></div>
            <div class="info-item"><span class="label">Position:</span> <span class="value">${cowData.latitude}, ${cowData.longitude}</span></div>

            <div class="section-title">Alert Details</div>
            <p class="alert-message">URGENT: Cow has crossed into the danger zone (more than 50 meters outside the fence).</p>
            <p class="alert-message">Immediate action required for livestock safety and recovery.</p>

            <div style="text-align: center; margin-top: 30px;">
              <a href="${process.env.APP_URL || 'http://localhost:3000'}/html/page17_collaborative-cow-recovery.html?cow=${cowData.cowToken}" class="recovery-link">
                Start Collaborative Recovery
              </a>
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Line2 breach email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending line2 breach email:', error);
    throw error;
  }
}

// msg7 — Daily Report
async function sendDailyReportEmail(email, username, report) {
  const transporter = createTransporter();
  const credentials = getEmailCredentials();
  const date = new Date().toLocaleDateString('en-CA');

  const mailOptions = {
    from: `"SafeZone Reports" <${credentials.user}>`,
    to: email,
    subject: `SafeZone - Daily Report ${date}`,
    html: `
      <!DOCTYPE html><html><head><style>
        body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 40px 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; }
        .header { text-align: center; padding: 40px 20px 20px; }
        .title { color: #dc2626; font-size: 48px; font-weight: bold; margin: 0; }
        .subtitle { color: #6b7280; font-size: 18px; margin: 10px 0 0; }
        .content { padding: 40px; }
        .section-title { font-size: 22px; font-weight: bold; color: #111827; margin: 30px 0 15px; border-bottom: 2px solid #f3f4f6; padding-bottom: 8px; }
        .stat-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-size: 16px; color: #374151; }
        .stat-label { font-weight: 600; color: #111827; }
        .stat-value { color: #4b5563; }
        .footer { text-align: center; padding: 20px; color: #9ca3af; font-size: 14px; }
      </style></head><body>
      <div class="container">
        <div class="header">
          <h1 class="title">SafeZone</h1>
          <p class="subtitle">Daily Farm Report — ${date}</p>
        </div>
        <div class="content">
          <p style="font-size:16px;color:#111827;">Hello ${username},</p>
          <p style="font-size:16px;color:#374151;">Here is your daily summary for ${date}.</p>
          <div class="section-title">Livestock Summary</div>
          <div class="stat-row"><span class="stat-label">Total cows</span><span class="stat-value">${report.totalCows}</span></div>
          <div class="stat-row"><span class="stat-label">Cows inside fence</span><span class="stat-value">${report.cowsInside}</span></div>
          <div class="stat-row"><span class="stat-label">Cows outside fence</span><span class="stat-value">${report.cowsOutside}</span></div>
          <div class="section-title">Breach Activity Today</div>
          <div class="stat-row"><span class="stat-label">Total breaches</span><span class="stat-value">${report.breachesToday}</span></div>
          <div class="stat-row"><span class="stat-label">Farms monitored</span><span class="stat-value">${report.totalFarms}</span></div>
          <p style="margin-top:30px;font-size:15px;color:#6b7280;">This report is generated automatically every day at 23:59.</p>
          <p style="font-size:16px;color:#111827;margin-top:20px;">Best regards,<br>The SafeZone Team</p>
        </div>
        <div class="footer">SafeZone Monitoring System</div>
      </div>
      </body></html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`Daily report sent to ${email}:`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending daily report email:', error);
    throw error;
  }
}

// msg8 — New ESP32 connected
async function sendESP32ConnectedEmail(email, username, deviceId, macAddress) {
  const transporter = createTransporter();
  const credentials = getEmailCredentials();

  const mailOptions = {
    from: `"SafeZone Alerts" <${credentials.user}>`,
    to: email,
    subject: 'SafeZone - New Collar Device Connected',
    html: `
      <!DOCTYPE html><html><head><style>
        body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 40px 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; }
        .header { text-align: center; padding: 40px 20px 20px; }
        .title { color: #dc2626; font-size: 48px; font-weight: bold; margin: 0; }
        .subtitle { color: #6b7280; font-size: 18px; margin: 10px 0 0; }
        .content { padding: 40px; text-align: left; }
        .info-item { font-size: 18px; margin: 15px 0; color: #374151; }
        .label { font-weight: bold; color: #111827; }
        .footer { text-align: center; padding: 20px; color: #9ca3af; font-size: 14px; }
      </style></head><body>
      <div class="container">
        <div class="header">
          <h1 class="title">SafeZone</h1>
          <p class="subtitle">Device Management</p>
        </div>
        <div class="content">
          <p style="font-size:16px;color:#111827;">Hello ${username},</p>
          <p style="font-size:16px;color:#374151;margin-bottom:30px;">A new ESP32 collar device has connected to your SafeZone account.</p>
          <div class="info-item"><span class="label">Device ID:</span> ${deviceId}</div>
          <div class="info-item"><span class="label">MAC Address:</span> ${macAddress}</div>
          <div class="info-item"><span class="label">Connected at:</span> ${new Date().toLocaleString()}</div>
          <p style="margin-top:30px;font-size:15px;color:#6b7280;">If you did not register this device, please contact support immediately.</p>
          <p style="font-size:16px;color:#111827;margin-top:20px;">Best regards,<br>The SafeZone Team</p>
        </div>
        <div class="footer">SafeZone Device Management System</div>
      </div>
      </body></html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`ESP32 connected email sent to ${email}:`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending ESP32 connected email:', error);
    throw error;
  }
}

async function sendESP32OfflineEmail(email, username, cowName, macAddress) {
  const transporter = createTransporter();
  const credentials = getEmailCredentials();

  const mailOptions = {
    from: `"SafeZone Alerts" <${credentials.user}>`,
    to: email,
    subject: 'SafeZone - ESP32 Collar Went Offline',
    html: `
      <!DOCTYPE html><html><head><style>
        body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 40px 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; }
        .header { text-align: center; padding: 40px 20px 20px; }
        .title { color: #dc2626; font-size: 48px; font-weight: bold; margin: 0; }
        .subtitle { color: #6b7280; font-size: 18px; margin: 10px 0 0; }
        .alert-banner { background: #fef2f2; border-left: 4px solid #dc2626; padding: 16px 24px; margin: 0 40px; border-radius: 4px; }
        .alert-text { color: #991b1b; font-size: 16px; font-weight: bold; margin: 0; }
        .content { padding: 30px 40px; text-align: left; }
        .info-item { font-size: 16px; margin: 12px 0; color: #374151; }
        .label { font-weight: bold; color: #111827; }
        .footer { text-align: center; padding: 20px; color: #9ca3af; font-size: 14px; }
      </style></head><body>
      <div class="container">
        <div class="header">
          <h1 class="title">SafeZone</h1>
          <p class="subtitle">Collar Alert</p>
        </div>
        <div class="alert-banner">
          <p class="alert-text">ESP32 Collar Offline</p>
        </div>
        <div class="content">
          <p style="font-size:16px;color:#111827;">Hello ${username},</p>
          <p style="font-size:16px;color:#374151;margin-bottom:24px;">One of your ESP32 collar devices has gone offline and is no longer transmitting location data.</p>
          <div class="info-item"><span class="label">Cow:</span> ${cowName}</div>
          <div class="info-item"><span class="label">MAC Address:</span> ${macAddress}</div>
          <div class="info-item"><span class="label">Offline at:</span> ${new Date().toLocaleString()}</div>
          <p style="margin-top:24px;font-size:15px;color:#6b7280;">Please check the collar device's power and Wi-Fi connection. The system will resume tracking automatically when the collar reconnects.</p>
          <p style="font-size:16px;color:#111827;margin-top:20px;">Best regards,<br>The SafeZone Team</p>
        </div>
        <div class="footer">SafeZone Tracking System — You can disable these alerts in Customize Alerts settings.</div>
      </div>
      </body></html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`ESP32 offline email sent to ${email}:`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending ESP32 offline email:', error);
    throw error;
  }
}

// msg8 — New cow registered (ESP32 or virtual)
async function sendNewCowRegisteredEmail(email, username, cowName, collarId, cowType) {
  const transporter = createTransporter();
  const credentials = getEmailCredentials();
  const isVirtual = cowType === 'virtual';
  const typeLabel = isVirtual ? 'Virtual Cow' : 'ESP32 Collar';

  const mailOptions = {
    from: `"SafeZone Alerts" <${credentials.user}>`,
    to: email,
    subject: `SafeZone - New ${typeLabel} Registered`,
    html: `
      <!DOCTYPE html><html><head><style>
        body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 40px 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; }
        .header { text-align: center; padding: 40px 20px 20px; }
        .title { color: #dc2626; font-size: 48px; font-weight: bold; margin: 0; }
        .subtitle { color: #6b7280; font-size: 18px; margin: 10px 0 0; }
        .content { padding: 40px; text-align: left; }
        .info-item { font-size: 18px; margin: 15px 0; color: #374151; }
        .label { font-weight: bold; color: #111827; }
        .footer { text-align: center; padding: 20px; color: #9ca3af; font-size: 14px; }
      </style></head><body>
      <div class="container">
        <div class="header">
          <h1 class="title">SafeZone</h1>
          <p class="subtitle">Cow Management</p>
        </div>
        <div class="content">
          <p style="font-size:16px;color:#111827;">Hello ${username},</p>
          <p style="font-size:16px;color:#374151;margin-bottom:30px;">A new ${typeLabel.toLowerCase()} has been registered to your SafeZone account.</p>
          <div class="info-item"><span class="label">Cow Name:</span> ${cowName}</div>
          <div class="info-item"><span class="label">Collar ID:</span> ${collarId}</div>
          <div class="info-item"><span class="label">Type:</span> ${typeLabel}</div>
          <div class="info-item"><span class="label">Registered at:</span> ${new Date().toLocaleString()}</div>
          <p style="margin-top:30px;font-size:15px;color:#6b7280;">If you did not register this cow, please contact support immediately.</p>
          <p style="font-size:16px;color:#111827;margin-top:20px;">Best regards,<br>The SafeZone Team</p>
        </div>
        <div class="footer">SafeZone Cow Management System</div>
      </div>
      </body></html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`New cow registered email sent to ${email}:`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending new cow registered email:', error);
    throw error;
  }
}

module.exports = {
  sendConfirmationEmail,
  sendRecoveryCodeEmail,
  sendPasswordResetNotification,
  sendLoginFailureNotification,
  sendCowRecoveryNotification,
  sendRecoveryCompletionNotification,
  sendZone2BreachEmail,
  sendLine2BreachEmail,
  sendDailyReportEmail,
  sendESP32ConnectedEmail,
  sendESP32OfflineEmail,
  sendNewCowRegisteredEmail
};
