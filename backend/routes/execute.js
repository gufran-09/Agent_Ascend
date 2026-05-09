const express = require("express");
const router = express.Router();
const { executePlan } = require('../core/executor');
const { logExecution } = require('../db/analytics');
const { requireValidSessionId } = require('../core/validation');

router.post('/', async (req, res) => {
  try {
    const { session_id, plan } = req.body;

    if (!session_id || !plan) {
      return res.status(400).json({
        error: 'Missing required fields: session_id, plan'
      });
    }

    const sessionError = requireValidSessionId(session_id);
    if (sessionError) return res.status(400).json({ error: sessionError });

    const result = await executePlan(plan, session_id);
    await logExecution({ sessionId: session_id, plan, result });
    res.json(result);
  } catch (error) {
    console.error('Error in POST /api/execute:', error.message);
    res.status(500).json({
      error: error.message || 'Execution failed',
      message: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

module.exports = router;
