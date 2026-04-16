const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { onboardOrgController, loginOrgController, getOrgRecipientsController, getOrgRecipientDetailController, updateOrgRecipientController, getOrgCertificatesController, getOrgStatsController, revokeCertificateController, getOrgAuditLogsController, exportOrgAuditLogsController, inviteRecipientController, getCertificateByIdController, getOrgProfileController, updateOrgProfileController, changePasswordController, getDashboardActivityController, getDashboardChartController, issueCertificateController, getVerificationHistoryController, resendCertificateController, downloadOrgCertificateController } = require('../controllers/org.controller');

const router = Router();

router.post('/org/onboard', onboardOrgController);
router.post('/org/login',   loginOrgController);
router.get('/org/recipients',                                requireAuth, getOrgRecipientsController);
router.get('/org/recipient/:id',                             requireAuth, getOrgRecipientDetailController);
router.patch('/org/recipient/:id',                           requireAuth, updateOrgRecipientController);
router.get('/org/certificates',                              requireAuth, getOrgCertificatesController);
router.post('/org/certificate/issue',                        requireAuth, issueCertificateController);
router.get('/org/dashboard/stats',                           requireAuth, getOrgStatsController);
router.get('/org/dashboard/activity',                        requireAuth, getDashboardActivityController);
router.get('/org/dashboard/chart',                           requireAuth, getDashboardChartController);
router.post('/org/certificate/revoke/:hash',                 requireAuth, revokeCertificateController);
router.get('/org/audit-logs',                                requireAuth, getOrgAuditLogsController);
router.get('/org/audit-logs/export',                         requireAuth, exportOrgAuditLogsController);
router.post('/org/invite',                                   requireAuth, inviteRecipientController);
router.get('/org/certificate/:id/verification-history',      requireAuth, getVerificationHistoryController);
router.post('/org/certificate/:id/resend',                   requireAuth, resendCertificateController);
router.get('/org/certificate/:id/download',                  requireAuth, downloadOrgCertificateController);
router.get('/org/certificate/:id',                           requireAuth, getCertificateByIdController);
router.get('/org/profile',                                   requireAuth, getOrgProfileController);
router.patch('/org/profile',                                 requireAuth, updateOrgProfileController);
router.post('/org/change-password',                          requireAuth, changePasswordController);

module.exports = router;
