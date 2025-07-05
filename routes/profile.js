const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path'); // Still useful for path.extname in checkFileType
const User = require('../models/User'); // Assuming User model is one directory up
const { ensureAuthenticated } = require('../config/auth_middleware'); // Assuming middleware path

// --- Multer Setup for Profile Picture ---

// UPDATED: Changed from diskStorage to memoryStorage for MongoDB BinData storage
// Files will be held in memory as a Buffer (req.file.buffer)
const upload = multer({
    storage: multer.memoryStorage(), // Use memoryStorage for direct DB storage
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

/**
 * @route   GET /profile
 * @desc    Display the user profile editing page
 */
router.get('/', ensureAuthenticated, async (req, res) => {
    try {
        // Find user by ID. Select profileImage.data and .contentType if not automatically populated
        const user = await User.findById(req.session.user.id);
        if (!user) {
            // Log for debugging
            console.error('User not found for session ID:', req.session.user.id);
            return res.redirect('/login');
        }
        res.render('profile', { user, msg: null, msgType: null });
    } catch (err) {
        console.error('Error fetching profile page:', err); // Log for debugging
        res.redirect('/chat'); // Redirect to a safe page on error
    }
});

/**
 * @route   POST /profile
 * @desc    Handle profile update
 */
router.post('/', ensureAuthenticated, (req, res) => {
    upload(req, res, async (err) => {
        // Always try to fetch the user if an error occurs for consistent rendering
        let user;
        try {
            user = await User.findById(req.session.user.id);
            if (!user) {
                console.error('User not found during profile update for session ID:', req.session.user.id);
                return res.redirect('/login');
            }
        } catch (fetchErr) {
            console.error('Error fetching user during profile update (pre-multer error):', fetchErr);
            return res.redirect('/chat'); // Or handle this more gracefully
        }

        if (err) {
            console.error('Multer file upload error during profile update:', err); // Log the actual error
            if (err instanceof multer.MulterError) {
                return res.render('profile', { user, msg: `File Upload Error: ${err.message}`, msgType: 'error' });
            }
            return res.render('profile', { user, msg: `File Upload Error: ${err.message || err}`, msgType: 'error' });
        }

        try {
            const { username, language, explanationStyle } = req.body;

            // Update fields
            user.username = username;
            user.preferences.language = language;
            user.preferences.explanationStyle = explanationStyle;

            // UPDATED: Save profile image data and content type from memory buffer
            if (req.file) {
                user.profileImage = {
                    data: req.file.buffer,      // Multer memoryStorage provides the file as a buffer
                    contentType: req.file.mimetype // Multer provides the MIME type
                };
            }
            // If no file is uploaded, we don't modify user.profileImage,
            // so it retains its existing value.

            await user.save(); // This will trigger pre('save') hooks if you have them

            // UPDATED: Update the session with new details, converting Buffer to Base64 for EJS
            req.session.user.username = user.username;
            if (user.profileImage && user.profileImage.data) {
                req.session.user.profileImage = {
                    data: user.profileImage.data.toString('base64'),
                    contentType: user.profileImage.contentType
                };
            } else {
                req.session.user.profileImage = null; // Or a default path string if that's what EJS expects
            }
            req.session.user.preferences = user.preferences;

            // Save session changes explicitly if needed (e.g., using req.session.save)
            // if your session store requires it before redirect/render for immediate updates.
            // req.session.save((saveErr) => {
            //     if (saveErr) console.error("Error saving session after profile update:", saveErr);
            //     res.render('profile', { user, msg: 'Profile updated successfully!', msgType: 'success' });
            // });

            res.render('profile', { user, msg: 'Profile updated successfully!', msgType: 'success' });

        } catch (dbErr) {
            console.error('Database error during profile update:', dbErr); // Log for debugging
            // Handle Mongoose validation errors more specifically
            if (dbErr.name === 'ValidationError') {
                const messages = Object.values(dbErr.errors).map(val => val.message);
                return res.render('profile', { user, msg: `Validation Error: ${messages.join(', ')}`, msgType: 'error' });
            }
            if (dbErr.code === 11000) { // MongoDB duplicate key error
                return res.render('profile', { user, msg: 'Username or Email already taken.', msgType: 'error' });
            }
            res.render('profile', { user, msg: 'Database error. Please try again.', msgType: 'error' });
        }
    });
});

module.exports = router;