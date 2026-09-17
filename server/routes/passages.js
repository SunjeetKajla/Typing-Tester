const crypto = require('node:crypto');
const express = require('express');
const words = require('../data/words.json');
const sentences = require('../data/sentences.json');

const MIN_WORD_COUNT = 10;
const MAX_WORD_COUNT = 500;

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function generateWords(wordCount) {
  const result = [];
  while (result.length < wordCount) {
    result.push(...shuffle(words).slice(0, wordCount - result.length));
  }
  return result.join(' ');
}

function generateSentences(targetWordCount) {
  const available = shuffle(sentences).map((text) => ({ text, words: countWords(text) }));
  const selected = [];
  let total = 0;

  while (available.length > 0 && total < targetWordCount) {
    const remaining = targetWordCount - total;
    let chosenIndex = 0;

    if (remaining <= 24) {
      chosenIndex = available.reduce((bestIndex, entry, index) => (
        Math.abs(entry.words - remaining) < Math.abs(available[bestIndex].words - remaining)
          ? index
          : bestIndex
      ), 0);
    }

    const [chosen] = available.splice(chosenIndex, 1);
    const withoutChosen = Math.abs(targetWordCount - total);
    const withChosen = Math.abs(targetWordCount - (total + chosen.words));
    if (selected.length > 0 && total >= targetWordCount * 0.8 && withoutChosen <= withChosen) break;

    selected.push(chosen.text);
    total += chosen.words;
  }

  return selected.join(' ');
}

function createPassagesRouter() {
  const router = express.Router();

  router.get('/', (req, res) => {
    const type = req.query.type || 'sentences';
    const wordCount = Number(req.query.wordCount || 25);

    if (!['words', 'sentences'].includes(type)) {
      return res.status(400).json({ error: { code: 'INVALID_TYPE', message: 'type must be words or sentences.' } });
    }
    if (!Number.isInteger(wordCount) || wordCount < MIN_WORD_COUNT || wordCount > MAX_WORD_COUNT) {
      return res.status(400).json({
        error: {
          code: 'INVALID_WORD_COUNT',
          message: `wordCount must be an integer between ${MIN_WORD_COUNT} and ${MAX_WORD_COUNT}.`,
        },
      });
    }

    const passage = type === 'words' ? generateWords(wordCount) : generateSentences(wordCount);
    res.set('Cache-Control', 'no-store');
    return res.json({
      data: {
        id: crypto.randomUUID(),
        passage,
        type,
        requestedWordCount: wordCount,
        actualWordCount: countWords(passage),
      },
    });
  });

  return router;
}

module.exports = {
  MAX_WORD_COUNT,
  MIN_WORD_COUNT,
  countWords,
  createPassagesRouter,
  generateSentences,
  generateWords,
};
