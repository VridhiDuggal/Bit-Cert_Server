'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { createRecipientController } = require('../controllers/recipient.controller');

const router = Router();

router.post('/org/recipient/create', requireAuth, createRecipientController);

module.exports = router;
