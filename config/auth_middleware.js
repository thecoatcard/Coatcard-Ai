module.exports = {
    ensureAuthenticated: function(req, res, next) {
        // Check if the user object exists in the session
        if (req.session.user) {
            // If logged in, proceed to the next middleware or route handler
            return next();
        }
        
        // If not logged in, you can add a flash message here to inform the user.
        // For now, we'll just redirect to the login page.
        res.redirect('/login');
    }
};
