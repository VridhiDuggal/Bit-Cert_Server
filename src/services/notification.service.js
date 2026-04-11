'use strict';

const prisma = require('../database/prismaClient');

async function createNotification({ recipient_id, type, title, body, cert_hash = null }) {
  return prisma.notification.create({
    data: { recipient_id, type, title, body, cert_hash: cert_hash ?? null },
  });
}

async function getNotifications({ recipient_id, page = 1, limit = 20, filter = 'all' }) {
  const skip = (page - 1) * limit;
  const where = { recipient_id };
  if (filter === 'unread') where.is_read = false;
  if (filter === 'CERTIFICATE_ISSUED' || filter === 'CERTIFICATE_REVOKED') where.type = filter;

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where }),
  ]);

  return { notifications, total, page, limit };
}

async function markAsRead({ notification_id, recipient_id }) {
  const notif = await prisma.notification.findUnique({ where: { notification_id } });
  if (!notif) throw Object.assign(new Error('Notification not found.'), { statusCode: 404 });
  if (notif.recipient_id !== recipient_id) throw Object.assign(new Error('Access denied.'), { statusCode: 403 });
  return prisma.notification.update({ where: { notification_id }, data: { is_read: true } });
}

async function markAllRead({ recipient_id }) {
  const result = await prisma.notification.updateMany({
    where: { recipient_id, is_read: false },
    data:  { is_read: true },
  });
  return { count: result.count };
}

async function getUnreadCount({ recipient_id }) {
  const count = await prisma.notification.count({ where: { recipient_id, is_read: false } });
  return { count };
}

module.exports = { createNotification, getNotifications, markAsRead, markAllRead, getUnreadCount };
