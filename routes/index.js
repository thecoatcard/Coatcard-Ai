const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../config/auth_middleware');
const User = require('../models/User');

// @route   GET /
router.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/chat');
    res.render('index');
});

// @route   GET /login
router.get('/login', (req, res) => res.render('login', { msg: null }));

// @route   GET /register
router.get('/register', (req, res) => res.render('register', { msg: null }));

// @route   GET /chat
router.get('/chat', ensureAuthenticated, (req, res) => res.render('chat'));

// @route   GET /verify
router.get('/verify', (req, res) => res.render('verify', { email: req.query.email, msg: null }));

// NEW ROUTE for OTP Login Page
// @route   GET /otp-login
router.get('/otp-login', (req, res) => res.render('otp-login', { email: req.query.email, msg: null }));

// @route   GET /forgot
router.get('/forgot', (req, res) => res.render('forgot', { msg: null }));

// @route   GET /reset/:token
router.get('/reset/:token', async (req, res) => {
    try {
        const user = await User.findOne({ resetPasswordToken: req.params.token, resetPasswordExpires: { $gt: Date.now() } });
        if (!user) return res.render('forgot', { msg: 'Password reset token is invalid or has expired.' });
        res.render('reset', { token: req.params.token, msg: null });
    } catch (err) {
        res.redirect('/forgot');
    }
});

module.exports = router;
