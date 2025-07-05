const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        default: 'New Conversation'
    },
    history: {
        type: Array,
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Chat', ChatSchema);
