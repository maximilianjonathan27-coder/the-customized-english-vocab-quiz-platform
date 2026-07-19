const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const VOCAB_FILE = path.join(DATA_DIR, 'vocabulary.json');
const STUDENTS_FILE = path.join(DATA_DIR, 'students.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(VOCAB_FILE)) fs.writeFileSync(VOCAB_FILE, '[]', 'utf8');
if (!fs.existsSync(STUDENTS_FILE)) fs.writeFileSync(STUDENTS_FILE, '[]', 'utf8');
if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
    apiKey: 'sk-05954a7b270e42d682b3b7446e5e865c',
    generationCount: 0
  }, null, 2), 'utf8');
}

function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }

// LLM helpers
async function generateVocabBatch(words) {
  const settings = readJSON(SETTINGS_FILE);
  if (!settings.apiKey) throw new Error('API key not configured');

  const prompt = `Generate a standardized vocabulary quiz for the following English words: ${JSON.stringify(words)}.
For each word, create a JSON object with properties:
- "word": the word itself
- "definition": a simple accurate English definition
- "distractors": an array of 3 incorrect definitions for multiple choice
- "sentences": an array of 2-3 natural example sentences using the word
- "fillBlank": a sentence with a blank represented as "______" where the target word should be inserted
Respond with ONLY a JSON array of these objects, without any additional text, markdown, or code fences.`;

  const response = await axios.post('https://api.deepseek.com/chat/completions', {
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 4000,
  }, {
    headers: {
      'Authorization': `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  let content = response.data.choices[0].message.content.trim();
  if (content.startsWith('```json')) content = content.slice(7, -3).trim();
  else if (content.startsWith('```')) content = content.slice(3, -3).trim();
  const arr = JSON.parse(content);
  if (!Array.isArray(arr)) throw new Error('Response is not an array');
  return arr;
}

async function generateAll(words) {
  const results = [];
  for (let i = 0; i < words.length; i += 5) {
    const chunk = words.slice(i, i + 5);
    const batch = await generateVocabBatch(chunk);
    results.push(...batch);
  }
  return results;
}

// Student helper
function getStudent(name) {
  const students = readJSON(STUDENTS_FILE);
  return students.find(s => s.nameLower === name.toLowerCase());
}
function saveStudent(student) {
  let students = readJSON(STUDENTS_FILE);
  const idx = students.findIndex(s => s.nameLower === student.nameLower);
  if (idx >= 0) students[idx] = student;
  else students.push(student);
  writeJSON(STUDENTS_FILE, students);
}

// ---- API Routes ----
app.get('/api/vocab', (req, res) => {
  try {
    const vocab = readJSON(VOCAB_FILE);
    for (let i = vocab.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [vocab[i], vocab[j]] = [vocab[j], vocab[i]];
    }
    res.json(vocab);
  } catch (e) { res.status(500).json({ error: 'Failed to read vocabulary' }); }
});

app.post('/api/vocab/bulk-generate', async (req, res) => {
  try {
    const { words } = req.body;
    if (!Array.isArray(words) || words.length === 0) return res.status(400).json({ error: 'Provide a non-empty word array' });
    const generated = await generateAll(words);
    const vocab = readJSON(VOCAB_FILE);
    const existing = new Set(vocab.map(v => v.word.toLowerCase()));
    let added = 0;
    generated.forEach(item => {
      if (!existing.has(item.word.toLowerCase())) {
        vocab.push(item);
        existing.add(item.word.toLowerCase());
        added++;
      }
    });
    writeJSON(VOCAB_FILE, vocab);
    const settings = readJSON(SETTINGS_FILE);
    settings.generationCount += 1;
    writeJSON(SETTINGS_FILE, settings);
    res.json({ generated: generated.length, added, items: generated });
  } catch (e) {
    console.error(e);
    if (e.response?.status === 401) return res.status(401).json({ error: 'Invalid API key' });
    if (e.response?.status === 429) return res.status(429).json({ error: 'API quota exceeded' });
    if (e.code === 'ECONNABORTED') return res.status(504).json({ error: 'Request timeout' });
    if (e.message.includes('JSON')) return res.status(500).json({ error: 'Invalid LLM response format' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/vocab/manual', (req, res) => {
  try {
    const { word, definition, distractors, sentences, fillBlank } = req.body;
    if (!word || !definition || !distractors || !sentences || !fillBlank) 
      return res.status(400).json({ error: 'All fields required' });
    const vocab = readJSON(VOCAB_FILE);
    if (vocab.find(v => v.word.toLowerCase() === word.toLowerCase())) 
      return res.status(409).json({ error: 'Word already exists' });
    vocab.push({ word, definition, distractors, sentences, fillBlank });
    writeJSON(VOCAB_FILE, vocab);
    res.json({ message: 'Added', word });
  } catch (e) { res.status(500).json({ error: 'Failed to add word' }); }
});

app.delete('/api/vocab/:word', (req, res) => {
  try {
    const word = decodeURIComponent(req.params.word).toLowerCase();
    let vocab = readJSON(VOCAB_FILE);
    const lenBefore = vocab.length;
    vocab = vocab.filter(v => v.word.toLowerCase() !== word);
    if (vocab.length === lenBefore) return res.status(404).json({ error: 'Word not found' });
    writeJSON(VOCAB_FILE, vocab);
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: 'Failed to delete' }); }
});

app.get('/api/students', (req, res) => {
  try {
    const students = readJSON(STUDENTS_FILE);
    res.json(students.map(s => ({
      name: s.name,
      accuracy: s.totalQuestions > 0 ? Math.round((s.totalCorrect / s.totalQuestions) * 100) : 0,
      totalTime: s.totalTime,
      completedQuizzes: s.completedQuizzes,
      masteredWords: s.masteredWords.length
    })));
  } catch (e) { res.status(500).json({ error: 'Failed to read students' }); }
});

app.get('/api/student/:name', (req, res) => {
  try {
    const student = getStudent(req.params.name);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json(student);
  } catch (e) { res.status(500).json({ error: 'Failed to get student' }); }
});

app.post('/api/quiz-result', (req, res) => {
  try {
    const { studentName, results, totalTimeSec } = req.body;
    if (!studentName || !Array.isArray(results) || results.length === 0) 
      return res.status(400).json({ error: 'Missing data' });

    let student = getStudent(studentName);
    if (!student) {
      student = {
        name: studentName,
        nameLower: studentName.toLowerCase(),
        totalQuestions: 0,
        totalCorrect: 0,
        totalTime: 0,
        completedQuizzes: 0,
        masteredWords: [],
        attemptedWords: [],
        quizHistory: []
      };
    }

    let correct = 0, defErrs = 0, fillErrs = 0;
    const newlyMastered = [];
    results.forEach(r => {
      if (r.definitionCorrect) correct++; else defErrs++;
      if (r.fillBlankCorrect) correct++; else fillErrs++;

      const wordLower = r.word.toLowerCase();
      if (!student.attemptedWords.includes(wordLower)) student.attemptedWords.push(wordLower);

      if (r.definitionCorrect && r.fillBlankCorrect && !student.masteredWords.includes(wordLower)) {
        student.masteredWords.push(wordLower);
        newlyMastered.push(r.word);
      }
    });

    student.totalQuestions += results.length * 2;
    student.totalCorrect += correct;
    student.totalTime += totalTimeSec;
    student.completedQuizzes += 1;

    student.quizHistory.push({
      date: new Date().toISOString(),
      accuracy: Math.round((correct / (results.length * 2)) * 100),
      totalQuestions: results.length * 2,
      definitionErrors: defErrs,
      fillBlankErrors: fillErrs,
      masteredGained: newlyMastered
    });

    saveStudent(student);
    res.json({ message: 'Result saved', accuracy: student.quizHistory.slice(-1)[0].accuracy });
  } catch (e) { res.status(500).json({ error: 'Failed to save result' }); }
});

app.get('/api/report/:name', (req, res) => {
  try {
    const student = getStudent(req.params.name);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const vocab = readJSON(VOCAB_FILE);
    const allWords = vocab.map(v => v.word.toLowerCase());

    const overallAccuracy = student.totalQuestions > 0 
      ? Math.round((student.totalCorrect / student.totalQuestions) * 100) : 0;

    const trend = student.quizHistory.slice(-10).map(q => q.accuracy);

    const latest = student.quizHistory[student.quizHistory.length - 1] || null;
    const errorPie = latest ? {
      definitionErrors: latest.definitionErrors,
      fillBlankErrors: latest.fillBlankErrors
    } : { definitionErrors: 0, fillBlankErrors: 0 };

    const fullyMastered = student.masteredWords.length;
    const needConsolidation = student.attemptedWords.filter(w => !student.masteredWords.includes(w)).length;
    const weak = allWords.length - student.attemptedWords.length;

    const advice = generateAdvice(student, allWords.length);

    res.json({
      name: student.name,
      overallAccuracy,
      totalTime: student.totalTime,
      completedQuizzes: student.completedQuizzes,
      masteredCount: student.masteredWords.length,
      trend,
      errorPie,
      mastery: { fullyMastered, needConsolidation, weak },
      advice
    });
  } catch (e) { res.status(500).json({ error: 'Report generation failed' }); }
});

function generateAdvice(student, totalVocab) {
  let a = '';
  const acc = student.totalQuestions > 0 ? (student.totalCorrect / student.totalQuestions) * 100 : 0;
  if (acc < 60) a += 'Focus on understanding word meanings; try reviewing definitions before quizzes. ';
  else if (acc < 80) a += 'You are improving! Keep practicing fill‑in‑the‑blank exercises. ';
  else a += 'Great job! Continue to maintain your vocabulary knowledge. ';

  if (student.masteredWords.length < totalVocab * 0.5) a += 'You have many words yet to master. Concentrate on weaker words. ';
  if (student.quizHistory.length > 0) {
    const last = student.quizHistory[student.quizHistory.length-1];
    if (last.definitionErrors > last.fillBlankErrors) a += 'Work on word meanings; try creating flashcards. ';
    else if (last.fillBlankErrors > last.definitionErrors) a += 'Spelling practice is needed; write the words several times. ';
  }
  return a || 'Keep up the steady effort!';
}

app.get('/api/settings', (req, res) => {
  res.json(readJSON(SETTINGS_FILE));
});

app.put('/api/settings', (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'API key required' });
    const settings = readJSON(SETTINGS_FILE);
    settings.apiKey = apiKey;
    writeJSON(SETTINGS_FILE, settings);
    res.json({ message: 'Updated' });
  } catch (e) { res.status(500).json({ error: 'Update failed' }); }
});

app.get('/', (req, res) => res.redirect('/quiz'));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));