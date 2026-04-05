'use strict';

const { Router } = require('express');
const { onboardOrgController, loginOrgController } = require('../controllers/org.controller');

const router = Router();

router.post('/org/onboard', onboardOrgController);
router.post('/org/login',   loginOrgController);

module.exports = router;
