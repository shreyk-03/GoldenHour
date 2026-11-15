const { getDB } = require('../db/store');
const { invalidateHospitalCache } = require('../db/redis');
const { getWebSocketBroadcaster } = require('../websocket/broadcaster');

const SIMULATION_INTERVAL_MS = 20_000; // 20 seconds
let intervalId = null;
let isRunning = false;

/**
 * Generate a random integer between min and max (inclusive)
 */
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Pick n random items from an array
 */
const pickRandom = (arr, n) => {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(n, arr.length));
};

/**
 * Simulate a single hospital capacity change
 */
const simulateHospitalChange = async (hospital, broadcast) => {
  const db = getDB();
  
  // Decide event type: admission (60%) or discharge (40%)
  const isAdmission = Math.random() < 0.6;

  let icuDelta = 0;
  let ventDelta = 0;
  let loadDelta = 0;
  let eventDescription = '';

  if (isAdmission) {
    // Patient admission — beds decrease, load increases
    icuDelta = -randInt(0, 2);
    ventDelta = -randInt(0, 1);
    loadDelta = randInt(1, 4);
    eventDescription = 'Patient admitted';
  } else {
    // Patient discharge — beds increase, load decreases
    icuDelta = randInt(0, 2);
    ventDelta = randInt(0, 1);
    loadDelta = -randInt(1, 5);
    eventDescription = 'Patient discharged';
  }

  // Apply changes with safety bounds
  const newIcu = Math.max(0, Math.min(hospital.icu_beds_total, hospital.icu_beds_available + icuDelta));
  const newVent = Math.max(0, Math.min(hospital.ventilators_total, hospital.ventilators_available + ventDelta));
  const newLoad = Math.max(15, Math.min(98, hospital.current_load_percent + loadDelta));

  // Skip if no meaningful change
  if (newIcu === hospital.icu_beds_available && 
      newVent === hospital.ventilators_available && 
      newLoad === hospital.current_load_percent) {
    return null;
  }

  // Write to the document store
  await db.collection('hospitals').updateOne(
    { id: hospital.id },
    {
      $set: {
        icu_beds_available: newIcu,
        ventilators_available: newVent,
        current_load_percent: newLoad,
        updated_at: new Date()
      }
    }
  );

  // Log to capacity history
  await db.collection('hospital_capacity_log').insertOne({
    hospital_id: hospital.id,
    icu_beds_available: newIcu,
    ventilators_available: newVent,
    current_load_percent: newLoad,
    logged_at: new Date()
  });

  // Invalidate Redis cache
  await invalidateHospitalCache(hospital.id);

  const update = {
    hospitalId: hospital.id,
    hospitalName: hospital.name,
    event: eventDescription,
    changes: {
      icu_beds_available: { from: hospital.icu_beds_available, to: newIcu },
      ventilators_available: { from: hospital.ventilators_available, to: newVent },
      current_load_percent: { from: hospital.current_load_percent, to: newLoad },
    },
  };

  // Broadcast via WebSocket
  broadcast({
    type: 'HOSPITAL_CAPACITY_UPDATED',
    ...update,
  });

  return update;
};

/**
 * Run one simulation cycle
 */
const runCycle = async () => {
  try {
    const db = getDB();
    const broadcast = getWebSocketBroadcaster();

    // Fetch all active hospitals
    const hospitals = await db.collection('hospitals')
      .find({ is_active: true })
      .toArray();

    if (hospitals.length === 0) return;

    // Pick 2-4 random hospitals to update this cycle
    const hospitalsToUpdate = pickRandom(hospitals, randInt(2, 4));

    const changes = [];
    for (const hospital of hospitalsToUpdate) {
      const change = await simulateHospitalChange(hospital, broadcast);
      if (change) changes.push(change);
    }

    if (changes.length > 0 && process.env.NODE_ENV === 'development') {
      console.log(`[Simulation] Updated ${changes.length} hospital(s):`,
        changes.map(c => `${c.hospitalName} (${c.event})`).join(', '));
    }
  } catch (err) {
    console.error('[Simulation] Cycle error:', err.message);
  }
};

/**
 * Start the simulation engine
 */
const startSimulation = () => {
  if (isRunning) {
    console.log('[Simulation] Already running');
    return;
  }

  isRunning = true;
  console.log(`[Simulation] Starting real-time hospital simulation (every ${SIMULATION_INTERVAL_MS / 1000}s)`);

  // Run first cycle after 5 seconds (let everything initialize)
  setTimeout(() => {
    runCycle();
    intervalId = setInterval(runCycle, SIMULATION_INTERVAL_MS);
  }, 5000);
};

/**
 * Stop the simulation engine
 */
const stopSimulation = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  isRunning = false;
  console.log('[Simulation] Stopped');
};

module.exports = { startSimulation, stopSimulation, runCycle };
