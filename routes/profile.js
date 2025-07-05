const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const User = require('../models/User');
const { ensureAuthenticated } = require('../config/auth_middleware');

// --- Multer Setup for Profile Picture ---
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
    if(filetypes.test(path.extname(file.originalname).toLowerCase()) && filetypes.test(file.mimetype)) return cb(null,true);
    cb('Error: Images Only!');
}

/**
 * @route   GET /profile
 * @desc    Display the user profile editing page
 */
router.get('/', ensureAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        if (!user) {
            return res.redirect('/login');
        }
        res.render('profile', { user, msg: null, msgType: null });
    } catch (err) {
        console.error(err);
        res.redirect('/chat');
    }
});

/**
 * @route   POST /profile
 * @desc    Handle profile update
 */
router.post('/', ensureAuthenticated, (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            const user = await User.findById(req.session.user.id);
            if (err instanceof multer.MulterError) {
                return res.render('profile', { user, msg: `File Upload Error: ${err.message}`, msgType: 'error' });
            }
            return res.render('profile', { user, msg: `File Upload Error: ${err}`, msgType: 'error' });
        }

        try {
            const { username, language, explanationStyle } = req.body;
            const user = await User.findById(req.session.user.id);

            if (!user) return res.redirect('/login');

            // Update fields
            user.username = username;
            user.preferences.language = language;
            user.preferences.explanationStyle = explanationStyle;

            if (req.file) {
                user.profileImage = `/uploads/${req.file.filename}`;
            }

            await user.save();

            // Update the session with new details
            req.session.user.username = user.username;
            req.session.user.profileImage = user.profileImage;
            req.session.user.preferences = user.preferences;

            res.render('profile', { user, msg: 'Profile updated successfully!', msgType: 'success' });

        } catch (dbErr) {
            console.error(dbErr);
            const user = await User.findById(req.session.user.id);
            res.render('profile', { user, msg: 'Database error. Please try again.', msgType: 'error' });
        }
    });
});

module.exports = router;
