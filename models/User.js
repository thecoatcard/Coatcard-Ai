const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: [true, 'Username is required'],
            unique: true,
            trim: true,
            minlength: [3, 'Username must be at least 3 characters long'],
            maxlength: [30, 'Username cannot exceed 30 characters']
        },
        email: {
            type: String,
            required: [true, 'Email is required'],
            unique: true,
            trim: true,
            lowercase: true,
            match: [/^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/, 'Please enter a valid email address']
        },
        password: {
            type: String,
            required: [true, 'Password is required'],
            minlength: [6, 'Password must be at least 6 characters long'],
        },
        // --- UPDATED: profileImage for Inline BinData storage ---
        profileImage: {
            // No 'default' here, as a default image would also need to be a Buffer
            // You'd handle default on the frontend or by inserting a default Buffer
            data: Buffer,      // Stores the binary image data
            contentType: String // Stores the MIME type (e.g., 'image/png', 'image/jpeg')
        },
        role: {
            type: String,
            required: [true, 'Role is required'],
            enum: {
                values: ['learner', 'educator', 'admin'],
                message: 'Invalid role. Role must be learner, educator, or admin.'
            },
            default: 'learner'
        },
        fieldOfWork: {
            type: String,
            required: [true, 'Field of work is required'],
            trim: true,
        },
        goal: {
            type: String,
            required: [true, 'Goal is required'],
            trim: true,
        },

        isVerified: { type: Boolean, default: false },
        otp: { type: String, select: false },
        otpExpires: { type: Date, select: false },
        resetPasswordToken: { type: String, select: false },
        resetPasswordExpires: { type: Date, select: false },

        preferences: {
            language: { type: String, default: 'C++', trim: true },
            explanationStyle: {
                type: String,
                default: 'bullet',
                enum: {
                    values: ['bullet', 'paragraph', 'step-by-step'],
                    message: 'Invalid explanation style.'
                },
                trim: true
            }
        },

        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
    },
    {
        timestamps: true,
        collection: 'users'
    }
);

// --- Indexing for Performance ---
UserSchema.index({ email: 1 });
UserSchema.index({ username: 1 });
UserSchema.index({ otp: 1, otpExpires: 1 });
UserSchema.index({ resetPasswordToken: 1, resetPasswordExpires: 1 });

// Hash password before saving
UserSchema.pre('save', async function(next) {
    if (this.isNew) {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
    } else if (this.isModified('password')) {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
    }
    next();
});

// Method to compare password
UserSchema.methods.matchPassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);