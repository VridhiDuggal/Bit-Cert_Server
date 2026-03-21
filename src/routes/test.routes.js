'use strict';

const { Router } = require('express');
const { evaluateTransaction } = require('../services/fabricService');

const router = Router();

router.get('/test-fabric', async (req, res) => {
  try {
    const result = await evaluateTransaction('getCertificate', 'dummy');
    res.json({ success: true, data: result });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

module.exports = router;
