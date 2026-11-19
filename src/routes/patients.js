const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { getDB, ObjectId } = require('../db/store');
const { requireAuth } = require('../middleware/auth');
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
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { status, severity, limit = 50, offset = 0 } = req.query;
  const db = getDB();

  const queryObj = {};
  if (status) queryObj.status = status;
  if (severity) queryObj.severity_level = severity;

  // Join against the latest dispatch so the list shows current assignment
  const patients = await db.collection('patients')
    .find(queryObj)
    .sort({ created_at: -1 })
    .skip(parseInt(offset))
    .limit(parseInt(limit))
    .toArray();

  if (patients.length) {
    const [dispatches, hospitals] = await Promise.all([
      db.collection('dispatches').find({}).toArray(),
      db.collection('hospitals').find({}).toArray(),
    ]);

    for (const patient of patients) {
      const latest = dispatches
        .filter((dispatch) => String(dispatch.patient_id) === String(patient._id))
        .sort((a, b) => String(b.dispatched_at).localeCompare(String(a.dispatched_at)))[0];
      const hospital = latest ? hospitals.find((entry) => entry.id === latest.assigned_hospital_id) : null;
      const coordinates = hospital?.location?.coordinates || [];

      patient.assigned_hospital_id = latest?.assigned_hospital_id;
      patient.assigned_hospital_name = hospital?.name;
      patient.assigned_hospital_latitude = coordinates[1] ?? hospital?.latitude;
      patient.assigned_hospital_longitude = coordinates[0] ?? hospital?.longitude;
      patient.estimated_transit_minutes = latest?.estimated_transit_minutes;
      patient.dispatched_at = latest?.dispatched_at;
      patient.arrived_at = latest?.arrived_at;
      patient.routing_rationale_text = latest?.routing_rationale?.rationale || null;
    }
  }

  res.json({ success: true, count: patients.length, data: patients });
}));

/**
 * GET /api/patients/:id
 * Get full patient record with dispatch history
 */
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const db = getDB();
  
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

  const dispatches = await db.collection('dispatches')
    .find({ patient_id: patientId })
    .sort({ dispatched_at: -1 })
    .toArray();

  const hospitals = await db.collection('hospitals').find({}).toArray();
  const enrichedDispatches = dispatches.map((dispatch) => {
    const hospital = hospitals.find((entry) => entry.id === dispatch.assigned_hospital_id);
    const coordinates = hospital?.location?.coordinates || [];
    return {
      ...dispatch,
      hospital_name: hospital?.name,
      latitude: coordinates[1] ?? hospital?.latitude,
      longitude: coordinates[0] ?? hospital?.longitude,
    };
  });

  res.json({
    success: true,
    data: {
      patient: patient,
      dispatches: enrichedDispatches,
    },
  });
}));

/**
 * GET /api/patients/analytics/summary
 * Dashboard summary stats
 */
router.get('/analytics/summary', requireAuth, asyncHandler(async (req, res) => {
  const db = getDB();
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
  const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));

  const [patients, dispatches, hospitals] = await Promise.all([
    db.collection('patients').find({}).toArray(),
    db.collection('dispatches').find({}).toArray(),
    db.collection('hospitals').find({ is_active: true }).toArray(),
  ]);

  const countSeverity = (level) => patients.filter((patient) => patient.severity_level === level).length;
  const average = (values) => {
    const numbers = values.filter((value) => typeof value === 'number' && !Number.isNaN(value));
    return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : 0;
  };
  const recentDispatches = dispatches.filter((dispatch) => {
    const dispatchedAt = Date.parse(dispatch.dispatched_at);
    return !Number.isNaN(dispatchedAt) && dispatchedAt > twentyFourHoursAgo.getTime();
  });

  const patientStats = {
    total: patients.length,
    critical: countSeverity('critical'),
    high: countSeverity('high'),
    moderate: countSeverity('moderate'),
    low: countSeverity('low'),
    active_dispatches: patients.filter((patient) => patient.status === 'dispatched').length,
    last_hour: patients.filter((patient) => {
      const createdAt = Date.parse(patient.created_at);
      return !Number.isNaN(createdAt) && createdAt > oneHourAgo.getTime();
    }).length,
  };

  const dispatchStats = {
    avg_transit_minutes: average(recentDispatches.map((dispatch) => dispatch.estimated_transit_minutes)),
    avg_routing_score: average(recentDispatches.map((dispatch) => dispatch.routing_score)),
    rerouted_count: recentDispatches.filter((dispatch) => (dispatch.recalculation_count || 0) > 0).length,
  };

  const systemStats = {
    total_hospitals: hospitals.length,
    on_diversion: hospitals.filter((hospital) => hospital.is_on_diversion).length,
    total_icu_available: hospitals.reduce((sum, hospital) => sum + (hospital.icu_beds_available || 0), 0),
    total_ventilators_available: hospitals.reduce((sum, hospital) => sum + (hospital.ventilators_available || 0), 0),
    avg_load_percent: average(hospitals.map((hospital) => hospital.current_load_percent)),
  };

  res.json({
    success: true,
    data: {
      patients: patientStats,
      dispatches: dispatchStats,
      system: systemStats,
    },
  });
}));

module.exports = router;
