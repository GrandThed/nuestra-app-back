require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api', limiter);

// Body parsing - no size limit for large file uploads
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Health check endpoint (useful for Railway)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API info
app.get('/api', (req, res) => {
  res.json({
    name: 'Household Hub API',
    version: '1.0.0',
    modules: ['boards', 'recipes', 'menus', 'expenses', 'wishlist', 'calendar']
  });
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/api/households', require('./routes/households'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/boards', require('./routes/boards'));
app.use('/api/recipes', require('./routes/recipes'));
app.use('/api/menus', require('./routes/menus'));
app.use('/api/wishlists', require('./routes/wishlists'));
app.use('/api/expenses', require('./routes/expenses'));
// app.use('/api/calendar', require('./routes/calendar'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
