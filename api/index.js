const app = require('../src/app');
const { connectDB, isConfigured } = require('../src/db/store');

const hasStoreConfig = isConfigured();

const needsDatabase = (url) =>
  url.startsWith('/api/hospitals') ||
  url.startsWith('/api/dispatch') ||
  (url.startsWith('/api/patients') && !url.startsWith('/api/patients/vitals'));

let dbReady = null;

const ensureDB = () => {
  if (!hasStoreConfig) return Promise.resolve(false);
  if (!dbReady) {
    dbReady = connectDB().catch((err) => {
      console.error('[Vercel] Redis connection error:', err.message);
      return false;
    });
  }
  return dbReady;
};

module.exports = async (req, res) => {
  if (req.url === '/health' || req.url.startsWith('/health?')) {
    const connected = await ensureDB();
    return res.status(200).json({
      status: 'ok',
      service: 'Emergency Triage & Routing System',
      database: connected ? 'connected' : 'unavailable',
      timestamp: new Date().toISOString(),
    });
  }

  if (!hasStoreConfig && needsDatabase(req.url)) {
    return res.status(503).json({
      success: false,
      error: 'Database not configured. Connect Upstash Redis to this Vercel project.',
    });
  }

  await ensureDB();
  return app(req, res);
};
