document.addEventListener('DOMContentLoaded', () => {
  let vocab = [];
  let currentIndex = 0;
  let currentWord = null;
  let startTime = null;
  let results = [];
  let studentName = '';

  const regDiv = document.getElementById('registration');
  const quizArea = document.getElementById('quiz-area');
  const completeDiv = document.getElementById('quiz-complete');

  document.getElementById('start-btn').addEventListener('click', async () => {
    studentName = document.getElementById('student-name').value.trim();
    if (!studentName) return alert('Please enter your name');
    try {
      const res = await fetch('/api/vocab');
      vocab = await res.json();
      if (vocab.length === 0) return alert('No vocabulary in bank. Ask your teacher to add words.');
      // Shuffle already done by server
      regDiv.style.display = 'none';
      quizArea.style.display = 'block';
      startTime = Date.now();
      currentIndex = 0;
      results = [];
      showCurrentWord();
    } catch (e) { alert('Failed to load vocabulary'); }
  });

  function showCurrentWord() {
    if (currentIndex >= vocab.length) {
      finishQuiz();
      return;
    }
    currentWord = vocab[currentIndex];
    document.getElementById('current-word').textContent = currentWord.word;
    document.getElementById('quiz-progress').textContent = `Word ${currentIndex+1} / ${vocab.length}`;
    // Step 1: multiple choice
    document.getElementById('step1').style.display = 'block';
    document.getElementById('step2').style.display = 'none';
    document.getElementById('step3').style.display = 'none';
    document.getElementById('step1-feedback').textContent = '';
    const choicesDiv = document.getElementById('choices');
    // Build choices: correct definition + distractors, shuffle
    const options = [currentWord.definition, ...currentWord.distractors];
    shuffleArray(options);
    choicesDiv.innerHTML = options.map(opt => `<button class="choice-btn">${opt}</button>`).join('');
    choicesDiv.querySelectorAll('.choice-btn').forEach(btn => {
      btn.addEventListener('click', () => choiceHandler(btn, opt => opt === currentWord.definition));
    });
  }

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function choiceHandler(btn, isCorrect) {
    const buttons = document.querySelectorAll('#choices .choice-btn');
    buttons.forEach(b => b.disabled = true);
    if (isCorrect(btn.textContent)) {
      btn.classList.add('correct');
      document.getElementById('step1-feedback').textContent = '✓ Correct!';
      results[currentIndex] = { ...results[currentIndex], definitionCorrect: true };
    } else {
      btn.classList.add('wrong');
      document.getElementById('step1-feedback').textContent = '✗ Incorrect';
      results[currentIndex] = { ...results[currentIndex], definitionCorrect: false };
      buttons.forEach(b => { if (b.textContent === currentWord.definition) b.classList.add('correct'); });
    }
    setTimeout(() => showStep2(), 1000);
  }

  function showStep2() {
    document.getElementById('step1').style.display = 'none';
    document.getElementById('step2').style.display = 'block';
    document.getElementById('review-word').textContent = currentWord.word;
    document.getElementById('review-def').textContent = currentWord.definition;
    document.getElementById('review-sentences').innerHTML = currentWord.sentences.map(s => `<li>${s}</li>`).join('');
    document.getElementById('next-to-step3').onclick = showStep3;
  }

  function showStep3() {
    document.getElementById('step2').style.display = 'none';
    document.getElementById('step3').style.display = 'block';
    document.getElementById('fill-sentence').innerHTML = currentWord.fillBlank.replace('______', '<span class="blank">______</span>');
    document.getElementById('fill-input').value = '';
    document.getElementById('step3-feedback').textContent = '';
    document.getElementById('submit-fill').onclick = checkFillBlank;
  }

  function checkFillBlank() {
    const input = document.getElementById('fill-input').value.trim();
    const correct = input.toLowerCase() === currentWord.word.toLowerCase();
    document.getElementById('step3-feedback').textContent = correct ? '✓ Correct!' : `✗ Incorrect. The word was "${currentWord.word}"`;
    results[currentIndex] = { ...results[currentIndex], word: currentWord.word, fillBlankCorrect: correct };
    document.getElementById('submit-fill').disabled = true;
    setTimeout(() => {
      currentIndex++;
      document.getElementById('submit-fill').disabled = false;
      showCurrentWord();
    }, 1200);
  }

  async function finishQuiz() {
    quizArea.style.display = 'none';
    completeDiv.style.display = 'block';
    const totalTimeSec = Math.round((Date.now() - startTime) / 1000);
    const correctCount = results.reduce((sum, r) => sum + (r.definitionCorrect ? 1 : 0) + (r.fillBlankCorrect ? 1 : 0), 0);
    const accuracy = Math.round((correctCount / (results.length * 2)) * 100);
    document.getElementById('final-accuracy').textContent = accuracy;

    // Submit results
    try {
      await fetch('/api/quiz-result', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ studentName, results, totalTimeSec })
      });
    } catch (e) { console.error('Failed to save result'); }
  }
});