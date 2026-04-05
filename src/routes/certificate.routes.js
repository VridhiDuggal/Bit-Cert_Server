'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { issueCertificateController, verifyCertificateController } = require('../controllers/certificate.controller');

const router = Router();

router.post('/org/certificate/issue', requireAuth, issueCertificateController);
router.get('/verify/:cert_hash',                  verifyCertificateController);

module.exports = router;
