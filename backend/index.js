const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const config = require("./config");
const requestLogger = require("./middleware/requestLogger");
const errorHandler = require("./middleware/errorHandler");

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: "*", // Tighten for production, fine for hackathon
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Global fallback rate limit (generous)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// Body parsing
app.use(express.json({ limit: "1mb" }));

// Request logging
app.use(requestLogger);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ──────────────────────────────────────────────
// Per-route rate limiters
// ──────────────────────────────────────────────
const planLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 60,                    // 60 req/min per IP
  message: { success: false, error: 'Rate limit exceeded for /api/plan' }
});

const executeLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 10,                    // 10 req/min per IP — expensive endpoint
  message: { success: false, error: 'Rate limit exceeded for /api/execute' }
});

const keysLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,  // 10 minutes
  max: 20,                    // 20 req/10min per IP
  message: { success: false, error: 'Rate limit exceeded for /api/keys' }
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 120,                   // 120 req/min per IP — read-heavy
  message: { success: false, error: 'Rate limit exceeded' }
});

// ──────────────────────────────────────────────
// Import routes
// ──────────────────────────────────────────────
const keysRouter = require('./routes/keys');
const modelsRouter = require('./routes/models');
const planRouter = require('./routes/plan');
const executeRouter = require('./routes/execute');
const historyRouter = require('./routes/history');
const analyticsRouter = require('./routes/analytics');

// Mount routes with per-route rate limiters
app.use('/api/keys', keysLimiter, keysRouter);
app.use('/api/models', readLimiter, modelsRouter);
app.use('/api/plan', planLimiter, planRouter);
app.use('/api/execute', executeLimiter, executeRouter);
app.use('/api/history', readLimiter, historyRouter);
app.use('/api/analytics', readLimiter, analyticsRouter);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});

module.exports = app;
