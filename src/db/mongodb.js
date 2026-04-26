const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/emergency_triage';
const client = new MongoClient(uri);

let db;

const connectDB = async () => {
  try {
    await client.connect();
    db = client.db();
    console.log('[MongoDB] Connected successfully to:', db.databaseName);
    
    // Create necessary indexes
    await db.collection('hospitals').createIndex({ location: '2dsphere' });
    await db.collection('patients').createIndex({ incident_id: 1 }, { unique: true });
    await db.collection('dispatches').createIndex({ patient_id: 1 });
    await db.collection('cache').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
    
    return true;
  } catch (err) {
    console.error('[MongoDB] Connection failed:', err.message);
    return false;
  }
};

const getDB = () => {
  if (!db) {
    throw new Error('Database not initialized. Call connectDB first.');
  }
  return db;
};

module.exports = { connectDB, getDB, client };
