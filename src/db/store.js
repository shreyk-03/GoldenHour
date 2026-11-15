const { randomBytes } = require('crypto');
require('dotenv').config({ path: '.env.local' });

const PREFIX = 'goldenhour:';

class ObjectId {
  constructor(value) {
    if (value === undefined) {
      this.id = randomBytes(12).toString('hex');
    } else {
      const hex = String(value).toLowerCase();
      if (!/^[a-f0-9]{24}$/.test(hex)) {
        throw new Error(`Invalid ObjectId: ${value}`);
      }
      this.id = hex;
    }
  }
  toHexString() { return this.id; }
  toString() { return this.id; }
  toJSON() { return this.id; }
}

const credentials = () => {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
};

const isConfigured = () => Boolean(credentials());

let redis = null;

const connectDB = async () => {
  const config = credentials();
  if (!config) {
    throw new Error('Upstash Redis is not configured (KV_REST_API_URL / KV_REST_API_TOKEN)');
  }
  const { Redis } = require('@upstash/redis');
  redis = new Redis(config);
  await redis.ping();
  console.log('[Store] Connected to Upstash Redis');
  return true;
};

const clientFor = () => {
  if (!redis) throw new Error('Store not initialized. Call connectDB first.');
  return redis;
};

const readAll = async (name) => {
  const raw = await clientFor().get(PREFIX + name);
  if (!raw) return [];
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
};

const writeAll = (name, docs) => clientFor().set(PREFIX + name, docs);

const norm = (value) => {
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  return value;
};

const same = (a, b) => {
  if (Array.isArray(a)) return a.some((item) => same(item, b));
  if (Array.isArray(b)) return b.some((item) => same(a, item));
  return norm(a) === norm(b);
};

const valueAt = (doc, path) => {
  let current = [doc];
  for (const part of path.split('.')) {
    const next = [];
    for (const node of current) {
      if (node == null) continue;
      if (Array.isArray(node)) {
        for (const item of node) {
          if (item != null && item[part] !== undefined) next.push(item[part]);
        }
      } else if (node[part] !== undefined) {
        next.push(node[part]);
      }
    }
    current = next;
  }
  if (current.length === 0) return undefined;
  return current.length === 1 ? current[0] : current;
};

const setAt = (doc, path, value) => {
  const parts = path.split('.');
  let node = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
};

const time = (value) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return Date.parse(value);
  return null;
};

