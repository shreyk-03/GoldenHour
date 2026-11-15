const app = require('../src/app');
const { connectDB } = require('../src/db/mongodb');

let dbReady = null;

const ensureDB = () => {
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

  await ensureDB();
  return app(req, res);
};
