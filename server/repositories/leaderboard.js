const { getDatabase } = require('../database');

const LEADERBOARD_LIMIT = 50;

async function listEntries({ database = getDatabase, limit = LEADERBOARD_LIMIT } = {}) {
  const db = await database();
  const collection = db.collection('test_results');

  const pipeline = [
    { $match: { mode: 'test' } },
    {
      $addFields: {
        _adjusted: { $multiply: ['$grossWpm', { $divide: ['$accuracy', 100] }] },
      },
    },
    { $sort: { _adjusted: -1, accuracy: -1, completedAt: -1 } },
    { $group: { _id: '$userId', best: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$best' } },
    { $sort: { _adjusted: -1, accuracy: -1, completedAt: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        grossWpm: 1,
        accuracy: 1,
        storedName: '$name',
        storedUsername: '$username',
        currentName: '$user.name',
        currentUsername: '$user.username',
      },
    },
  ];

  const results = await collection.aggregate(pipeline).toArray();
  return results.map((entry) => ({
    id: entry._id.toString(),
    name: entry.currentName || entry.storedName || 'Typist',
    username: entry.currentUsername || entry.storedUsername || 'typist',
    grossWpm: entry.grossWpm,
    accuracy: entry.accuracy,
  }));
}

module.exports = { listEntries, LEADERBOARD_LIMIT };
