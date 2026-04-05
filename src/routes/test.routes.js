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

router.get('/test-fabric-org', async (req, res) => {
  try {
    const { msp_id } = req.query;
    if (!msp_id) {
      return res.status(400).json({ success: false, error: 'msp_id query param is required.' });
    }
    const publicKey = await evaluateTransaction('GetOrgPublicKey', msp_id);
    res.json({ success: true, msp_id, publicKey });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

module.exports = router;
