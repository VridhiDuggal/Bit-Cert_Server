'use strict';

const { Router } = require('express');
const { forgotPasswordController, resetPasswordController } = require('../controllers/auth.controller');

const router = Router();

router.post('/auth/forgot-password', forgotPasswordController);
router.post('/auth/reset-password',  resetPasswordController);

module.exports = router;
