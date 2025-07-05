const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const User = require('../models/User');
const { ensureAuthenticated } = require('../config/auth_middleware');

// --- Multer Setup for Profile Picture ---
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => checkFileType(file, cb)
}).single('profileImage');

function checkFileType(file, cb) {
    const filetypes = /jpeg|jpg|png|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (mimetype && extname) return cb(null, true);
    cb('Error: Images Only!');
}

// ---------- GET /profile ----------
router.get('/', ensureAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        if (!user) {
            console.error('User not found for session ID:', req.session.user.id);
            return res.redirect('/login');
        }

        // Ensure profileImage is passed as base64 to match chat.ejs expectations
        const profileUser = {
            ...user.toObject(),
            profileImage: user.profileImage?.data
                ? {
                    data: user.profileImage.data.toString('base64'),
                    contentType: user.profileImage.contentType
                }
                : null
        };

        res.render('profile', { user: profileUser, msg: null, msgType: null });

    } catch (err) {
        console.error('Error loading profile:', err);
        res.redirect('/chat');
    }
});

// ---------- POST /profile ----------
router.post('/', ensureAuthenticated, (req, res) => {
    upload(req, res, async (err) => {
        let user;

        try {
            user = await User.findById(req.session.user.id);
            if (!user) {
                console.error('User not found during profile update:', req.session.user.id);
                return res.redirect('/login');
            }
        } catch (fetchErr) {
            console.error('Error fetching user during profile update:', fetchErr);
            return res.redirect('/chat');
        }

        if (err) {
            console.error('Multer upload error:', err);
            return res.render('profile', {
                user,
                msg: `File Upload Error: ${err.message || err}`,
                msgType: 'error'
            });
        }

        try {
            const { username, language, explanationStyle } = req.body;

            user.username = username.trim();
            user.preferences.language = language;
            user.preferences.explanationStyle = explanationStyle;

            if (req.file) {
                user.profileImage = {
                    data: req.file.buffer,
                    contentType: req.file.mimetype
                };
            }

            await user.save();

            // Update session
            req.session.user.username = user.username;
            req.session.user.preferences = user.preferences;

            const hasImage = user.profileImage?.data;
            req.session.user.profileImage = hasImage
                ? {
                    data: hasImage.toString('base64'),
                    contentType: user.profileImage.contentType
                }
                : null;

            const profileUser = {
                ...user.toObject(),
                profileImage: req.session.user.profileImage
            };

            res.render('profile', {
                user: profileUser,
                msg: 'Profile updated successfully!',
                msgType: 'success'
            });

        } catch (dbErr) {
            console.error('Profile update DB error:', dbErr);

            const profileUser = {
                ...user.toObject(),
                profileImage: user.profileImage?.data
                    ? {
                        data: user.profileImage.data.toString('base64'),
                        contentType: user.profileImage.contentType
                    }
                    : null
            };

            if (dbErr.name === 'ValidationError') {
                const messages = Object.values(dbErr.errors).map(val => val.message);
                return res.render('profile', {
                    user: profileUser,
                    msg: `Validation Error: ${messages.join(', ')}`,
                    msgType: 'error'
                });
            }

            if (dbErr.code === 11000) {
                return res.render('profile', {
                    user: profileUser,
                    msg: 'Username or Email already exists.',
                    msgType: 'error'
                });
            }

            res.render('profile', {
                user: profileUser,
                msg: 'Something went wrong while updating your profile.',
                msgType: 'error'
            });
        }
    });
});

module.exports = router;
