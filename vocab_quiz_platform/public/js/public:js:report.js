document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const student = params.get('student');
  if (!student) {
    document.getElementById('report-content').innerHTML = '<p>No student specified.</p>';
    return;
  }
  try {
    const res = await fetch(`/api/report/${encodeURIComponent(student)}`);
    if (!res.ok) throw (await res.json()).error;
    const data = await res.json();
    renderReport(data);
  } catch (err) {
    document.getElementById('error-msg').style.display = 'block';
    document.getElementById('error-msg').textContent = 'Report not available: ' + err;
  }
});

function renderReport(data) {
  document.getElementById('report-name').textContent = `Report: ${data.name}`;
  document.getElementById('metric-cards').innerHTML = `
    <div class="metric"><div class="value">${data.overallAccuracy}%</div>Accuracy</div>
    <div class="metric"><div class="value">${Math.round(data.totalTime/60)} min</div>Total Time</div>
    <div class="metric"><div class="value">${data.completedQuizzes}</div>Quizzes</div>
    <div class="metric"><div class="value">${data.masteredCount}</div>Mastered</div>
  `;
  // Trend
  new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: {
      labels: data.trend.map((_, i) => `Q${i+1}`),
      datasets: [{ label: 'Accuracy %', data: data.trend, borderColor: '#5b7fa5', tension: 0.3 }]
    },
    options: { responsive: true, plugins: { title: { display: true, text: 'Accuracy Trend (last 10)' } } }
  });
  // Pie
  new Chart(document.getElementById('pieChart'), {
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
  new Chart(document.getElementById('masteryBarChart'), {
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