'use strict';

const { Router } = require('express');
const { generateKeysController, signController, verifyController } = require('../controllers/crypto.controller');

const router = Router();

router.post('/crypto/generate-keys', generateKeysController);
router.post('/crypto/sign', signController);
router.post('/crypto/verify', verifyController);

module.exports = router;
