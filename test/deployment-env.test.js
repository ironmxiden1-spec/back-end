const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveMongoUri } = require('../utils/mongoEnv');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

test('deployment requires a configured MongoDB URI', () => {
  assert.ok(process.env.MONGODB_URI, 'MONGODB_URI must be set before deployment');
});

test('Mongo URI precedence prefers MONGO_URI and MONGO_URL ahead of MONGODB_URI', () => {
  const env = {
    MONGO_URI: 'mongodb://127.0.0.1:27017/wimps-local',
    MONGO_URL: 'mongodb://127.0.0.1:27018/wimps-url',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/wimps-old'
  };

  assert.equal(resolveMongoUri(env), 'mongodb://127.0.0.1:27017/wimps-local');
  assert.equal(resolveMongoUri({ MONGO_URL: 'mongodb://127.0.0.1:27018/wimps-url', MONGODB_URI: 'mongodb://127.0.0.1:27017/wimps-old' }), 'mongodb://127.0.0.1:27018/wimps-url');
  assert.equal(resolveMongoUri({ MONGODB_URI: 'mongodb://127.0.0.1:27017/wimps-old' }), 'mongodb://127.0.0.1:27017/wimps-old');
});


