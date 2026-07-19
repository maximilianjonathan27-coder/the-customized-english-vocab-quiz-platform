// Teacher portal logic
document.addEventListener('DOMContentLoaded', () => {
  // Tab switching
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      contents.forEach(c => c.classList.remove('active'));
      document.getElementById(`tab-${target}`).classList.add('active');
      if (target === 'students') loadStudentOverview();
      if (target === 'report') populateStudentSelect();
      if (target === 'settings') loadSettings();
      if (target === 'bank') loadWordBank();
    });
  });

  // Question Bank
  document.getElementById('manual-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const word = document.getElementById('m-word').value.trim();
    const definition = document.getElementById('m-def').value.trim();
    const distractors = document.getElementById('m-distractors').value.split(',').map(s => s.trim()).filter(Boolean);
    const sentences = document.getElementById('m-sentences').value.split('\n').map(s => s.trim()).filter(Boolean);
    const fillBlank = document.getElementById('m-fillblank').value.trim();
    if (distractors.length !== 3) return alert('Please enter exactly 3 distractors separated by commas');
    try {
      const res = await fetch('/api/vocab/manual', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ word, definition, distractors, sentences, fillBlank })
      });
      if (!res.ok) throw (await res.json()).error;
      alert('Word added');
      e.target.reset();
      loadWordBank();
    } catch (err) { alert('Error: ' + err); }
  });

  document.getElementById('bulk-gen-btn').addEventListener('click', async () => {
    const raw = document.getElementById('word-list').value;
    let words = raw.split(/[\n,]+/).map(w => w.trim()).filter(Boolean);
    if (words.length === 0) return alert('Enter at least one word');
    const btn = document.getElementById('bulk-gen-btn');
    btn.disabled = true;
    btn.textContent = 'Generating...';
    document.getElementById('gen-status').textContent = '';
    try {
      const res = await fetch('/api/vocab/bulk-generate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ words })
      });
      const data = await res.json();
      if (!res.ok) throw data.error;
      document.getElementById('gen-status').textContent = `Generated ${data.generated}, added ${data.added} new words.`;
      loadWordBank();
    } catch (err) { document.getElementById('gen-status').textContent = 'Error: ' + err; }
    finally { btn.disabled = false; btn.textContent = 'Generate & Save'; }
  });

  async function loadWordBank() {
    try {
      const res = await fetch('/api/vocab');
      const vocab = await res.json();
      const ul = document.getElementById('word-bank-list');
      ul.innerHTML = vocab.map(v => `
        <li><span>${v.word}</span> <button class="btn" data-word="${v.word}" style="padding:0.3rem 0.8rem;">Delete</button></li>
      `).join('');
      ul.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete ' + btn.dataset.word + '?')) return;
          await fetch(`/api/vocab/${encodeURIComponent(btn.dataset.word)}`, { method: 'DELETE' });
          loadWordBank();
        });
      });
    } catch (e) { console.error(e); }
  }

  // Student Overview
  async function loadStudentOverview() {
    try {
      const res = await fetch('/api/students');
      const students = await res.json();
      const tbody = document.querySelector('#students-table tbody');
      tbody.innerHTML = students.map(s => `
        <tr>
          <td>${s.name}</td>
          <td>${s.accuracy}%</td>
          <td>${Math.round(s.totalTime / 60)}</td>
          <td>${s.completedQuizzes}</td>
          <td>${s.masteredWords}</td>
        </tr>
      `).join('');
    } catch (e) { console.error(e); }
  }

  // Parent Report
  async function populateStudentSelect() {
    try {
      const res = await fetch('/api/students');
      const students = await res.json();
      const select = document.getElementById('student-select');
      select.innerHTML = '<option value="">-- Choose --</option>' +
        students.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    } catch (e) { console.error(e); }
  }

  document.getElementById('gen-report-btn').addEventListener('click', async () => {
    const name = document.getElementById('student-select').value;
    if (!name) return alert('Select a student');
    const container = document.getElementById('report-container');
    container.style.display = 'none';
    try {
      const res = await fetch(`/api/report/${encodeURIComponent(name)}`);
      if (!res.ok) throw (await res.json()).error;
      const data = await res.json();
      renderReport(data);
      container.style.display = 'block';
    } catch (err) { alert('Error: ' + err); }
  });

  let charts = {};
  function renderReport(data) {
    document.getElementById('report-name').textContent = `Report: ${data.name}`;
    document.getElementById('metric-cards').innerHTML = `
      <div class="metric"><div class="value">${data.overallAccuracy}%</div>Accuracy</div>
      <div class="metric"><div class="value">${Math.round(data.totalTime/60)} min</div>Total Time</div>
      <div class="metric"><div class="value">${data.completedQuizzes}</div>Quizzes</div>
      <div class="metric"><div class="value">${data.masteredCount}</div>Mastered</div>
    `;
    destroyCharts();
    // Trend chart
    const trendCtx = document.getElementById('trendChart').getContext('2d');
    charts.trend = new Chart(trendCtx, {
      type: 'line',
      data: {
        labels: data.trend.map((_, i) => `Q${i+1}`),
        datasets: [{ label: 'Accuracy %', data: data.trend, borderColor: '#5b7fa5', tension: 0.3 }]
      },
      options: { responsive: true, plugins: { title: { display: true, text: 'Accuracy Trend (last 10)' } } }
    });
    // Pie chart
    const pieCtx = document.getElementById('pieChart').getContext('2d');
    charts.pie = new Chart(pieCtx, {
      type: 'pie',
      data: {
        labels: ['Definition Errors', 'Fill‑Blank Errors'],
        datasets: [{
          data: [data.errorPie.definitionErrors, data.errorPie.fillBlankErrors],
          backgroundColor: ['#f39c12', '#e74c3c']
        }]
      },
      options: { responsive: true, plugins: { title: { display: true, text: 'Error Breakdown (Latest Quiz)' } } }
    });
    // Mastery bar
    const barCtx = document.getElementById('masteryBarChart').getContext('2d');
    charts.bar = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: ['Fully Mastered', 'Need Consolidation', 'Weak'],
        datasets: [{
          data: [data.mastery.fullyMastered, data.mastery.needConsolidation, data.mastery.weak],
          backgroundColor: ['#27ae60', '#f1c40f', '#e74c3c']
        }]
      },
      options: { responsive: true, plugins: { title: { display: true, text: 'Vocabulary Mastery Distribution' } } }
    });
    document.getElementById('advice-box').innerHTML = `<strong>Personalized Advice:</strong> ${data.advice}`;
  }

  function destroyCharts() {
    Object.values(charts).forEach(chart => chart.destroy());
    charts = {};
  }

  document.getElementById('export-pdf').addEventListener('click', () => {
    const element = document.getElementById('report-container');
    html2pdf().set({ margin: 0.5, filename: 'student-report.pdf', html2canvas: { scale: 2 } }).from(element).save();
  });

  document.getElementById('copy-link').addEventListener('click', () => {
    const name = document.getElementById('student-select').value;
    if (!name) return;
    const link = `${window.location.origin}/report?student=${encodeURIComponent(name)}`;
    navigator.clipboard.writeText(link).then(() => alert('Link copied!'));
  });

  // Settings
  async function loadSettings() {
    try {
      const res = await fetch('/api/settings');
      const settings = await res.json();
      document.getElementById('api-key-input').value = settings.apiKey;
      document.getElementById('gen-count').textContent = settings.generationCount;
    } catch (e) { console.error(e); }
  }

  document.getElementById('save-settings').addEventListener('click', async () => {
    const apiKey = document.getElementById('api-key-input').value.trim();
    if (!apiKey) return alert('Enter API key');
    await fetch('/api/settings', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ apiKey })
    });
    alert('Saved');
  });

  // Initial loads
  loadWordBank();
  loadSettings();
});