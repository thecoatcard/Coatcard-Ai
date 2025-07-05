const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../models/User'); // Assuming User model is one directory up

// --- Helper Functions ---

// UPDATED: Changed from diskStorage to memoryStorage for MongoDB BinData storage
// Files will be held in memory as a Buffer (req.file.buffer)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5000000 }, // 5MB limit
    fileFilter: (req, file, cb) => checkFileType(file, cb)
}).single('profileImage');

function checkFileType(file, cb){
    const filetypes = /jpeg|jpg|png|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if(mimetype && extname) return cb(null,true);
    cb('Error: Images Only!'); // This error message will be caught by multer's error handler
}

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_PORT == 465, // Use == for comparison
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- Authentication Routes ---

router.post('/register', (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            // Log the actual error for debugging in Vercel logs
            console.error('Multer file upload error:', err);
            if (err instanceof multer.MulterError) {
                return res.render('register', { msg: `File Upload Error: ${err.message}` });
            }
            return res.render('register', { msg: `File Upload Error: ${err.message || err}` });
        }

        const { username, email, password, role, fieldOfWork, goal } = req.body;
        // Consider more robust server-side validation here, aligning with Mongoose schema
        if (!username || !email || !password || !role || !fieldOfWork || !goal) {
            return res.render('register', { msg: 'Please fill in all fields' });
        }

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
                await transporter.sendMail({
                    to: existingUser.email,
                    from: `Coatcard AI <${process.env.EMAIL_USER}>`,
                    subject: 'Verify Your Email Address',
                    text: `Here is your new verification code: ${otp}.`
                });
                return res.redirect(`/verify?email=${encodeURIComponent(existingUser.email)}`);
            }

            const otp = crypto.randomInt(100000, 999999).toString();
            const newUser = new User({
                username, email, password, role, fieldOfWork, goal,
                otp, otpExpires: Date.now() + 10 * 60 * 1000
            });

            // UPDATED: Save profile image data and content type from memory buffer
            if (req.file) {
                newUser.profileImage = {
                    data: req.file.buffer,      // Multer memoryStorage provides the file as a buffer
                    contentType: req.file.mimetype // Multer provides the MIME type
                };
            } else {
                // If no file is uploaded, set to a default path (if your EJS can handle it)
                // or ensure your schema default is used.
                // If your EJS expects the BinData structure, and no file is uploaded,
                // you might want to assign a default 'profileImage' object with empty data/type
                // or handle the absence of profileImage when rendering.
                // Example for a default if you absolutely need it in the DB and it's small:
                // newUser.profileImage = { data: Buffer.from([]), contentType: 'image/png' };
            }

            await newUser.save();
            await transporter.sendMail({
                to: newUser.email,
                from: `Coatcard AI <${process.env.EMAIL_USER}>`,
                subject: 'Verify Your Email Address',
                text: `Your verification code is ${otp}.`
            });
            res.redirect(`/verify?email=${encodeURIComponent(newUser.email)}`);
        } catch (dbErr) {
            console.error('Database error during registration:', dbErr); // Log for debugging
            // Mongoose validation errors can also be caught here
            if (dbErr.code === 11000) { // MongoDB duplicate key error
                return res.render('register', { msg: 'Email or Username already registered.' });
            }
            // Check for Mongoose validation errors
            if (dbErr.name === 'ValidationError') {
                const messages = Object.values(dbErr.errors).map(val => val.message);
                return res.render('register', { msg: messages.join(', ') });
            }
            res.render('register', { msg: 'Database error. Please try again.' });
        }
    });
});

