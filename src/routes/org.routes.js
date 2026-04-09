'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { onboardOrgController, loginOrgController, getOrgRecipientsController, getOrgCertificatesController, getOrgStatsController, revokeCertificateController, getOrgAuditLogsController, inviteRecipientController, getCertificateByIdController, getOrgProfileController, updateOrgProfileController } = require('../controllers/org.controller');

const router = Router();

router.post('/org/onboard', onboardOrgController);
router.post('/org/login',   loginOrgController);
router.get('/org/recipients',       requireAuth, getOrgRecipientsController);
router.get('/org/certificates',     requireAuth, getOrgCertificatesController);
router.get('/org/dashboard/stats',  requireAuth, getOrgStatsController);
router.post('/org/certificate/revoke/:hash', requireAuth, revokeCertificateController);
router.get('/org/audit-logs',       requireAuth, getOrgAuditLogsController);
router.post('/org/invite',          requireAuth, inviteRecipientController);
router.get('/org/certificate/:id',  requireAuth, getCertificateByIdController);
router.get('/org/profile',          requireAuth, getOrgProfileController);
router.patch('/org/profile',        requireAuth, updateOrgProfileController);

module.exports = router;
