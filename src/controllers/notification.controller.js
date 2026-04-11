'use strict';

const { StatusCodes } = require('http-status-codes');
const notificationService = require('../services/notification.service');

async function getNotifications(req, res, next) {
  try {
    const page   = Math.max(1, parseInt(req.query.page  ?? '1',  10));
    const limit  = Math.max(1, parseInt(req.query.limit ?? '20', 10));
    const filter = req.query.filter ?? 'all';
    const result = await notificationService.getNotifications({ recipient_id: req.recipient.recipient_id, page, limit, filter });
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function markAsRead(req, res, next) {
  try {
    const notification_id = req.params.id;
    const updated = await notificationService.markAsRead({ notification_id, recipient_id: req.recipient.recipient_id });
    return res.status(StatusCodes.OK).json({ success: true, notification: updated });
  } catch (err) {
    next(err);
  }
}

async function markAllRead(req, res, next) {
  try {
    const result = await notificationService.markAllRead({ recipient_id: req.recipient.recipient_id });
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function getUnreadCount(req, res, next) {
  try {
    const result = await notificationService.getUnreadCount({ recipient_id: req.recipient.recipient_id });
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

module.exports = { getNotifications, markAsRead, markAllRead, getUnreadCount };
