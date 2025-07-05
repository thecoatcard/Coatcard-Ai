const express = require('express');
const router = express.Router();
const axios = require('axios');
const Chat = require('../models/Chat');
const { ensureAuthenticated } = require('../config/auth_middleware');

// --- CHAT API ROUTES ---

/**
 * @route   GET /api/chats
 * @desc    Get all chat conversations for the logged-in user, sorted by most recently updated
 */
router.get('/chats', ensureAuthenticated, async (req, res) => {
    try {
        const chats = await Chat.find({ userId: req.session.user.id }).sort({ updatedAt: -1 });
        res.json(chats);
    } catch (err) {
        console.error('Error fetching chats:', err);
        res.status(500).json({ error: 'Failed to fetch conversations.' });
    }
});

/**
 * @route   GET /api/chat/:id
 * @desc    Get the history of a specific chat conversation
 */
router.get('/chat/:id', ensureAuthenticated, async (req, res) => {
    try {
        const chat = await Chat.findOne({ _id: req.params.id, userId: req.session.user.id });
        if (!chat) {
            return res.status(404).json({ error: 'Chat not found.' });
        }
        res.json(chat);
    } catch (err) {
        console.error('Error fetching chat history:', err);
        res.status(500).json({ error: 'Failed to fetch chat history.' });
    }
});

/**
 * @route   POST /api/chat
 * @desc    Handle sending a message to a conversation, interacting with Gemini, and saving the result
 */
router.post('/chat', ensureAuthenticated, async (req, res) => {
    const { chatId, history, firstMessage, systemPrompt } = req.body;
    if (!history || !systemPrompt) {
        return res.status(400).json({ error: 'Chat history and system prompt are required.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    // The full payload sent to Gemini includes the system prompt and the user/model history
    const geminiPayload = [systemPrompt, ...history];

    try {
        const geminiResponse = await axios.post(apiUrl, { contents: geminiPayload });
        const botResponse = geminiResponse.data;

        if (botResponse.candidates && botResponse.candidates.length > 0) {
            // The history saved to the DB ONLY includes the user/model messages (no system prompt)
            const newHistoryToSave = [...history, { role: 'model', parts: botResponse.candidates[0].content.parts }];
            
            let chatTitle = 'New Conversation';
            if (firstMessage) {
                // Ask Gemini to create a short title for the conversation
                const titlePrompt = `Based on the following user prompt, create a very short title (4-5 words max) for this conversation. User Prompt: "${firstMessage}"`;
                const titleResponse = await axios.post(apiUrl, { contents: [{ role: 'user', parts: [{ text: titlePrompt }] }] });
                if (titleResponse.data.candidates && titleResponse.data.candidates.length > 0) {
                    chatTitle = titleResponse.data.candidates[0].content.parts[0].text.replace(/"/g, '').trim();
                }
            }

            // Find the chat by its ID and update it with the new history and potentially a new title
            const updatedChat = await Chat.findByIdAndUpdate(
                chatId,
                { 
                    history: newHistoryToSave,
                    ...(firstMessage && { title: chatTitle }) // Conditionally update title only if it's the first message
                },
                { new: true } // Return the updated document
            );

            // Send the AI's response and the updated chat document back to the client
            res.json({ botResponse, updatedChat });
        } else {
             res.status(500).json({ error: 'No valid response from AI.' });
        }
    } catch (error) {
        console.error('Error in /api/chat:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to get response from AI.' });
    }
});

/**
 * @route   POST /api/chat/new
 * @desc    Create a new, empty chat conversation in the database
 */
router.post('/chat/new', ensureAuthenticated, async (req, res) => {
    try {
        const newChat = new Chat({
            userId: req.session.user.id,
            title: 'New Conversation',
            history: []
        });
        await newChat.save();
        res.status(201).json(newChat);
    } catch (err) {
        console.error('Error creating new chat:', err);
        res.status(500).json({ error: 'Failed to create a new conversation.' });
    }
});

/**
 * @route   POST /api/chat/clear/:id
 * @desc    Clear a specific chat conversation's history and reset its title
 */
router.post('/chat/clear/:id', ensureAuthenticated, async (req, res) => {
    try {
        const chat = await Chat.findOneAndUpdate(
            { _id: req.params.id, userId: req.session.user.id },
            { $set: { history: [], title: 'New Conversation' } },
            { new: true }
        );
        if (!chat) return res.status(404).json({ error: 'Chat not found.' });
        res.status(200).json({ message: 'Chat history cleared.', chat });
    } catch (error) {
        console.error('Error clearing chat:', error);
        res.status(500).json({ error: 'Failed to clear chat history.' });
    }
});

/**
 * @route   DELETE /api/chat/:id
 * @desc    Delete a specific chat conversation from the database
 */
router.delete('/chat/:id', ensureAuthenticated, async (req, res) => {
    try {
        const chat = await Chat.findOneAndDelete({ _id: req.params.id, userId: req.session.user.id });
        if (!chat) return res.status(404).json({ error: 'Chat not found.' });
        res.status(200).json({ message: 'Chat deleted successfully.' });
    } catch (error) {
        console.error('Error deleting chat:', error);
        res.status(500).json({ error: 'Failed to delete chat.' });
    }
});

module.exports = router;
