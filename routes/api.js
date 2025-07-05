const express = require('express');
const router = express.Router();
const axios = require('axios');
const Chat = require('../models/Chat');
const { ensureAuthenticated } = require('../config/auth_middleware');

// GEMINI API Setup
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

// GET all chats (most recent first)
router.get('/chats', ensureAuthenticated, async (req, res) => {
    try {
        const chats = await Chat.find({ userId: req.session.user.id }).sort({ updatedAt: -1 }).lean();
        res.json(chats);
    } catch (err) {
        console.error('Fetch chats error:', err);
        res.status(500).json({ error: 'Unable to fetch chats' });
    }
});

// GET single chat history
router.get('/chat/:id', ensureAuthenticated, async (req, res) => {
    try {
        const chat = await Chat.findOne({ _id: req.params.id, userId: req.session.user.id }).lean();
        if (!chat) return res.status(404).json({ error: 'Chat not found' });
        res.json(chat);
    } catch (err) {
        console.error('Fetch chat error:', err);
        res.status(500).json({ error: 'Unable to fetch chat history' });
    }
});

// POST a message and get AI reply
router.post('/chat', ensureAuthenticated, async (req, res) => {
    const { chatId, history, firstMessage, systemPrompt } = req.body;
    if (!Array.isArray(history) || !systemPrompt) {
        return res.status(400).json({ error: 'Invalid chat history or system prompt' });
    }

    const geminiPayload = [systemPrompt, ...history];

    try {
        const geminiResponse = await axios.post(GEMINI_API_URL, { contents: geminiPayload });
        const candidates = geminiResponse?.data?.candidates;

        if (!candidates?.length || !candidates[0]?.content?.parts?.length) {
            return res.status(500).json({ error: 'Invalid AI response' });
        }

        const aiReply = { role: 'model', parts: candidates[0].content.parts };
        const newHistory = [...history, aiReply];

        // Non-blocking title generation
        let titleUpdate = {};
        if (firstMessage) {
            generateTitleAsync(firstMessage).then(title => {
                if (title) {
                    Chat.findByIdAndUpdate(chatId, { title }).catch(console.error);
                }
            });
        }

        const updatedChat = await Chat.findByIdAndUpdate(
            chatId,
            { history: newHistory },
            { new: true }
        );

        res.json({ botResponse: aiReply, updatedChat });
    } catch (err) {
        console.error('Gemini error:', err.response?.data || err.message);
        res.status(500).json({ error: 'Gemini failed to respond' });
    }
});

// Utility: generate chat title (non-blocking)
async function generateTitleAsync(message) {
    const prompt = `Create a short (4-5 words max) title for this conversation: "${message}"`;
    try {
        const res = await axios.post(GEMINI_API_URL, {
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });

        return res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.replace(/"/g, '').trim() || null;
    } catch (e) {
        console.warn('Title generation failed:', e.response?.data || e.message);
        return null;
    }
}

// Create a new empty chat
router.post('/chat/new', ensureAuthenticated, async (req, res) => {
    try {
        const chat = new Chat({
            userId: req.session.user.id,
            title: 'New Conversation',
            history: []
        });
        await chat.save();
        res.status(201).json(chat);
    } catch (err) {
        console.error('Create chat error:', err);
        res.status(500).json({ error: 'Unable to create chat' });
    }
});

// Clear chat history
router.post('/chat/clear/:id', ensureAuthenticated, async (req, res) => {
    try {
        const chat = await Chat.findOneAndUpdate(
            { _id: req.params.id, userId: req.session.user.id },
            { history: [], title: 'New Conversation' },
            { new: true }
        );
        if (!chat) return res.status(404).json({ error: 'Chat not found' });
        res.json({ message: 'Chat cleared', chat });
    } catch (err) {
        console.error('Clear chat error:', err);
        res.status(500).json({ error: 'Failed to clear chat' });
    }
});

// Delete a chat
router.delete('/chat/:id', ensureAuthenticated, async (req, res) => {
    try {
        const deleted = await Chat.findOneAndDelete({ _id: req.params.id, userId: req.session.user.id });
        if (!deleted) return res.status(404).json({ error: 'Chat not found' });
        res.json({ message: 'Chat deleted successfully' });
    } catch (err) {
        console.error('Delete chat error:', err);
        res.status(500).json({ error: 'Failed to delete chat' });
    }
});

module.exports = router;
