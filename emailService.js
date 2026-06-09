const nodemailer = require('nodemailer');

class EmailService {
    constructor() {
        this.transporter = null;
        this.isDevMode = !process.env.SMTP_HOST;
        this.init();
    }
    
    init() {
        if (this.isDevMode) {
            console.log('[Email] Dev mode: emails will be logged to console/file instead of sent');
            return;
        }
        
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
        
        console.log('[Email] SMTP transport configured for', process.env.SMTP_HOST);
    }
    
    async sendVerificationEmail(to, code) {
        const subject = 'Chessopia - Your Verification Code';
        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px; }
        .container { max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; }
        .code { font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #333; background: #f0f0f0; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0; }
        .footer { font-size: 12px; color: #999; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Welcome to Chessopia!</h2>
        <p>Your verification code is:</p>
        <div class="code">${code}</div>
        <p>This code expires in 10 minutes.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
        <div class="footer">Chessopia - 3D Infinite Chess</div>
    </div>
</body>
</html>
        `;
        
        const text = `Welcome to Chessopia!\n\nYour verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, you can safely ignore this email.`;
        
        if (this.isDevMode) {
            await this.logDevEmail(to, subject, text, code);
            return;
        }
        
        try {
            await this.transporter.sendMail({
                from: process.env.FROM_EMAIL || 'noreply@chesiopia.local',
                to,
                subject,
                text,
                html
            });
        } catch (error) {
            console.error('[Email] Failed to send email:', error);
            throw error;
        }
    }
    
    async logDevEmail(to, subject, text, code) {
        const timestamp = new Date().toISOString();
        const logEntry = `
========================================
[DEV EMAIL] ${timestamp}
To: ${to}
Subject: ${subject}
Code: ${code}
----------------------------------------
${text}
========================================
`;
        
        console.log(logEntry);
        
        // Also write to a file for easy reference
        const fs = require('fs');
        const path = require('path');
        const logFile = path.join(__dirname, 'data', 'dev-emails.log');
        
        try {
            fs.appendFileSync(logFile, logEntry);
        } catch (err) {
            console.error('[Email] Could not write to dev email log:', err);
        }
    }
}

module.exports = EmailService;
