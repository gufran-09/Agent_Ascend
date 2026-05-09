const express = require('express');
const router = express.Router();
const { generatePlan } = require('../core/router');

router.post('/', async (req, res) => {
  try {
    const { session_id, prompt, available_models = [] } = req.body;

    if (!session_id || !prompt) {
      return res.status(400).json({
        error: 'Missing required fields: session_id, prompt'
      });
    }

    if (available_models && !Array.isArray(available_models)) {
      return res.status(400).json({
        error: 'available_models must be an array of model ids'
      });
    }

    const plan = await generatePlan(prompt, available_models, session_id);
    res.json(plan);
  } catch (error) {
    console.error('Error in POST /api/plan:', error.message);
    const status = error.message.includes('No available models') ? 400 : 500;
    res.status(status).json({
      error: error.message || 'Failed to generate plan',
      message: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

module.exports = router;
