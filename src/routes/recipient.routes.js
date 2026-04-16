'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRecipientAuth } = require('../middleware/recipientAuth.middleware');
const { createRecipientController, loginRecipientController, getMyCertificatesController, getCertificateQRController, acceptInviteController, getMyCertificateByIdController, getRecipientProfileController, getDashboardStats, getVerificationHistoryController, updateProfileController, changePasswordController, previewInviteController, getRecipientOrgsController, downloadCertificateController } = require('../controllers/recipient.controller');
const { getNotifications, markAsRead, markAllRead, getUnreadCount } = require('../controllers/notification.controller');

const router = Router();

router.post('/org/recipient/create', requireAuth, createRecipientController);
router.post('/recipient/login', loginRecipientController);
router.post('/recipient/accept-invite', acceptInviteController);
router.get('/recipient/invite-preview', previewInviteController);

router.get('/recipient/dashboard/stats',                      requireRecipientAuth, getDashboardStats);
router.get('/recipient/notifications',                        requireRecipientAuth, getNotifications);
router.patch('/recipient/notifications/read-all',             requireRecipientAuth, markAllRead);
router.get('/recipient/notifications/unread-count',           requireRecipientAuth, getUnreadCount);
router.patch('/recipient/notifications/:id/read',             requireRecipientAuth, markAsRead);
router.get('/recipient/certificate/:id/verification-history', requireRecipientAuth, getVerificationHistoryController);
router.get('/recipient/certificate/:id/qr',                   requireRecipientAuth, getCertificateQRController);
router.get('/recipient/certificate/:id/download',             requireRecipientAuth, downloadCertificateController);
router.get('/recipient/certificate/:id',                      requireRecipientAuth, getMyCertificateByIdController);
router.get('/recipient/certificates',                         requireRecipientAuth, getMyCertificatesController);
router.get('/recipient/orgs',                                 requireRecipientAuth, getRecipientOrgsController);
router.patch('/recipient/profile',                            requireRecipientAuth, updateProfileController);
router.post('/recipient/change-password',                     requireRecipientAuth, changePasswordController);
router.get('/recipient/profile',                              requireRecipientAuth, getRecipientProfileController);

module.exports = router;
