const { MongoClient } = require('mongodb');
const dns = require('node:dns');

let connection;

async function getClient() {
  if (!connection) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing');
    if (process.env.MONGODB_DNS_SERVERS) {
      // Optional process-only override for local DNS resolvers without SRV support.
      dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map((server) => server.trim()));
    }
    const client = new MongoClient(process.env.DATABASE_URL, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
    connection = client.connect().catch(async (error) => {
      connection = undefined;
      await client.close();
      throw error;
    });
  }
  return connection;
}

async function getDatabase() {
  const client = await getClient();
  return client.db(process.env.MONGODB_DB || 'typing_tracker');
}

async function closeDatabase() {
  if (connection) await (await connection).close();
  connection = undefined;
}

module.exports = { getClient, getDatabase, closeDatabase };
