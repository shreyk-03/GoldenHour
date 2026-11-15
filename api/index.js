const app = require('../src/app');
const { connectDB } = require('../src/db/mongodb');

const hasMongoConfig = Boolean(process.env.MONGODB_URI);

const needsDatabase = (url) =>
  url.startsWith('/api/hospitals') ||
  url.startsWith('/api/dispatch') ||
  (url.startsWith('/api/patients') && !url.startsWith('/api/patients/vitals'));

let dbReady = null;

const ensureDB = () => {
  if (!hasMongoConfig) return Promise.resolve(false);
  if (!dbReady) {
    dbReady = connectDB().catch((err) => {
      console.error('[Vercel] MongoDB connection error:', err.message);
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

  if (!hasMongoConfig && needsDatabase(req.url)) {
    return res.status(503).json({
      success: false,
      error: 'Database not configured. Set MONGODB_URI in the deployment environment.',
    });
  }

  await ensureDB();
  return app(req, res);
};
