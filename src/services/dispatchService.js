const { v4: uuidv4 } = require('uuid');
const { getDB, client: mongoClient } = require('../db/mongodb');
const redis = require('../db/redis');
const { predictSeverityAndCareNeeds } = require('./severityPredictor');
const { findOptimalHospital, batchRoute } = require('./routingEngine');
const { getWebSocketBroadcaster } = require('../websocket/broadcaster');

// ============================================================
// SINGLE PATIENT DISPATCH
// ============================================================

/**
 * Full dispatch pipeline for a single patient
 */
const dispatchPatient = async (patientData) => {
  const db = getDB();
  const broadcast = getWebSocketBroadcaster();

  // ---- Step 1: Save or update patient record ----
  const incidentId = patientData.incident_id || `INC-${Date.now()}`;

  const patientDoc = {
    incident_id: incidentId,
    age: patientData.age,
    gender: patientData.gender,
    weight_kg: patientData.weight_kg,
    heart_rate: patientData.heart_rate,
    systolic_bp: patientData.systolic_bp,
    diastolic_bp: patientData.diastolic_bp,
    respiratory_rate: patientData.respiratory_rate,
    spo2: patientData.spo2,
    temperature: patientData.temperature,
    gcs_score: patientData.gcs_score,
    blood_glucose: patientData.blood_glucose,
    symptoms: patientData.symptoms || [],
    mechanism_of_injury: patientData.mechanism_of_injury,
    chief_complaint: patientData.chief_complaint,
    incident_location: {
      type: 'Point',
      coordinates: [patientData.incident_longitude, patientData.incident_latitude]
    },
    incident_address: patientData.incident_address,
    status: 'pending',
    updated_at: new Date(),
    created_at: new Date()
  };

  const result = await db.collection('patients').findOneAndUpdate(
    { incident_id: incidentId },
    { 
      $set: { ...patientDoc, updated_at: new Date() },
      $setOnInsert: { created_at: new Date() }
    },
    { upsert: true, returnDocument: 'after' }
  );

  const patientId = result._id;

  // ---- Step 2: Run Severity Prediction ----
  broadcast({ type: 'DISPATCH_PROGRESS', patientId, stage: 'severity_prediction', message: 'Analyzing patient vitals...' });

  const prediction = predictSeverityAndCareNeeds(patientData);

  // Update patient with prediction results
  await db.collection('patients').updateOne(
    { _id: patientId },
    { 
      $set: {
        news2_score: prediction.news2Score,
        severity_level: prediction.severityLevel,
        predicted_care_needs: prediction.predictedCareNeeds,
        status: 'dispatching',
        updated_at: new Date()
      }
    }
  );

  // ---- Step 3: Run Routing Engine ----
  broadcast({ type: 'DISPATCH_PROGRESS', patientId, stage: 'routing', message: 'Finding optimal hospital...' });

  const incidentLocation = {
    latitude: patientData.incident_latitude,
    longitude: patientData.incident_longitude,
  };

  const routingResult = await findOptimalHospital(
    { ...prediction.predictedCareNeeds, severityLevel: prediction.severityLevel },
    incidentLocation,
    { mceId: patientData.mce_id }
  );

  if (!routingResult.success) {
    await db.collection('patients').updateOne({ _id: patientId }, { $set: { status: 'routing_failed' } });
    return { success: false, patientId, error: routingResult.error };
  }

  const { optimal, alternatives, rationale } = routingResult;

  // ---- Step 4: Save Dispatch Record (using Session for Atomicity) ----
  const session = mongoClient.startSession();
  let dispatchId;

  try {
    await session.withTransaction(async () => {
      // Create dispatch record
      const dispatchDoc = {
        patient_id: patientId,
        assigned_hospital_id: optimal.hospital.id,
        routing_score: optimal.totalScore,
        estimated_transit_minutes: optimal.transitMinutes,
        routing_rationale: { rationale, breakdown: optimal.breakdown, reasons: optimal.reasons },
        alternatives_evaluated: alternatives,
        is_mass_casualty_event: !!patientData.mce_id,
        mce_incident_id: patientData.mce_id || null,
        dispatched_at: new Date()
      };

      const dResult = await db.collection('dispatches').insertOne(dispatchDoc, { session });
      dispatchId = dResult.insertedId;

      // Update patient status to dispatched
      await db.collection('patients').updateOne(
        { _id: patientId },
        { $set: { status: 'dispatched', updated_at: new Date() } },
        { session }
      );

      // Decrease available resources at assigned hospital
      await db.collection('hospitals').updateOne(
        { id: optimal.hospital.id },
        { 
          $inc: {
            icu_beds_available: prediction.predictedCareNeeds.icu ? -1 : 0,
            ventilators_available: prediction.predictedCareNeeds.ventilator ? -1 : 0,
            current_load_percent: 2
          },
          $set: { updated_at: new Date() }
        },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  // ---- Step 5: Cache active dispatch in Redis ----
  const activeDispatch = {
    patientId,
    dispatchId,
    hospital: optimal.hospital,
    transitMinutes: optimal.transitMinutes,
    prediction,
    routingResult,
    dispatchedAt: new Date().toISOString(),
  };

  await redis.setActiveDispatch(patientId, activeDispatch);
  await redis.invalidateHospitalCache(optimal.hospital.id);

  // If MCE, increment hospital assignment counter
  if (patientData.mce_id) {
    await redis.incrementMCEAssignment(patientData.mce_id, optimal.hospital.id);
  }

  // ---- Step 6: Broadcast to WebSocket clients ----
  broadcast({
    type: 'DISPATCH_COMPLETE',
    patientId,
    incidentId,
    severity: prediction.severityLevel,
    news2Score: prediction.news2Score,
    assignedHospital: {
      id: optimal.hospital.id,
      name: optimal.hospital.name,
      latitude: optimal.hospital.latitude,
      longitude: optimal.hospital.longitude,
    },
    transitMinutes: optimal.transitMinutes,
    score: optimal.totalScore,
    rationale,
    careNeeds: prediction.predictedCareNeeds,
    dispatchedAt: activeDispatch.dispatchedAt,
  });

  return {
    success: true,
    patientId,
    incidentId,
    dispatchId,
    prediction,
    routing: routingResult,
    rationale,
  };
};

// ============================================================
// REROUTE — Mid-journey recalculation
// ============================================================

/**
 * Recalculate routing mid-journey (hospital reached capacity, road closure, etc.)
 */
const reroutePatient = async (patientId, reason, currentLocation) => {
  const db = getDB();
  const broadcast = getWebSocketBroadcaster();

  // Get active dispatch
  const activeDispatch = await redis.getActiveDispatch(patientId);
  if (!activeDispatch) {
    throw new Error('No active dispatch found for patient');
  }

  // Get current dispatch from DB
  const dispatch = await db.collection('dispatches').findOne(
    { patient_id: patientId },
    { sort: { dispatched_at: -1 } }
  );

  if (!dispatch) throw new Error('Dispatch record not found');

  // Re-run routing excluding the original hospital
  const patient = await db.collection('patients').findOne({ _id: patientId });
  if (!patient) throw new Error('Patient record not found');

  const careNeeds = patient.predicted_care_needs;
  const location = currentLocation || {
    latitude: patient.incident_location.coordinates[1],
    longitude: patient.incident_location.coordinates[0],
  };

  const newRouting = await findOptimalHospital(careNeeds, location, {
    excludeHospitalIds: [dispatch.assigned_hospital_id],
  });

  if (!newRouting.success) {
    return { success: false, error: 'No alternative hospital available' };
  }

  // Update dispatch record
  const recalcLog = dispatch.recalculation_log || [];
  recalcLog.push({
    timestamp: new Date().toISOString(),
    reason,
    previousHospitalId: dispatch.assigned_hospital_id,
    newHospitalId: newRouting.optimal.hospital.id,
  });

  await db.collection('dispatches').updateOne(
    { _id: dispatch._id },
    {
      $set: {
        assigned_hospital_id: newRouting.optimal.hospital.id,
        routing_score: newRouting.optimal.totalScore,
        estimated_transit_minutes: newRouting.optimal.transitMinutes,
        routing_rationale: { rationale: newRouting.rationale, breakdown: newRouting.optimal.breakdown },
        recalculation_log: recalcLog
      },
      $inc: { recalculation_count: 1 }
    }
  );

  // Broadcast reroute event
  broadcast({
    type: 'PATIENT_REROUTED',
    patientId,
    reason,
    newHospital: {
      id: newRouting.optimal.hospital.id,
      name: newRouting.optimal.hospital.name,
      latitude: newRouting.optimal.hospital.latitude,
      longitude: newRouting.optimal.hospital.longitude,
    },
    newTransitMinutes: newRouting.optimal.transitMinutes,
    rationale: newRouting.rationale,
  });

  return { success: true, newRouting };
};

// ============================================================
// BATCH DISPATCH (Mass Casualty Event)
// ============================================================

const dispatchBatch = async (patientsData, mceId) => {
  const broadcast = getWebSocketBroadcaster();

  broadcast({ type: 'MCE_BATCH_STARTED', mceId, patientCount: patientsData.length });

  // Run triage prediction for all patients
  const preparedPatients = patientsData.map(p => ({
    patientId: p.incident_id || uuidv4(),
    careNeeds: {
      ...predictSeverityAndCareNeeds(p).predictedCareNeeds,
      severityLevel: predictSeverityAndCareNeeds(p).severityLevel,
    },
    incidentLocation: {
      latitude: p.incident_latitude,
      longitude: p.incident_longitude,
    },
  }));

  const batchResult = await batchRoute(preparedPatients, mceId);

  broadcast({ type: 'MCE_BATCH_COMPLETE', mceId, summary: batchResult });

  return batchResult;
};

module.exports = { dispatchPatient, reroutePatient, dispatchBatch };