router.post('/verify', async (req, res) => {
    const { email, otp } = req.body;
    try {
        const user = await User.findOne({ email });
        // Use user.otp === otp.trim() for strict comparison
        if (!user || !user.otp) return res.render('verify', { email, msg: 'Verification failed. Please request a new OTP.' });
        if (user.otpExpires < Date.now()) return res.render('verify', { email, msg: 'Your OTP has expired. Please request a new one.' });
        if (user.otp !== otp.trim()) return res.render('verify', { email, msg: 'The OTP you entered is incorrect.' });

        user.isVerified = true;
        user.otp = undefined; // Remove OTP after successful verification
        user.otpExpires = undefined;
        await user.save();
        res.redirect('/login?status=verified');
    } catch (err) {
        console.error('Error during OTP verification:', err); // Log for debugging
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
        await transporter.sendMail({
            to: user.email,
            from: `Coatcard AI <${process.env.EMAIL_USER}>`,
            subject: 'New Verification Code',
            text: `Your new verification code is ${otp}.`
        });
        res.status(200).json({ message: 'A new OTP has been sent to your email.' });
    } catch (err) {
        console.error('Error during OTP resend:', err); // Log for debugging
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

        // IMPORTANT: Ensure req.session is properly configured with a *persistent* store
        // (e.g., connect-mongo, connect-redis/Vercel KV) in your main app.js file.
        // In-memory sessions will NOT work on Vercel's serverless environment.
        req.session.user = {
            id: user._id,
            username: user.username,
            // When using BinData for profileImage, you need to convert it to base64 for EJS
            // or fetch it via a separate route if you plan to serve it.
            // For session, you might store the base64 string or just the existence flag.
            // For direct EJS display, you'll need the data and contentType
            profileImage: user.profileImage ? { data: user.profileImage.data.toString('base64'), contentType: user.profileImage.contentType } : null,
            preferences: user.preferences,
            role: user.role,
            fieldOfWork: user.fieldOfWork,
            goal: user.goal
        };
        res.redirect('/chat');
    } catch (err) {
        console.error('Error during login:', err); // Log for debugging
        res.status(500).send('Server error');
    }
});

router.post('/request-otp-login', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            // Security Best Practice: Don't confirm if email exists or not
            return res.render('login', { msg: 'If your account exists, an OTP has been sent.', email: email });
        }
        if (!user.isVerified) {
            return res.render('login', { msg: 'Your account is not verified. Please register again or verify.', showVerifyLink: true, email: email });
        }

        const otp = crypto.randomInt(100000, 999999).toString();
        user.otp = otp;
        user.otpExpires = Date.now() + 10 * 60 * 1000;
        await user.save();

        await transporter.sendMail({
            to: user.email,
            from: `Coatcard AI <${process.env.EMAIL_USER}>`,
            subject: 'Your Login Code',
            text: `Your login code is ${otp}.`
        });
        res.redirect(`/otp-login?email=${encodeURIComponent(user.email)}`);
    } catch (err) {
        console.error('Error requesting OTP for login:', err); // Log for debugging
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

        req.session.user = {
            id: user._id,
            username: user.username,
            profileImage: user.profileImage ? { data: user.profileImage.data.toString('base64'), contentType: user.profileImage.contentType } : null,
            preferences: user.preferences,
            role: user.role,
            fieldOfWork: user.fieldOfWork,
            goal: user.goal
        };
        res.redirect('/chat');
    } catch (err) {
        console.error('Error during OTP login:', err); // Log for debugging
        res.render('otp-login', { email, msg: 'An error occurred. Please try again.' });
    }
});


router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err); // Log for debugging
            return res.redirect('/chat'); // Fallback in case of session destroy error
        }
        res.clearCookie('connect.sid'); // Clear the session cookie
        res.redirect('/login');
    });
});

router.post('/forgot', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email });
        if (!user) {
            // Security Best Practice: Always send a generic message to avoid email enumeration
            return res.render('forgot', { msg: 'If an account with that email exists, a password reset link has been sent.' });
        }

        const token = crypto.randomBytes(20).toString('hex');
        user.resetPasswordToken = token;
        user.resetPasswordExpires = Date.now() + 3600000; // 1 hour expiration
        await user.save();

        // UPDATED: Use an environment variable for BASE_URL in production for consistency and security
        const baseUrl = process.env.BASE_URL || `http://${req.headers.host}`;
        await transporter.sendMail({
            to: user.email,
            from: `Coatcard AI <${process.env.EMAIL_USER}>`,
            subject: 'Password Reset Request',
            text: `Click this link to reset your password: ${baseUrl}/reset/${token}`
        });
        res.render('forgot', { msg: 'An e-mail has been sent with further instructions.' });
    } catch (err) {
        console.error('Error during password reset request:', err); // Log for debugging
        res.status(500).send('Server error');
    }
});

router.post('/reset/:token', async (req, res) => {
    try {
        const user = await User.findOne({ resetPasswordToken: req.params.token, resetPasswordExpires: { $gt: Date.now() } });
        if (!user) return res.render('reset', { token: req.params.token, msg: 'Password reset token is invalid or has expired.' });
        if (req.body.password !== req.body.confirmPassword) return res.render('reset', { token: req.params.token, msg: 'Passwords do not match.' });

        // IMPORTANT: Ensure your User model's pre('save') hook correctly hashes the password here
        user.password = req.body.password;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save(); // This will trigger the pre('save') hook to hash the new password

        res.redirect('/login?status=password_reset_success');
    } catch (err) {
        console.error('Error during password reset:', err); // Log for debugging
        res.status(500).send('Server error');
    }
});

module.exports = router;