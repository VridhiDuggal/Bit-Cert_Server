'use strict';

const { Router } = require('express');
const { StatusCodes } = require('http-status-codes');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();

router.get('/org/notifications', requireAuth, (_req, res) => {
  res.status(StatusCodes.OK).json({ success: true, data: [], total: 0, page: 1, limit: 10 });
});

router.get('/org/notifications/unread-count', requireAuth, (_req, res) => {
  res.status(StatusCodes.OK).json({ success: true, count: 0 });
});

router.patch('/org/notifications/read-all', requireAuth, (_req, res) => {
  res.status(StatusCodes.OK).json({ success: true });
});

router.patch('/org/notifications/:id/read', requireAuth, (_req, res) => {
  res.status(StatusCodes.OK).json({ success: true });
});

module.exports = router;
