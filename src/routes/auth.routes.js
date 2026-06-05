'use strict';

const { Router } = require('express');
const { forgotPasswordController, verifyOtpController, resetPasswordController } = require('../controllers/auth.controller');

const router = Router();

router.post('/auth/forgot-password', forgotPasswordController);
router.post('/auth/verify-otp',      verifyOtpController);
router.post('/auth/reset-password',  resetPasswordController);

module.exports = router;
