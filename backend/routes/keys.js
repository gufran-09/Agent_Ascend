const express = require('express');
const router = express.Router();

// Placeholder for Phase 2 - API Key Vault
// This will be implemented in Phase 2

router.post('/', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet - coming in Phase 2' });
});

router.get('/models', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet - coming in Phase 2' });
});

module.exports = router;
