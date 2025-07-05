const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const User = require('../models/User');

// --- Helper Functions ---

// Multer for image uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) return cb(null, true);
        cb('Error: Only image files are allowed!');
    }
}).single('profileImage');

// Nodemailer transporter
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_PORT == 465,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --- NEW: Themed Email Template Function ---
const createStyledEmail = (title, preheader, bodyContent, button) => {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: 'Inter', Arial, sans-serif; margin: 0; padding: 0; background-color: #fefce8; }
            .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border: 1px solid #fde68a; border-radius: 12px; overflow: hidden; }
            .header { background-color: #facc15; padding: 20px; text-align: center; color: #422006; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { padding: 30px; color: #374151; line-height: 1.6; }
            .content p { margin: 0 0 15px 0; }
            .otp { font-size: 32px; font-weight: bold; color: #d97706; text-align: center; letter-spacing: 5px; margin: 20px 0; }
            .button-container { text-align: center; margin: 30px 0; }
            .button { background-color: #facc15; color: #422006; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; }
            .footer { background-color: #fef3c7; padding: 20px; text-align: center; font-size: 12px; color: #78350f; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header"><h1>Coatcard AI</h1></div>
            <div class="content">
                <p style="font-size: 18px; font-weight: bold;">${title}</p>
                <p>${preheader}</p>
                ${bodyContent}
                ${button ? `<div class="button-container"><a href="${button.url}" class="button">${button.text}</a></div>` : ''}
                <p>If you did not request this, please ignore this email.</p>
                <p>Thanks,<br>The Coatcard AI Team</p>
            </div>
            <div class="footer">
                &copy; ${new Date().getFullYear()} Coatcard AI. All rights reserved.
            </div>
        </div>
    </body>
    </html>`;
};


// ----- REGISTRATION -----
router.post('/register', (req, res) => {
    upload(req, res, async (err) => {
        if (err) return res.render('register', { msg: err });
        const { username, email, password, role, fieldOfWork, goal } = req.body;
        if (!username || !email || !password || !role || !fieldOfWork || !goal) return res.render('register', { msg: 'All fields are required.' });

        try {
            const existingUser = await User.findOne({ email });
            const otp = crypto.randomInt(100000, 999999).toString();

            if (existingUser && existingUser.isVerified) {
                return res.render('register', { msg: 'Email already registered. Please log in.' });
            }
            if (existingUser && !existingUser.isVerified) {
                existingUser.otp = otp;
                existingUser.otpExpires = Date.now() + 10 * 60 * 1000;
                await existingUser.save();
            } else {
                const newUser = new User({ username, email, password, role, fieldOfWork, goal, otp, otpExpires: Date.now() + 10 * 60 * 1000 });
                if (req.file) {
                    newUser.profileImage = { data: req.file.buffer, contentType: req.file.mimetype };
                }
                await newUser.save();
            }
            
            const emailBody = `<p>Here is your one-time verification code:</p><div class="otp">${otp}</div><p>This code is valid for 10 minutes.</p>`;
            await transporter.sendMail({
                to: email, from: `Coatcard AI <${process.env.EMAIL_USER}>`,
                subject: 'Verify Your Email Address',
                html: createStyledEmail('Email Verification', 'Please use the following code to verify your account.', emailBody)
            });

            return res.redirect(`/verify?email=${encodeURIComponent(email)}`);
        } catch (e) {
            console.error('Registration error:', e);
            res.render('register', { msg: 'Something went wrong during registration.' });
        }
    });
});

// ----- VERIFY OTP -----
router.post('/verify', async (req, res) => {
    const { email, otp } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase() }).select('+otp +otpExpires');
        if (!user || !user.otp) return res.render('verify', { email, msg: 'Verification failed. Please request a new OTP.' });
        if (user.otpExpires < Date.now()) return res.render('verify', { email, msg: 'OTP expired. Please request a new one.' });
        if (user.otp !== otp.trim()) return res.render('verify', { email, msg: 'Incorrect OTP.' });

        user.isVerified = true;
        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();
        res.redirect('/login?status=verified');
    } catch (err) {
        res.render('verify', { email, msg: 'Verification failed due to a server error.' });
    }
});

// ----- RESEND OTP -----
router.post('/resend-otp', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase() }).select('+otp +otpExpires');
        if (!user) return res.status(404).json({ message: 'User not found.' });
        if (user.isVerified) return res.status(400).json({ message: 'Account already verified.' });

        const otp = crypto.randomInt(100000, 999999).toString();
        user.otp = otp;
        user.otpExpires = Date.now() + 10 * 60 * 1000;
        await user.save();
        
        const emailBody = `<p>Here is your new one-time verification code:</p><div class="otp">${otp}</div>`;
        await transporter.sendMail({
            to: email, from: `Coatcard AI <${process.env.EMAIL_USER}>`,
            subject: 'New Verification Code',
            html: createStyledEmail('New Verification Code', 'Your new OTP is here.', emailBody)
        });
        res.status(200).json({ message: 'New OTP sent successfully.' });
    } catch (err) {
        res.status(500).json({ message: 'Failed to resend OTP.' });
    }
});

// ----- LOGIN WITH PASSWORD -----
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user || !(await user.matchPassword(password))) {
            return res.render('login', { msg: 'Invalid email or password', email });
        }
        if (!user.isVerified) {
            return res.render('login', { msg: 'Please verify your email before logging in.', showVerifyLink: true, email });
        }
        req.session.user = { id: user._id, username: user.username, profileImage: user.profileImage?.data ? `data:${user.profileImage.contentType};base64,${user.profileImage.data.toString('base64')}` : '/images/default-avatar.png', preferences: user.preferences, role: user.role, fieldOfWork: user.fieldOfWork, goal: user.goal };
        return res.redirect('/chat');
    } catch (err) {
        return res.status(500).render('login', { msg: 'Server error during login.', email });
    }
});

// ----- REQUEST OTP LOGIN -----
router.post('/request-otp-login', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return res.render('login', { msg: 'If an account exists, an OTP has been sent.', email });
        if (!user.isVerified) return res.render('login', { msg: 'Verify your account first.', showVerifyLink: true, email });

        const otp = crypto.randomInt(100000, 999999).toString();
        user.otp = otp;
        user.otpExpires = Date.now() + 10 * 60 * 1000;
        await user.save();
        
        const emailBody = `<p>Here is your one-time login code:</p><div class="otp">${otp}</div>`;
        await transporter.sendMail({
            to: email, from: `Coatcard AI <${process.env.EMAIL_USER}>`,
            subject: 'Your Coatcard AI Login Code',
            html: createStyledEmail('Login Code', 'Use this code to sign in.', emailBody)
        });
        res.redirect(`/otp-login?email=${email}`);
    } catch (err) {
        res.render('login', { msg: 'Something went wrong.', email });
    }
});

// ----- LOGIN USING OTP -----
router.post('/otp-login', async (req, res) => {
    const { email, otp } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase() }).select('+otp +otpExpires');
        if (!user || !user.otp) return res.render('otp-login', { email, msg: 'Login failed. Request a new OTP.' });
        if (user.otpExpires < Date.now()) return res.render('otp-login', { email, msg: 'OTP expired.' });
        if (user.otp !== otp.trim()) return res.render('otp-login', { email, msg: 'Invalid OTP.' });

        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();
        req.session.user = { id: user._id, username: user.username, profileImage: user.profileImage?.data ? `data:${user.profileImage.contentType};base64,${user.profileImage.data.toString('base64')}` : '/images/default-avatar.png', preferences: user.preferences, role: user.role, fieldOfWork: user.fieldOfWork, goal: user.goal };
        res.redirect('/chat');
    } catch (err) {
        res.render('otp-login', { email, msg: 'Login failed. Try again.' });
    }
});

// ----- LOGOUT -----
router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.redirect('/chat');
        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

// ----- FORGOT PASSWORD -----
router.post('/forgot', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email });
        if (!user) return res.render('forgot', { msg: 'If an account exists, a reset link has been sent.' });

        const token = crypto.randomBytes(20).toString('hex');
        user.resetPasswordToken = token;
        user.resetPasswordExpires = Date.now() + 3600000;
        await user.save();

        const resetUrl = `${process.env.BASE_URL || `http://${req.headers.host}`}/reset/${token}`;
        const emailButton = { text: 'Reset Password', url: resetUrl };
        const emailBody = `<p>You are receiving this because you (or someone else) have requested the reset of the password for your account.</p><p>Please click the button below to complete the process. This link is valid for one hour.</p>`;
        
        await transporter.sendMail({
            to: user.email, from: `Coatcard AI <${process.env.EMAIL_USER}>`,
            subject: 'Password Reset Request',
            html: createStyledEmail('Password Reset', 'A request to reset your password was made.', emailBody, emailButton)
        });
        res.render('forgot', { msg: 'Reset link sent to your email.' });
    } catch (err) {
        res.status(500).send('Server error');
    }
});

// ----- RESET PASSWORD -----
router.post('/reset/:token', async (req, res) => {
    try {
        const user = await User.findOne({ resetPasswordToken: req.params.token, resetPasswordExpires: { $gt: Date.now() } });
        if (!user) return res.render('reset', { token: req.params.token, msg: 'Invalid or expired token.' });
        if (req.body.password !== req.body.confirmPassword) return res.render('reset', { token: req.params.token, msg: 'Passwords do not match.' });

        user.password = req.body.password;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();
        
        const emailBody = `<p>This is a confirmation that the password for your account with the email ${user.email} has just been changed.</p>`;
        await transporter.sendMail({
            to: user.email, from: `Coatcard AI <${process.env.EMAIL_USER}>`,
            subject: 'Your Password Has Been Changed',
            html: createStyledEmail('Password Changed', 'Your account password was successfully updated.', emailBody)
        });

        res.redirect('/login?status=reset_success');
    } catch (err) {
        res.status(500).send('Server error');
    }
});

module.exports = router;
