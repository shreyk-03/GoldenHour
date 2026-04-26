const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { getDB } = require('../db/mongodb');
const { getRandomVitals, getMultipleRandomVitals } = require('../services/vitalsDataService');

/**
 * GET /api/patients/vitals/random
 * Returns real patient vitals from the 200K-record dataset
 */
router.get('/vitals/random', asyncHandler(async (req, res) => {
  const { risk, count = 1 } = req.query;
  const n = Math.min(parseInt(count) || 1, 20);

  if (n === 1) {
    const vitals = getRandomVitals(risk || null);
    if (!vitals) {
      return res.status(500).json({ success: false, error: 'Vitals dataset not available' });
    }
    return res.json({ success: true, data: vitals });
  }

  const vitals = getMultipleRandomVitals(n, risk || null);
  res.json({ success: true, count: vitals.length, data: vitals });
}));

/**
 * GET /api/patients
 * List all patients with optional filters
 */
router.get('/', asyncHandler(async (req, res) => {
  const { status, severity, limit = 50, offset = 0 } = req.query;
  const db = getDB();

  const queryObj = {};
  if (status) queryObj.status = status;
  if (severity) queryObj.severity_level = severity;

  // Use aggregation to join with latest dispatch
  const pipeline = [
    { $match: queryObj },
    { $sort: { created_at: -1 } },
    { $skip: parseInt(offset) },
    { $limit: parseInt(limit) },
    {
      $lookup: {
        from: 'dispatches',
        localField: '_id',
        foreignField: 'patient_id',
        as: 'dispatch_info'
      }
    },
    {
      $addFields: {
        latest_dispatch: { $arrayElemAt: [{ $sortArray: { input: '$dispatch_info', sortBy: { dispatched_at: -1 } } }, 0] }
      }
    },
    {
      $lookup: {
        from: 'hospitals',
        localField: 'latest_dispatch.assigned_hospital_id',
        foreignField: 'id',
        as: 'hospital_info'
      }
    },
    {
      $addFields: {
        assigned_hospital_id: '$latest_dispatch.assigned_hospital_id',
        assigned_hospital_name: { $arrayElemAt: ['$hospital_info.name', 0] },
        estimated_transit_minutes: '$latest_dispatch.estimated_transit_minutes',
        dispatched_at: '$latest_dispatch.dispatched_at',
        arrived_at: '$latest_dispatch.arrived_at'
      }
    },
    {
      $project: { dispatch_info: 0, hospital_info: 0, latest_dispatch: 0 }
    }
  ];

  const patients = await db.collection('patients').aggregate(pipeline).toArray();

  res.json({ success: true, count: patients.length, data: patients });
}));

/**
 * GET /api/patients/:id
 * Get full patient record with dispatch history
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const db = getDB();
  const { ObjectId } = require('mongodb');
  
  let patientId;
  try {
    patientId = new ObjectId(req.params.id);
  } catch (e) {
    return res.status(400).json({ success: false, error: 'Invalid patient ID format' });
  }

  const patient = await db.collection('patients').findOne({ _id: patientId });
  if (!patient) {
    return res.status(404).json({ success: false, error: 'Patient not found' });
  }

  const dispatches = await db.collection('dispatches').aggregate([
    { $match: { patient_id: patientId } },
    { $sort: { dispatched_at: -1 } },
    {
      $lookup: {
        from: 'hospitals',
        localField: 'assigned_hospital_id',
        foreignField: 'id',
        as: 'hospital'
      }
    },
    {
      $addFields: {
        hospital_name: { $arrayElemAt: ['$hospital.name', 0] },
        latitude: { $arrayElemAt: ['$hospital.latitude', 0] },
        longitude: { $arrayElemAt: ['$hospital.longitude', 0] }
      }
    },
    { $project: { hospital: 0 } }
  ]).toArray();

  res.json({
    success: true,
    data: {
      patient: patient,
      dispatches: dispatches,
    },
  });
}));

/**
 * GET /api/patients/analytics/summary
 * Dashboard summary stats
 */
router.get('/analytics/summary', asyncHandler(async (req, res) => {
  const db = getDB();
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
  const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));

  const [patientStats, dispatchStats, hospitalStats] = await Promise.all([
    db.collection('patients').aggregate([
      {
        $facet: {
          counts: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                critical: { $sum: { $cond: [{ $eq: ['$severity_level', 'critical'] }, 1, 0] } },
                high: { $sum: { $cond: [{ $eq: ['$severity_level', 'high'] }, 1, 0] } },
                moderate: { $sum: { $cond: [{ $eq: ['$severity_level', 'moderate'] }, 1, 0] } },
                low: { $sum: { $cond: [{ $eq: ['$severity_level', 'low'] }, 1, 0] } },
                active_dispatches: { $sum: { $cond: [{ $eq: ['$status', 'dispatched'] }, 1, 0] } },
                last_hour: { $sum: { $cond: [{ $gt: ['$created_at', oneHourAgo] }, 1, 0] } }
              }
            }
          ]
        }
      }
    ]).toArray(),

    db.collection('dispatches').aggregate([
      { $match: { dispatched_at: { $gt: twentyFourHoursAgo } } },
      {
        $group: {
          _id: null,
          avg_transit_minutes: { $avg: '$estimated_transit_minutes' },
          avg_routing_score: { $avg: '$routing_score' },
          rerouted_count: { $sum: { $cond: [{ $gt: ['$recalculation_count', 0] }, 1, 0] } }
        }
      }
    ]).toArray(),

    db.collection('hospitals').aggregate([
      { $match: { is_active: true } },
      {
        $group: {
          _id: null,
          total_hospitals: { $sum: 1 },
          on_diversion: { $sum: { $cond: ['$is_on_diversion', 1, 0] } },
          total_icu_available: { $sum: '$icu_beds_available' },
          total_ventilators_available: { $sum: '$ventilators_available' },
          avg_load_percent: { $avg: '$current_load_percent' }
        }
      }
    ]).toArray()
  ]);

  res.json({
    success: true,
    data: {
      patients: patientStats[0]?.counts[0] || { total: 0, critical: 0, high: 0, moderate: 0, low: 0, active_dispatches: 0, last_hour: 0 },
      dispatches: dispatchStats[0] || { avg_transit_minutes: 0, avg_routing_score: 0, rerouted_count: 0 },
      system: hospitalStats[0] || { total_hospitals: 0, on_diversion: 0, total_icu_available: 0, total_ventilators_available: 0, avg_load_percent: 0 },
    },
  });
}));

module.exports = router;
