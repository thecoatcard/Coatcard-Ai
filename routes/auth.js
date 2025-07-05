const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../models/User');

// --- Helper Functions ---
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: (req, file, cb) => cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname))
});

// UPDATED: Increased file size limit to 5MB
const upload = multer({ 
    storage: storage, 
    limits: { fileSize: 5000000 }, // 5MB limit
    fileFilter: (req, file, cb) => checkFileType(file, cb) 
}).single('profileImage');

function checkFileType(file, cb){
    const filetypes = /jpeg|jpg|png|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if(mimetype && extname) return cb(null,true);
    cb('Error: Images Only!');
}
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST, port: process.env.EMAIL_PORT, secure: process.env.EMAIL_PORT == 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- Authentication Routes ---

router.post('/register', (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
             if (err instanceof multer.MulterError) {
                return res.render('register', { msg: `File Upload Error: ${err.message}` });
            }
            return res.render('register', { msg: `File Upload Error: ${err}` });
        }
        
        const { username, email, password, role, fieldOfWork, goal } = req.body;
        if (!username || !email || !password || !role || !fieldOfWork || !goal) return res.render('register', { msg: 'Please fill in all fields' });
        
        try {
            const existingUser = await User.findOne({ email });
            if (existingUser && existingUser.isVerified) {
                return res.render('register', { msg: 'This email is already registered and verified. Please log in.' });
            }
            if (existingUser && !existingUser.isVerified) {
                const otp = crypto.randomInt(100000, 999999).toString();
                existingUser.otp = otp;
                existingUser.otpExpires = Date.now() + 10 * 60 * 1000;
                await existingUser.save();
                await transporter.sendMail({ to: existingUser.email, from: `Coatcard AI <${process.env.EMAIL_USER}>`, subject: 'Verify Your Email Address', text: `Here is your new verification code: ${otp}.` });
                return res.redirect(`/verify?email=${encodeURIComponent(existingUser.email)}`);
            }

            const otp = crypto.randomInt(100000, 999999).toString();
            const newUser = new User({
                username, email, password, role, fieldOfWork, goal,
                profileImage: req.file ? `/uploads/${req.file.filename}` : '/images/default-avatar.png',
                otp, otpExpires: Date.now() + 10 * 60 * 1000
            });
            await newUser.save();
            await transporter.sendMail({ to: newUser.email, from: `Coatcard AI <${process.env.EMAIL_USER}>`, subject: 'Verify Your Email Address', text: `Your verification code is ${otp}.` });
            res.redirect(`/verify?email=${encodeURIComponent(newUser.email)}`);
        } catch (dbErr) {
            res.render('register', { msg: 'Database error. Please try again.' });
        }
    });
});

// ... (rest of the file remains the same) ...
router.post('/verify', async (req, res) => {
    const { email, otp } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user || !user.otp) return res.render('verify', { email, msg: 'Verification failed. Please request a new OTP.' });
        if (user.otpExpires < Date.now()) return res.render('verify', { email, msg: 'Your OTP has expired. Please request a new one.' });
        if (user.otp !== otp.trim()) return res.render('verify', { email, msg: 'The OTP you entered is incorrect.' });

        user.isVerified = true;
        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();
        res.redirect('/login?status=verified');
    } catch (err) {
        res.render('verify', { email, msg: 'An error occurred. Please try again.' });
    }
});

router.post('/resend-otp', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found.' });
        if (user.isVerified) return res.status(400).json({ message: 'Account is already verified.' });

        const otp = crypto.randomInt(100000, 999999).toString();
        user.otp = otp;
        user.otpExpires = Date.now() + 10 * 60 * 1000;
        await user.save();
        await transporter.sendMail({ to: user.email, from: `Coatcard AI <${process.env.EMAIL_USER}>`, subject: 'New Verification Code', text: `Your new verification code is ${otp}.` });
        res.status(200).json({ message: 'A new OTP has been sent to your email.' });
    } catch (err) {
        res.status(500).json({ message: 'An error occurred while resending OTP.' });
    }
});


router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user || !(await user.matchPassword(password))) {
             return res.render('login', { msg: 'Invalid credentials', email: email });
        }
        if (!user.isVerified) {
            return res.render('login', { msg: 'Please verify your email before logging in.', showVerifyLink: true, email: email });
        }
        
        req.session.user = { id: user._id, username: user.username, profileImage: user.profileImage, preferences: user.preferences, role: user.role, fieldOfWork: user.fieldOfWork, goal: user.goal };
        res.redirect('/chat');
    } catch (err) {
        res.status(500).send('Server error');
    }
});

router.post('/request-otp-login', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.render('login', { msg: 'If your account exists, an OTP has been sent.', email: email });
        }
        if (!user.isVerified) {
            return res.render('login', { msg: 'Your account is not verified. Please register again or verify.', showVerifyLink: true, email: email });
        }

        const otp = crypto.randomInt(100000, 999999).toString();
        user.otp = otp;
        user.otpExpires = Date.now() + 10 * 60 * 1000;
        await user.save();

        await transporter.sendMail({ to: user.email, from: `Coatcard AI <${process.env.EMAIL_USER}>`, subject: 'Your Login Code', text: `Your login code is ${otp}.` });
        res.redirect(`/otp-login?email=${encodeURIComponent(user.email)}`);
    } catch (err) {
        res.render('login', { msg: 'An error occurred. Please try again.', email: email });
    }
});

router.post('/otp-login', async (req, res) => {
    const { email, otp } = req.body;
    try {
        const user = await User.findOne({ email });

        if (!user || !user.otp) return res.render('otp-login', { email, msg: 'Login failed. Please request a new OTP.' });
        if (user.otpExpires < Date.now()) return res.render('otp-login', { email, msg: 'Your OTP has expired. Please request a new one.' });
        if (user.otp !== otp.trim()) return res.render('otp-login', { email, msg: 'The OTP you entered is incorrect.' });

        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();
        
        req.session.user = { id: user._id, username: user.username, profileImage: user.profileImage, preferences: user.preferences, role: user.role, fieldOfWork: user.fieldOfWork, goal: user.goal };
        res.redirect('/chat');
    } catch (err) {
        res.render('otp-login', { email, msg: 'An error occurred. Please try again.' });
    }
});


router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.redirect('/chat');
        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

router.post('/forgot', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email });
        if (!user) return res.render('forgot', { msg: 'If an account with that email exists, a password reset link has been sent.' });

        const token = crypto.randomBytes(20).toString('hex');
        user.resetPasswordToken = token;
        user.resetPasswordExpires = Date.now() + 3600000;
        await user.save();

        await transporter.sendMail({
            to: user.email, from: `Coatcard AI <${process.env.EMAIL_USER}>`,
            subject: 'Password Reset Request',
            text: `Click this link to reset your password: http://${req.headers.host}/reset/${token}`
        });
        res.render('forgot', { msg: 'An e-mail has been sent with further instructions.' });
    } catch (err) {
        res.status(500).send('Server error');
    }
});

router.post('/reset/:token', async (req, res) => {
    try {
        const user = await User.findOne({ resetPasswordToken: req.params.token, resetPasswordExpires: { $gt: Date.now() } });
        if (!user) return res.render('reset', { token: req.params.token, msg: 'Password reset token is invalid or has expired.' });
        if (req.body.password !== req.body.confirmPassword) return res.render('reset', { token: req.params.token, msg: 'Passwords do not match.' });

        user.password = req.body.password;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();
        
        res.redirect('/login?status=password_reset_success');
    } catch (err) {
        res.status(500).send('Server error');
    }
});

module.exports = router;
