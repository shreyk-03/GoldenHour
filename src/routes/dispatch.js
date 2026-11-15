const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { validate, patientVitalsSchema, batchDispatchSchema, rerouteSchema } = require('../middleware/validation');
const { dispatchPatient, reroutePatient, dispatchBatch } = require('../services/dispatchService');
const { predictSeverityAndCareNeeds } = require('../services/severityPredictor');
const { getDB, ObjectId } = require('../db/store');
const redis = require('../db/redis');

/**
 * POST /api/dispatch
 * Main dispatch endpoint — triage + routing in one call
 */
router.post('/', validate(patientVitalsSchema), asyncHandler(async (req, res) => {
  const result = await dispatchPatient(req.body);
  
  if (!result.success) {
    return res.status(422).json({ success: false, error: result.error });
  }

  res.status(201).json({
    success: true,
    message: 'Patient dispatched successfully',
    data: result,
  });
}));

/**
 * POST /api/dispatch/triage-only
 * Run severity prediction only — without triggering dispatch
 */
router.post('/triage-only', asyncHandler(async (req, res) => {
  const prediction = predictSeverityAndCareNeeds(req.body);
  res.json({ success: true, data: prediction });
}));

/**
 * POST /api/dispatch/batch
 * Mass casualty event — route multiple patients at once
 */
router.post('/batch', validate(batchDispatchSchema), asyncHandler(async (req, res) => {
  const { mce_id, description, patients } = req.body;
  const db = getDB();

  // Create MCE record
  await db.collection('mass_casualty_events').updateOne(
    { incident_id: mce_id },
    { 
      $set: { 
        description: description || 'Mass Casualty Event', 
        total_patients: patients.length,
        status: 'active',
        updated_at: new Date()
      },
      $setOnInsert: { started_at: new Date() }
    },
    { upsert: true }
  );

  const result = await dispatchBatch(patients, mce_id);
  res.status(201).json({ success: true, data: result });
}));

/**
 * POST /api/dispatch/:patientId/reroute
 * Recalculate routing mid-journey
 */
router.post('/:patientId/reroute', validate(rerouteSchema), asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  const { reason, current_latitude, current_longitude } = req.body;

  const currentLocation = (current_latitude && current_longitude)
    ? { latitude: current_latitude, longitude: current_longitude }
    : null;

  const result = await reroutePatient(patientId, reason, currentLocation);
  
  if (!result.success) {
    return res.status(422).json({ success: false, error: result.error });
  }

  res.json({ success: true, message: 'Patient rerouted', data: result });
}));

/**
 * GET /api/dispatch/:patientId
 * Get active dispatch status for a patient
 */
router.get('/:patientId', asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  const db = getDB();

  // Try Redis first for live dispatch
  const activeDispatch = await redis.getActiveDispatch(patientId);
  if (activeDispatch) {
    return res.json({ success: true, source: 'live', data: activeDispatch });
  }

  // Fall back to the document store
  const latest = await db.collection('dispatches')
    .find({ patient_id: patientId })
    .sort({ dispatched_at: -1 })
    .limit(1)
    .toArray();

  if (!latest.length) {
    return res.status(404).json({ success: false, error: 'Dispatch not found' });
  }

  const dispatch = latest[0];
  const patient = await db.collection('patients').findOne({ _id: dispatch.patient_id });
  const hospital = await db.collection('hospitals').findOne({ id: dispatch.assigned_hospital_id });
  const coordinates = hospital?.location?.coordinates || [];

  res.json({
    success: true,
    source: 'database',
    data: {
      ...dispatch,
      incident_id: patient?.incident_id,
      severity_level: patient?.severity_level,
      news2_score: patient?.news2_score,
      predicted_care_needs: patient?.predicted_care_needs,
      status: patient?.status,
      hospital_name: hospital?.name,
      hospital_address: hospital?.address,
      hospital_latitude: coordinates[1],
      hospital_longitude: coordinates[0],
    },
  });
}));

/**
 * PATCH /api/dispatch/:patientId/status
 * Update patient/dispatch status (arrived, treated, etc.)
 */
router.patch('/:patientId/status', asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  const { status } = req.body;
  const db = getDB();

  const validStatuses = ['en_route', 'arrived', 'treated', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  let oid;
  try { oid = new ObjectId(patientId); } catch(e) {}

  await db.collection('patients').updateOne(
    { _id: oid || patientId },
    { $set: { status, updated_at: new Date() } }
  );

  if (status === 'arrived') {
    await db.collection('dispatches').updateOne(
      { patient_id: oid || patientId },
      { $set: { arrived_at: new Date() } },
      { sort: { dispatched_at: -1 } }
    );
  } else if (status === 'treated') {
    await db.collection('dispatches').updateOne(
      { patient_id: oid || patientId },
      { $set: { completed_at: new Date() } },
      { sort: { dispatched_at: -1 } }
    );
    await redis.removeActiveDispatch(patientId);
  }

  res.json({ success: true, message: `Patient status updated to '${status}'` });
}));

module.exports = router;
