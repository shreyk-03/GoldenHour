const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';
process.env.JWT_EXPIRES_IN = '1h';

const {
  requireAuth,
  requireRole,
  requireHospitalScope,
  signToken,
} = require('../src/middleware/auth');

const mockRes = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const dispatcher = { id: 'u1', email: 'dispatcher@goldenhour.dev', role: 'dispatcher' };
const hospital = { id: 'u2', email: 'hospital@goldenhour.dev', role: 'hospital', hospital_id: 'h1' };

test('requireAuth accepts a valid bearer token and attaches the user', () => {
  const req = { headers: { authorization: `Bearer ${signToken(dispatcher)}` } };
  const res = mockRes();
  let called = false;

  requireAuth(req, res, () => { called = true; });

  assert.equal(called, true);
  assert.equal(req.user.role, 'dispatcher');
  assert.equal(res.body, null);
});

test('requireAuth rejects missing, malformed and expired tokens', () => {
  for (const req of [
    { headers: {} },
    { headers: { authorization: 'Token abc' } },
    { headers: { authorization: `Bearer ${jwt.sign(dispatcher, process.env.JWT_SECRET, { expiresIn: -10 })}` } },
  ]) {
    const res = mockRes();
    let called = false;
    requireAuth(req, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
  }
});

test('requireAuth reports expired sessions distinctly', () => {
  const token = jwt.sign(dispatcher, process.env.JWT_SECRET, { expiresIn: -10 });
  const res = mockRes();
  requireAuth({ headers: { authorization: `Bearer ${token}` } }, res, () => {});
  assert.equal(res.body.error, 'Session expired, please sign in again');
});

test('requireRole enforces the allowed roles', () => {
  const denied = mockRes();
  let deniedNext = false;
  requireRole('admin', 'dispatcher')({ user: hospital }, denied, () => { deniedNext = true; });
  assert.equal(deniedNext, false);
  assert.equal(denied.statusCode, 403);

  const allowed = mockRes();
  let allowedNext = false;
  requireRole('admin', 'dispatcher')({ user: dispatcher }, allowed, () => { allowedNext = true; });
  assert.equal(allowedNext, true);
});

test('requireHospitalScope only constrains hospital users to their own record', () => {
  const own = mockRes();
  let ownNext = false;
  requireHospitalScope('id')({ user: hospital, params: { id: 'h1' } }, own, () => { ownNext = true; });
  assert.equal(ownNext, true);

  const foreign = mockRes();
  let foreignNext = false;
  requireHospitalScope('id')({ user: hospital, params: { id: 'h2' } }, foreign, () => { foreignNext = true; });
  assert.equal(foreignNext, false);
  assert.equal(foreign.statusCode, 403);

  const dispatcherReq = mockRes();
  let dispatcherNext = false;
  requireHospitalScope('id')({ user: dispatcher, params: { id: 'h2' } }, dispatcherReq, () => { dispatcherNext = true; });
  assert.equal(dispatcherNext, true);
});
