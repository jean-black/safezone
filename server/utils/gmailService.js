const nodemailer = require('nodemailer');
const { db } = require('../config/database');
require('dotenv').config();

class GmailService {
    constructor() {
        this.transporter = null; // Will be created on-demand
    }

    /**
     * Get email credentials from dbt032
     * Falls back to environment variables or defaults if database is unavailable
     */
    getEmailCredentials() {
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
     * Get or create transporter with current credentials
     */
    getTransporter() {
        const credentials = this.getEmailCredentials();

        // Always create fresh transporter to get latest credentials
        return nodemailer.createTransport({
            service: 'gmail',
            auth: credentials
        });
    }

    async sendAlert(to, subject, message, attachments = []) {
        try {
            const transporter = this.getTransporter();
            const credentials = this.getEmailCredentials();

            const mailOptions = {
                from: credentials.user,
                to: to || 'jeanclaudemng@gmail.com',
                subject: `SafeZone Alert: ${subject}`,
                html: this.generateEmailTemplate(subject, message),
                attachments: attachments
            };

            const result = await transporter.sendMail(mailOptions);
            console.log('Email sent successfully:', result.messageId);
            return { success: true, messageId: result.messageId };
        } catch (error) {
            console.error('Email sending error:', error);
            return { success: false, error: error.message };
        }
    }

    async sendDaily24MPF(to, megaLink, reportDate) {
        const subject = `Daily Farm Report - ${reportDate}`;
        const message = `
            <h2>SafeZone Daily Report</h2>
            <p>Your daily farm report for <strong>${reportDate}</strong> is ready for download.</p>
            <p><strong>Report includes:</strong></p>
            <ul>
                <li>Summary of all alarm activities</li>
                <li>Cow behavior analysis</li>
                <li>Fence breach statistics</li>
                <li>System health monitoring</li>
                <li>Collaborative recovery activities</li>
            </ul>
            <p><a href="${megaLink}" style="background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 20px 0;">Download Report from MEGA</a></p>
            <p><small>This report is automatically generated at 23:59 daily. The file will be available for download for 30 days.</small></p>
        `;

        return await this.sendAlert(to, subject, message);
    }

    async sendBreachAlert(to, cowId, alarmType, location, timestamp) {
        const subject = `Cow Breach Alert - ${cowId}`;
        const message = `
            <h2>Cow Breach Alert</h2>
            <div style="background-color: #fee2e2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p><strong>Cow ID:</strong> ${cowId}</p>
                <p><strong>Alarm Type:</strong> ${alarmType}</p>
                <p><strong>Location:</strong> ${location}</p>
                <p><strong>Time:</strong> ${timestamp}</p>
            </div>
            <p><strong>Action Required:</strong> Please check the cow's location and guide it back to the safe zone.</p>
            <p><a href="${process.env.APP_URL || 'http://localhost:3000'}/html/page6_real-time-tracking.html" style="background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 20px 0;">View Real-time Tracking</a></p>
        `;

        return await this.sendAlert(to, subject, message);
    }

    async sendSystemAlert(to, alertType, message, details = {}) {
        const subject = `System Alert - ${alertType}`;
        const emailMessage = `
            <h2>System Alert</h2>
            <div style="background-color: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p><strong>Alert Type:</strong> ${alertType}</p>
                <p><strong>Message:</strong> ${message}</p>
                ${Object.keys(details).length > 0 ? `
                    <p><strong>Details:</strong></p>
                    <ul>
                        ${Object.entries(details).map(([key, value]) => `<li><strong>${key}:</strong> ${value}</li>`).join('')}
                    </ul>
                ` : ''}
            </div>
            <p>Please check your SafeZone dashboard for more information.</p>
            <p><a href="${process.env.APP_URL || 'http://localhost:3000'}/html/page2_dashboard.html" style="background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 20px 0;">Go to Dashboard</a></p>
        `;

        return await this.sendAlert(to, subject, emailMessage);
    }

    async sendCollaborativeRequest(to, cowId, employerName, ephemeralLink) {
        const subject = `Cow Recovery Request - ${cowId}`;
        const message = `
            <h2>Collaborative Cow Recovery Request</h2>
            <p>Hello,</p>
            <p><strong>${employerName}</strong> has requested your assistance in recovering a lost cow.</p>
            <div style="background-color: #dbeafe; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p><strong>Cow ID:</strong> ${cowId}</p>
                <p><strong>Status:</strong> Outside fence boundary</p>
                <p><strong>Urgency:</strong> Immediate assistance needed</p>
            </div>
            <p>Click the link below to accept this collaborative recovery request:</p>
            <p><a href="${ephemeralLink}" style="background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 20px 0;">Accept Recovery Request</a></p>
            <p><small>This link will expire in 2 hours for security reasons.</small></p>
        `;

        return await this.sendAlert(to, subject, message);
    }

    async sendCollaborativeCompletion(to, cowId, employeeName, duration) {
        const subject = `Recovery Completed - ${cowId}`;
        const message = `
            <h2>Cow Recovery Completed</h2>
            <p>Great news! The collaborative cow recovery has been completed successfully.</p>
            <div style="background-color: #d1fae5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p><strong>Cow ID:</strong> ${cowId}</p>
                <p><strong>Recovery Assistant:</strong> ${employeeName}</p>
                <p><strong>Duration:</strong> ${duration}</p>
                <p><strong>Status:</strong> Cow safely returned to fence</p>
            </div>
            <p>Thank you for using SafeZone's collaborative recovery system!</p>
        `;

        return await this.sendAlert(to, subject, message);
    }

    async sendDataArchiveNotification(to, tableNames, megaLinks) {
        const subject = 'Data Archive Notification';
        const message = `
            <h2>Data Archive Notification</h2>
            <p>The following data tables have reached their storage limit and have been archived to MEGA:</p>
            <div style="background-color: #f3f4f6; border: 1px solid #d1d5db; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <ul>
                    ${tableNames.map((table, index) => `
                        <li><strong>${table}:</strong> <a href="${megaLinks[index]}">Download from MEGA</a></li>
                    `).join('')}
                </ul>
            </div>
            <p>The original tables have been cleared to maintain system performance.</p>
            <p>All archived data remains accessible through the provided MEGA links.</p>
        `;

        return await this.sendAlert(to, subject, message);
    }

    generateEmailTemplate(subject, content) {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${subject}</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                    background-color: #f9fafb;
                }
                .container {
                    background-color: white;
                    border-radius: 12px;
                    padding: 30px;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                }
                .header {
                    text-align: center;
                    border-bottom: 2px solid #dc2626;
                    padding-bottom: 20px;
                    margin-bottom: 30px;
                }
                .logo {
                    font-family: 'Fort', serif;
                    font-size: 2rem;
                    font-weight: 700;
                    color: #dc2626;
                    margin: 0;
                }
                .tagline {
                    color: #6b7280;
                    font-size: 0.9rem;
                    margin-top: 5px;
                }
                .content {
                    font-size: 16px;
                    line-height: 1.6;
                }
                .footer {
                    border-top: 1px solid #e5e7eb;
                    padding-top: 20px;
                    margin-top: 30px;
                    text-align: center;
                    color: #6b7280;
                    font-size: 0.875rem;
                }
                a {
                    color: #dc2626;
                    text-decoration: none;
                }
                a:hover {
                    text-decoration: underline;
                }
                .btn {
                    display: inline-block;
                    padding: 12px 24px;
                    background-color: #dc2626;
                    color: white !important;
                    text-decoration: none;
                    border-radius: 8px;
                    font-weight: 600;
                    margin: 20px 0;
                }
                .btn:hover {
                    background-color: #b91c1c;
                    text-decoration: none;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1 class="logo">SafeZone</h1>
                    <p class="tagline">Intelligent Cow Tracking & Farm Management</p>
                </div>
                
                <div class="content">
                    ${content}
                </div>
                
                <div class="footer">
                    <p><strong>SafeZone</strong> - Developed by Jean Claude & Samuel</p>
                    <p>Near East University - 2025-2026 - v1.0.0</p>
                    <p>This is an automated message from your SafeZone system.</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    async testConnection() {
        try {
            const transporter = this.getTransporter();
            await transporter.verify();
            console.log('Gmail service connection verified');
            return true;
        } catch (error) {
            console.error('Gmail service connection failed:', error);
            return false;
        }
    }
}

module.exports = new GmailService();