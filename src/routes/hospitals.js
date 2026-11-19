const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { validate, hospitalCapacityUpdateSchema } = require('../middleware/validation');
const { getDB } = require('../db/store');
const { requireAuth, requireRole, requireHospitalScope } = require('../middleware/auth');
const redis = require('../db/redis');
const { getWebSocketBroadcaster } = require('../websocket/broadcaster');

/**
 * GET /api/hospitals
 * Get all hospitals with current capacity and specialist status
 */
router.get('/', asyncHandler(async (req, res) => {
  const db = getDB();
  const hospitals = await db.collection('hospitals')
    .find({ is_active: true })
    .sort({ trauma_level: 1, name: 1 })
    .toArray();

  res.json({ success: true, count: hospitals.length, data: hospitals });
}));

/**
 * GET /api/hospitals/:id
 * Get single hospital with full details
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const db = getDB();
  const hospital = await db.collection('hospitals').findOne({ id: req.params.id });

  if (!hospital) {
    return res.status(404).json({ success: false, error: 'Hospital not found' });
  }

  res.json({ success: true, data: hospital });
}));

/**
 * PATCH /api/hospitals/:id/capacity
 * Update hospital real-time capacity (called by hospital management systems)
 */
router.patch('/:id/capacity', requireAuth, requireRole('admin', 'hospital'), requireHospitalScope('id'), validate(hospitalCapacityUpdateSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const broadcast = getWebSocketBroadcaster();
  const db = getDB();

  const setObj = { updated_at: new Date() };
  if (updates.icu_beds_available !== undefined) setObj.icu_beds_available = updates.icu_beds_available;
  if (updates.ventilators_available !== undefined) setObj.ventilators_available = updates.ventilators_available;
  if (updates.current_load_percent !== undefined) setObj.current_load_percent = updates.current_load_percent;
  if (updates.is_on_diversion !== undefined) setObj.is_on_diversion = updates.is_on_diversion;

  const result = await db.collection('hospitals').findOneAndUpdate(
    { id: id },
    { $set: setObj },
    { returnDocument: 'after' }
  );

  if (!result) {
    return res.status(404).json({ success: false, error: 'Hospital not found' });
  }

  const hospital = result;

  // Log capacity change
  await db.collection('hospital_capacity_log').insertOne({
    hospital_id: id,
    icu_beds_available: hospital.icu_beds_available,
    ventilators_available: hospital.ventilators_available,
    current_load_percent: hospital.current_load_percent,
    logged_at: new Date()
  });

  // Invalidate Redis cache
  await redis.invalidateHospitalCache(id);

  // Broadcast capacity update to dashboard
  broadcast({
    type: 'HOSPITAL_CAPACITY_UPDATED',
    hospitalId: id,
    hospitalName: hospital.name,
    updates,
    snapshot: {
      icu_beds_available: hospital.icu_beds_available,
      ventilators_available: hospital.ventilators_available,
      current_load_percent: hospital.current_load_percent,
      is_on_diversion: hospital.is_on_diversion,
    },
  });

  res.json({ success: true, message: 'Hospital capacity updated', data: hospital });
}));

/**
 * GET /api/hospitals/:id/capacity/history
 * Get capacity history for analytics
 */
router.get('/:id/capacity/history', requireAuth, asyncHandler(async (req, res) => {
  const { hours = 24 } = req.query;
  const db = getDB();
  
  const startTime = new Date();
  startTime.setHours(startTime.getHours() - parseInt(hours));

  const history = await db.collection('hospital_capacity_log')
    .find({
      hospital_id: req.params.id,
      logged_at: { $gte: startTime }
    })
    .sort({ logged_at: -1 })
    .toArray();

  res.json({ success: true, data: history });
}));

/**
 * PATCH /api/hospitals/:id/specialists/:specialistId
 * Toggle specialist on-duty status
 */
router.patch('/:id/specialists/:specialistId', requireAuth, requireRole('admin', 'hospital'), requireHospitalScope('id'), asyncHandler(async (req, res) => {
  const { id, specialistId } = req.params;
  const { is_on_duty, on_call } = req.body;
  const db = getDB();

  const hospital = await db.collection('hospitals').findOne({ id, 'specialists.id': specialistId });
  if (!hospital) {
    return res.status(404).json({ success: false, error: 'Hospital or Specialist not found' });
  }

  const specialists = hospital.specialists.map((specialist) => {
    if (specialist.id !== specialistId) return specialist;
    return {
      ...specialist,
      ...(is_on_duty !== undefined && { is_on_duty }),
      ...(on_call !== undefined && { on_call }),
    };
  });

  await db.collection('hospitals').updateOne(
    { id },
    { $set: { specialists, updated_at: new Date() } }
  );

  const specialist = specialists.find((entry) => entry.id === specialistId);

  // Invalidate hospital cache
  await redis.invalidateHospitalCache(id);

  res.json({ success: true, data: specialist });
}));

module.exports = router;
