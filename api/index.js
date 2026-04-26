const app = require('../src/app');
const { connectDB } = require('../src/db/mongodb');

let isConnected = false;

module.exports = async (req, res) => {
  if (!isConnected) {
    try {
      const success = await connectDB();
      if (success) {
        isConnected = true;
      }
    } catch (err) {
      console.error('[Vercel] MongoDB Connection Error:', err);
    }
  }
  
  // Hand off the request to the Express app
  return app(req, res);
};
