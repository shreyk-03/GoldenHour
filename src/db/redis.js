const { getDB } = require('./mongodb');

// ============================================================
// MONGODB-BASED CACHE SYSTEM (Redis Replacement)
// ============================================================

const HOSPITAL_CAPACITY_TTL = 60; // seconds
const ALL_HOSPITALS_TTL = 30;

const connect = async () => {
  console.log('[Cache] Using MongoDB for caching');
  return true;
};

const getClient = () => null;

const testConnection = async () => true;

/**
 * Core Set function with TTL support
 */
const set = async (key, value, ttlSeconds = 300) => {
  const db = getDB();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  
  await db.collection('cache').updateOne(
    { key },
    { $set: { value, expires_at: expiresAt, updated_at: new Date() } },
    { upsert: true }
  );
};

/**
 * Core Get function
 */
const get = async (key) => {
  const db = getDB();
  const doc = await db.collection('cache').findOne({ key });
  
  if (!doc) return null;
  
  // Check if manually expired (TTL index might take a minute to clean up)
  if (doc.expires_at && doc.expires_at < new Date()) {
    return null;
  }
  
  return doc.value;
};

/**
 * Core Del function
 */
const del = async (key) => {
  const db = getDB();
  await db.collection('cache').deleteOne({ key });
};

// --- Specialized Wrappers ---

const setHospitalCapacity = async (hospitalId, capacityData) => {
  await set(`hospital:${hospitalId}:capacity`, capacityData, HOSPITAL_CAPACITY_TTL);
};

const getHospitalCapacity = async (hospitalId) => {
  return await get(`hospital:${hospitalId}:capacity`);
};

const setAllHospitals = async (hospitals) => {
  await set('hospitals:all', hospitals, ALL_HOSPITALS_TTL);
};

const getAllHospitals = async () => {
  return await get('hospitals:all');
};

const invalidateHospitalCache = async (hospitalId) => {
  const db = getDB();
  await db.collection('cache').deleteMany({
    key: { $in: [`hospital:${hospitalId}:capacity`, 'hospitals:all'] }
  });
};

const setActiveDispatch = async (patientId, dispatchData) => {
  await set(`dispatch:active:${patientId}`, dispatchData, 3600); // 1hr TTL
};

const getActiveDispatch = async (patientId) => {
  return await get(`dispatch:active:${patientId}`);
};

const removeActiveDispatch = async (patientId) => {
  await del(`dispatch:active:${patientId}`);
};

const incrementMCEAssignment = async (mceId, hospitalId) => {
  const db = getDB();
  const key = `mce:${mceId}:hospital:${hospitalId}:count`;
  const expiresAt = new Date(Date.now() + 7200 * 1000); // 2hr TTL
  
  const result = await db.collection('cache').findOneAndUpdate(
    { key },
    { 
      $inc: { value: 1 },
      $set: { expires_at: expiresAt, updated_at: new Date() }
    },
    { upsert: true, returnDocument: 'after' }
  );
  
  return result.value;
};

const getMCEAssignmentCount = async (mceId, hospitalId) => {
  const count = await get(`mce:${mceId}:hospital:${hospitalId}:count`);
  return parseInt(count) || 0;
};

const getMCEAllAssignments = async (mceId) => {
  const db = getDB();
  const pattern = new RegExp(`^mce:${mceId}:hospital:.*:count$`);
  
  const docs = await db.collection('cache').find({ key: pattern }).toArray();
  
  const assignments = {};
  docs.forEach(doc => {
    const hospitalId = doc.key.split(':')[3];
    assignments[hospitalId] = parseInt(doc.value) || 0;
  });
  
  return assignments;
};

module.exports = {
  connect,
  getClient,
  testConnection,
  setHospitalCapacity,
  getHospitalCapacity,
  invalidateHospitalCache,
  setAllHospitals,
  getAllHospitals,
  setActiveDispatch,
  getActiveDispatch,
  removeActiveDispatch,
  incrementMCEAssignment,
  getMCEAssignmentCount,
  getMCEAllAssignments,
  set,
  get,
  del,
};
