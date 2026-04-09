'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRecipientAuth } = require('../middleware/recipientAuth.middleware');
const { createRecipientController, loginRecipientController, getMyCertificatesController, getCertificateQRController, acceptInviteController, getMyCertificateByIdController, getRecipientProfileController } = require('../controllers/recipient.controller');

const router = Router();

router.post('/org/recipient/create', requireAuth, createRecipientController);
router.post('/recipient/login', loginRecipientController);
router.get('/recipient/certificates', requireRecipientAuth, getMyCertificatesController);
router.get('/recipient/certificate/:id/qr', requireRecipientAuth, getCertificateQRController);
router.post('/recipient/accept-invite', acceptInviteController);
router.get('/recipient/certificate/:id', requireRecipientAuth, getMyCertificateByIdController);
router.get('/recipient/profile',         requireRecipientAuth, getRecipientProfileController);

module.exports = router;
