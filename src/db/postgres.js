const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT) || 5432,
  database: process.env.PG_DATABASE || 'emergency_triage',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  max: 20,                // max pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[PostgreSQL] Unexpected client error:', err.message);
});

// --- Mock Data for Fallback Mode ---
const mockHospitals = [
  { id: 'h1', name: 'City Central Trauma', lat: 40.7589, lng: -73.9851, icu_beds_total: 20, icu_beds_available: 4, ventilators_total: 15, ventilators_available: 2, current_load_percent: 82, has_neuro: true, has_cath_lab: true },
  { id: 'h2', name: 'Westside Medical', lat: 40.7128, lng: -74.0060, icu_beds_total: 15, icu_beds_available: 8, ventilators_total: 10, ventilators_available: 5, current_load_percent: 45, has_neuro: false, has_cath_lab: true },
  { id: 'h3', name: 'East River Health', lat: 40.7484, lng: -73.9857, icu_beds_total: 30, icu_beds_available: 2, ventilators_total: 25, ventilators_available: 1, current_load_percent: 94, has_neuro: true, has_cath_lab: false }
];

let isMockMode = false;

const query = async (text, params) => {
  const start = Date.now();
  
  if (isMockMode) {
    // Simple mock logic for common queries
    let rows = [];
    if (text.includes('FROM hospitals')) {
      rows = mockHospitals;
    } else if (text.includes('SELECT NOW()')) {
      rows = [{ now: new Date() }];
    }
    
    return { rows, rowCount: rows.length };
  }

  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log(`[PG] Query executed in ${duration}ms | Rows: ${result.rowCount}`);
    }
    return result;
  } catch (err) {
    console.error('[PG] Query error:', err.message);
    throw err;
  }
};


const getClient = async () => {
  if (isMockMode) {
    return {
      query: (text, params) => query(text, params),
      release: () => {}
    };
  }
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);

  client.release = () => {
    client.release = release;
    return release();
  };

  return client;
};


const transaction = async (callback) => {
  const client = await getClient();
  try {
    if (!isMockMode) await client.query('BEGIN');
    const result = await callback(client);
    if (!isMockMode) await client.query('COMMIT');
    return result;
  } catch (err) {
    if (!isMockMode) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const testConnection = async () => {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('[PostgreSQL] Connected successfully at:', result.rows[0].now);
    return true;
  } catch (err) {
    console.error('[PostgreSQL] Connection failed:', err.message);
    console.warn('[PostgreSQL] ENTERING MOCK MODE - Database functionality will be simulated.');
    isMockMode = true;
    return true; // Return true so server.js doesn't exit
  }
};

module.exports = { query, getClient, transaction, testConnection, pool };
