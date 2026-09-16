function resolveMongoUri(env = process.env) {
  if (env.MONGO_URI) return env.MONGO_URI;
  if (env.MONGO_URL) return env.MONGO_URL;
  if (env.MONGODB_URI) return env.MONGODB_URI;
  return '';
}

function applyMongoEnv(env = process.env) {
  const uri = resolveMongoUri(env);
  if (uri) {
    env.MONGODB_URI = uri;
  }
  return uri;
}

module.exports = { resolveMongoUri, applyMongoEnv };