const compare = (a, b) => {
  const ta = time(a);
  const tb = time(b);
  if (ta !== null && tb !== null) return ta - tb;
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

const matches = (doc, filter) => {
  for (const [path, condition] of Object.entries(filter)) {
    const actual = valueAt(doc, path);

    if (condition instanceof RegExp) {
      const values = Array.isArray(actual) ? actual : [actual];
      if (!values.some((value) => condition.test(String(value)))) return false;
      continue;
    }

    if (condition && typeof condition === 'object' && !(condition instanceof Date) && !(condition instanceof ObjectId)) {
      if ('$in' in condition && !condition.$in.some((value) => same(actual, value))) return false;
      if ('$ne' in condition && same(actual, condition.$ne)) return false;
      if ('$gt' in condition && !(compare(actual, condition.$gt) > 0)) return false;
      if ('$gte' in condition && !(compare(actual, condition.$gte) >= 0)) return false;
      if ('$lt' in condition && !(compare(actual, condition.$lt) < 0)) return false;
      if ('$lte' in condition && !(compare(actual, condition.$lte) <= 0)) return false;
      if ('$exists' in condition && (actual !== undefined) !== condition.$exists) return false;
      continue;
    }

    if (!same(actual, condition)) return false;
  }
  return true;
};

const applyUpdate = (doc, update, isInsert) => {
  if (update.$set) {
    for (const [path, value] of Object.entries(update.$set)) setAt(doc, path, value);
  }
  if (update.$inc) {
    for (const [path, amount] of Object.entries(update.$inc)) {
      setAt(doc, path, (Number(valueAt(doc, path)) || 0) + amount);
    }
  }
  if (isInsert && update.$setOnInsert) {
    for (const [path, value] of Object.entries(update.$setOnInsert)) {
      if (valueAt(doc, path) === undefined) setAt(doc, path, value);
    }
  }
};

const sorter = (spec) => (a, b) => {
  for (const [path, direction] of Object.entries(spec)) {
    const result = compare(valueAt(a, path), valueAt(b, path));
    if (result !== 0) return result * direction;
  }
  return 0;
};

const collection = (name) => ({
  find(filter = {}) {
    let sortSpec = null;
    let skipCount = 0;
    let limitCount = 0;

    const query = {
      sort(spec) { sortSpec = spec; return query; },
      skip(count) { skipCount = count; return query; },
      limit(count) { limitCount = count; return query; },
      async toArray() {
        let docs = (await readAll(name)).filter((doc) => matches(doc, filter));
        if (sortSpec) docs.sort(sorter(sortSpec));
        if (skipCount) docs = docs.slice(skipCount);
        if (limitCount) docs = docs.slice(0, limitCount);
        return docs;
      },
    };

    return query;
  },

  async findOne(filter = {}, options = {}) {
    let docs = (await readAll(name)).filter((doc) => matches(doc, filter));
    if (options.sort) docs.sort(sorter(options.sort));
    return docs[0] || null;
  },

  async insertOne(doc) {
    const docs = await readAll(name);
    if (doc._id === undefined) doc._id = new ObjectId().toHexString();
    docs.push(doc);
    await writeAll(name, docs);
    return { insertedId: doc._id };
  },

  async insertMany(newDocs) {
    const docs = await readAll(name);
    for (const doc of newDocs) {
      if (doc._id === undefined) doc._id = new ObjectId().toHexString();
      docs.push(doc);
    }
    await writeAll(name, docs);
    return { insertedCount: newDocs.length, insertedIds: newDocs.map((doc) => doc._id) };
  },

  async updateOne(filter, update, options = {}) {
    const docs = await readAll(name);
    let candidates = docs.filter((doc) => matches(doc, filter));
    if (options.sort) candidates.sort(sorter(options.sort));

    if (candidates.length === 0) {
      if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 };
      const inserted = await this.findOneAndUpdate(filter, update, { ...options, upsert: true, returnDocument: 'after' });
      return { matchedCount: 0, modifiedCount: 0, upsertedId: inserted?._id };
    }

    applyUpdate(candidates[0], update, false);
    await writeAll(name, docs);
    return { matchedCount: 1, modifiedCount: 1 };
  },

  async findOneAndUpdate(filter, update, options = {}) {
    const docs = await readAll(name);
    let index = docs.findIndex((doc) => matches(doc, filter));

    if (index === -1) {
      if (!options.upsert) return null;
      const doc = {};
      for (const [path, value] of Object.entries(filter)) {
        if (path.includes('$') || value instanceof RegExp) continue;
        if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof ObjectId)) continue;
        setAt(doc, path, value);
      }
      applyUpdate(doc, update, true);
      if (doc._id === undefined) doc._id = new ObjectId().toHexString();
      docs.push(doc);
      await writeAll(name, docs);
      return doc;
    }

    applyUpdate(docs[index], update, false);
    await writeAll(name, docs);
    return docs[index];
  },

  async deleteOne(filter) {
    const docs = await readAll(name);
    const index = docs.findIndex((doc) => matches(doc, filter));
    if (index === -1) return { deletedCount: 0 };
    docs.splice(index, 1);
    await writeAll(name, docs);
    return { deletedCount: 1 };
  },

  async deleteMany(filter = {}) {
    const docs = await readAll(name);
    const kept = docs.filter((doc) => !matches(doc, filter));
    await writeAll(name, kept);
    return { deletedCount: docs.length - kept.length };
  },

  async createIndex() {
    return 'ok';
  },
});

let database = null;

const getDB = () => {
  if (!database) {
    database = { collection };
  }
  return database;
};

const client = {
  startSession() {
    return {
      async withTransaction(work) { return work(); },
      async endSession() {},
    };
  },
  async close() {},
};

module.exports = { ObjectId, connectDB, getDB, isConfigured, client };
