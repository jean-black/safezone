const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');

/**
 * GET /api/settings/email
 * Get current email settings from dbt032
 * Developer only
 */
router.get('/email', authenticateToken, (req, res) => {
  try {
    const userType = req.user.userType;

    // Only developers can access settings
    if (userType !== 'developer') {
      return res.status(403).json({ error: 'Access denied. Developers only.' });
    }

    // Get current settings from dbt032
    const settings = db.prepare('SELECT email, email_app_passcode, developer_passcode FROM dbt032 WHERE id = 1').get();

    if (!settings) {
      // Return defaults if no settings exist
      return res.json({
        email: 'modeblackmng@gmail.com',
        email_app_passcode: 'ulxnwsvdpnnojutm',
        developer_passcode: '2323'
      });
    }

    res.json(settings);
  } catch (error) {
    console.error('Error getting email settings:', error);
    res.status(500).json({ error: 'Failed to get email settings' });
  }
});

/**
 * PUT /api/settings/email
 * Update email settings in dbt032
 * Developer only
 */
router.put('/email', authenticateToken, async (req, res) => {
  try {
    const userType = req.user.userType;
    const developerEmail = req.user.farmerId || req.user.developerId; // Get developer's email from JWT
    const { email, email_app_passcode, developer_password } = req.body;

    // Only developers can update settings
    if (userType !== 'developer') {
      return res.status(403).json({ error: 'Access denied. Developers only.' });
    }

    // Validate inputs
    if (!email || !email_app_passcode || !developer_password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Verify developer password
    try {
      const developer = db.prepare('SELECT password FROM dbt010 WHERE email = ?').get(developerEmail);

      if (!developer) {
        return res.status(401).json({ error: 'Developer account not found' });
      }

      const passwordMatch = await bcrypt.compare(developer_password, developer.password);

      if (!passwordMatch) {
        return res.status(401).json({ error: 'Incorrect developer password' });
      }
    } catch (authError) {
      console.error('❌ Developer password verification failed:', authError);
      return res.status(401).json({ error: 'Password verification failed' });
    }

    // Validate email format
    if (!email.includes('@gmail.com')) {
      return res.status(400).json({ error: 'Please use a Gmail address' });
    }

    // Validate app password length (16 characters for Gmail)
    const cleanedPasscode = email_app_passcode.replace(/\s+/g, '');
    if (cleanedPasscode.length !== 16) {
      return res.status(400).json({ error: 'Gmail app password must be 16 characters' });
    }

    // Test the email credentials before saving
    let testTransporter;
    try {
      testTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: email,
          pass: cleanedPasscode
        }
      });

      await testTransporter.verify();
      console.log('✅ Email credentials verified successfully');
    } catch (emailError) {
      console.error('❌ Email credential verification failed:', emailError);
      return res.status(400).json({
        error: 'Invalid email credentials. Please check your email and app password.',
        details: emailError.message
      });
    }

    // Send test email to developer
    try {
      const mailOptions = {
        from: `"SafeZone System" <${email}>`,
        to: developerEmail,
        subject: 'SafeZone - Email Settings Updated',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #dc2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background-color: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
              .success-badge { background-color: #10b981; color: white; padding: 10px 20px; border-radius: 6px; display: inline-block; font-weight: bold; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>SafeZone</h1>
              </div>
              <div class="content">
                <h2>Email Settings Updated Successfully</h2>
                <div class="success-badge">✓ SUCCESS</div>
                <p>This is a confirmation that your SafeZone system email settings have been updated.</p>
                <p><strong>New System Email:</strong> ${email}</p>
                <p><strong>Updated By:</strong> ${developerEmail}</p>
                <p><strong>Update Date:</strong> ${new Date().toLocaleString()}</p>
                <p>All system notifications will now be sent from the new email address.</p>
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; font-size: 14px;">
                  <strong>SafeZone</strong> - Intelligent Cow Tracking & Farm Management<br>
                  Developed by Jean Claude & Samuel<br>
                  Near East University - 2025-2026 - v1.0.0
                </p>
              </div>
            </div>
          </body>
          </html>
        `
      };

      await testTransporter.sendMail(mailOptions);
      console.log('✅ Test email sent to developer:', developerEmail);
    } catch (emailSendError) {
      console.error('❌ Failed to send test email:', emailSendError);
      return res.status(500).json({
        error: 'Email credentials are valid but failed to send test email',
        details: emailSendError.message
      });
    }

    // Update settings in dbt032
    const updateStmt = db.prepare(`
      UPDATE dbt032
      SET email = ?,
          email_app_passcode = ?
      WHERE id = 1
    `);

    updateStmt.run(email, cleanedPasscode);

    console.log(`✅ Email settings updated: ${email}`);

    // Update environment variables for current session
    process.env.GMAIL_USER = email;
    process.env.GMAIL_APP_PASSWORD = cleanedPasscode;

    res.json({
      success: true,
      message: 'Email settings updated successfully. Test email sent.',
      email: email
    });
  } catch (error) {
    console.error('Error updating email settings:', error);
    res.status(500).json({ error: 'Failed to update email settings' });
  }
});

/**
 * POST /api/settings/test-email
 * Send a test email to verify credentials
 * Developer only
 */
router.post('/test-email', authenticateToken, async (req, res) => {
  try {
    const userType = req.user.userType;
    const { email, email_app_passcode } = req.body;

    // Only developers can test email
    if (userType !== 'developer') {
      return res.status(403).json({ error: 'Access denied. Developers only.' });
    }

    // Validate inputs
    if (!email || !email_app_passcode) {
      return res.status(400).json({ error: 'Email and app password are required' });
    }

    const cleanedPasscode = email_app_passcode.replace(/\s+/g, '');

    // Create test transporter
    const testTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: email,
        pass: cleanedPasscode
      }
    });

    // Send test email
    const mailOptions = {
      from: `"SafeZone System" <${email}>`,
      to: email,
      subject: 'SafeZone - Email Configuration Test',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #dc2626;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 8px 8px 0 0;
            }
            .content {
              background-color: #f9fafb;
              padding: 30px;
              border-radius: 0 0 8px 8px;
            }
            .success-badge {
              background-color: #10b981;
              color: white;
              padding: 10px 20px;
              border-radius: 6px;
              display: inline-block;
              font-weight: bold;
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>SafeZone</h1>
            </div>
            <div class="content">
              <h2>Email Configuration Test</h2>
              <div class="success-badge">✓ SUCCESS</div>
              <p>This is a test email to verify your SafeZone email configuration.</p>
              <p><strong>Email Address:</strong> ${email}</p>
              <p><strong>Test Date:</strong> ${new Date().toLocaleString()}</p>
              <p>If you received this email, your email settings are configured correctly!</p>
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 14px;">
                <strong>SafeZone</strong> - Intelligent Cow Tracking & Farm Management<br>
                Developed by Jean Claude & Samuel<br>
                Near East University - 2025-2026 - v1.0.0
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    const info = await testTransporter.sendMail(mailOptions);

    console.log('✅ Test email sent:', info.messageId);

    res.json({
      success: true,
      message: 'Test email sent successfully',
      messageId: info.messageId,
      recipient: email
    });
  } catch (error) {
    console.error('❌ Error sending test email:', error);
    res.status(500).json({
      error: 'Failed to send test email',
      details: error.message
    });
  }
});

module.exports = router;
