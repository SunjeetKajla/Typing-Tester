// One personal-best result per typist, from a 60-second typing test.
// Replace listEntries with a MongoDB query later; keep this record shape.
const entries = [
  { id: 'typist-01', name: 'Aarav Sharma', username: 'aarav', grossWpm: 148, accuracy: 99.2 },
  { id: 'typist-02', name: 'Maya Chen', username: 'mayatypes', grossWpm: 144, accuracy: 99.8 },
  { id: 'typist-03', name: 'Oliver Park', username: 'oliver', grossWpm: 141, accuracy: 98.6 },
  { id: 'typist-04', name: 'Zara Khan', username: 'zarak', grossWpm: 137, accuracy: 99.1 },
  { id: 'typist-05', name: 'Leo Martin', username: 'leom', grossWpm: 134, accuracy: 97.8 },
  { id: 'typist-06', name: 'Ananya Rao', username: 'ananya', grossWpm: 131, accuracy: 99.4 },
  { id: 'typist-07', name: 'Noah Wilson', username: 'noahw', grossWpm: 129, accuracy: 98.2 },
  { id: 'typist-08', name: 'Sofia Garcia', username: 'sofia', grossWpm: 126, accuracy: 99.6 },
  { id: 'typist-09', name: 'Arjun Patel', username: 'arjunp', grossWpm: 123, accuracy: 98.9 },
  { id: 'typist-10', name: 'Emma Brooks', username: 'emmab', grossWpm: 121, accuracy: 99.0 },
  { id: 'typist-11', name: 'Ishaan Mehta', username: 'ishaan', grossWpm: 118, accuracy: 97.5 },
  { id: 'typist-12', name: 'Lily Anderson', username: 'lilya', grossWpm: 115, accuracy: 99.3 },
  { id: 'typist-13', name: 'Ethan Lee', username: 'ethanl', grossWpm: 112, accuracy: 98.7 },
  { id: 'typist-14', name: 'Aisha Ali', username: 'aisha', grossWpm: 109, accuracy: 99.5 },
  { id: 'typist-15', name: 'Lucas Silva', username: 'lucass', grossWpm: 106, accuracy: 97.9 },
  { id: 'typist-16', name: 'Meera Nair', username: 'meeran', grossWpm: 103, accuracy: 99.1 },
  { id: 'typist-17', name: 'Daniel Kim', username: 'danielk', grossWpm: 99, accuracy: 98.4 },
  { id: 'typist-18', name: 'Riya Shah', username: 'riyas', grossWpm: 96, accuracy: 99.7 },
];

async function listEntries() {
  return entries.map((entry) => ({ ...entry }));
}

module.exports = { listEntries };
