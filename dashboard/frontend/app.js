// ===== Global State =====
let lineChartInstance = null;
let barChartInstance = null;
let previousData = null;

// ===== Chart.js Dark Theme Defaults =====
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.07)';
Chart.defaults.font.family = "'Inter', sans-serif";

// ===== Utility Functions =====
const formatNumber = (num) => new Intl.NumberFormat('en-US').format(Math.round(num));
const formatPercent = (num) => num.toFixed(1) + '%';

function setTrend(elementId, current, previous) {
    const el = document.getElementById(elementId);
    if (!el || !previous) { el.textContent = ''; return; }
    const diff = ((current - previous) / previous * 100).toFixed(1);
    if (diff > 0) {
        el.textContent = `▲ ${diff}%`;
        el.className = 'card-trend up';
    } else if (diff < 0) {
        el.textContent = `▼ ${Math.abs(diff)}%`;
        el.className = 'card-trend down';
    } else {
        el.textContent = '— 0%';
        el.className = 'card-trend';
    }
}

// ===== Fetch Dashboard Data =====
async function fetchDashboardData() {
    try {
        const response = await fetch('/api/dashboard-data');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        
        const chartData = result.data || result;
        const isMock = result.is_mock || false;

        updateKPIs(chartData, result.summary);
        updateLineChart(chartData);
        updateLiveStatus(isMock);
        
        document.getElementById('last-update-time').textContent = 
            `Last update: ${new Date().toLocaleTimeString('th-TH')}`;
        
        previousData = chartData;
    } catch (error) {
        console.error("Failed to fetch data:", error);
        updateLiveStatus(null, true);
    }
}

// ===== Fetch Top Games =====
async function fetchTopGames() {
    try {
        const response = await fetch('/api/top-games');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        
        const gamesData = result.data || result;
        updateBarChart(gamesData);
    } catch (error) {
        console.error("Failed to fetch top games:", error);
    }
}

// ===== Fetch Pipeline Status =====
async function fetchPipelineStatus() {
    try {
        const response = await fetch('/api/pipeline-status');
        if (!response.ok) return;
        const status = await response.json();
        
        const badge = document.getElementById('pipeline-badge');
        const text = document.getElementById('pipeline-status-text');
        
        if (status.status === 'completed') {
            const lastRun = status.last_run ? new Date(status.last_run).toLocaleString('th-TH') : 'N/A';
            text.textContent = `Pipeline: ✅ Last run ${lastRun}`;
            badge.style.borderColor = 'rgba(16, 185, 129, 0.2)';
            badge.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
            badge.style.color = '#10b981';
        } else if (status.status === 'waiting') {
            text.textContent = 'Pipeline: ⏳ Waiting for first run';
            badge.style.borderColor = 'rgba(245, 158, 11, 0.2)';
            badge.style.backgroundColor = 'rgba(245, 158, 11, 0.1)';
            badge.style.color = '#f59e0b';
        } else {
            text.textContent = `Pipeline: ${status.status}`;
        }
    } catch (e) {
        document.getElementById('pipeline-status-text').textContent = 'Pipeline: ❓ Unknown';
    }
}

// ===== Update Status Badge =====
function updateLiveStatus(isMock, isError = false) {
    const statusText = document.getElementById('update-status');
    const pulse = document.querySelector('.pulse');
    const badge = document.getElementById('live-status');
    
    if (isError) {
        statusText.textContent = "Connection Error";
        pulse.style.backgroundColor = "#ef4444";
        badge.style.color = "#ef4444";
        badge.style.borderColor = "rgba(239, 68, 68, 0.2)";
        badge.style.backgroundColor = "rgba(239, 68, 68, 0.1)";
    } else if (isMock) {
        statusText.textContent = "Live (Mock Data)";
        pulse.style.backgroundColor = "#f59e0b";
        badge.style.color = "#f59e0b";
        badge.style.borderColor = "rgba(245, 158, 11, 0.2)";
        badge.style.backgroundColor = "rgba(245, 158, 11, 0.1)";
    } else {
        statusText.textContent = "Live Updates Active";
        pulse.style.backgroundColor = "#10b981";
        badge.style.color = "#10b981";
        badge.style.borderColor = "rgba(16, 185, 129, 0.2)";
        badge.style.backgroundColor = "rgba(16, 185, 129, 0.1)";
    }
}

// ===== Update KPI Cards =====
function updateKPIs(data, summary) {
    if (summary) {
        // Use Global Summary if available
        document.getElementById('total-reviews').innerText = formatNumber(summary.total_reviews);
        document.getElementById('positive-rate').innerText = formatPercent(summary.positive_rate);
        document.getElementById('avg-playtime').innerText = formatNumber(summary.unique_reviewers);
        document.getElementById('unique-games').innerText = formatNumber(summary.total_games);
        return;
    }

    if (!data || data.length === 0) return;
    
    const latest = data[data.length - 1];

    // Total Reviews
    document.getElementById('total-reviews').innerText = formatNumber(latest.total_reviews);
    
    // Positive Rate
    const positiveRate = latest.total_reviews > 0 
        ? (latest.positive_reviews / latest.total_reviews * 100) 
        : 0;
    document.getElementById('positive-rate').innerText = formatPercent(positiveRate);
    
    // Total Reviewers
    document.getElementById('avg-playtime').innerText = 
        latest.unique_reviewers ? formatNumber(latest.unique_reviewers) : '--';
    
    // Unique Games
    document.getElementById('unique-games').innerText = formatNumber(latest.unique_games);

}

// ===== Update Line Chart (Daily Reviews) =====
function updateLineChart(data) {
    if (!data || data.length === 0) return;

    const labels = data.map(d => d.review_date);
    const positive = data.map(d => d.positive_reviews);
    const negative = data.map(d => d.negative_reviews);

    const lineCtx = document.getElementById('lineChart').getContext('2d');
    if (lineChartInstance) lineChartInstance.destroy();
    
    const positiveGradient = lineCtx.createLinearGradient(0, 0, 0, 300);
    positiveGradient.addColorStop(0, 'rgba(16, 185, 129, 0.25)');
    positiveGradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

    const negativeGradient = lineCtx.createLinearGradient(0, 0, 0, 300);
    negativeGradient.addColorStop(0, 'rgba(239, 68, 68, 0.15)');
    negativeGradient.addColorStop(1, 'rgba(239, 68, 68, 0.0)');

    lineChartInstance = new Chart(lineCtx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '👍 Positive Reviews',
                    data: positive,
                    borderColor: '#10b981',
                    backgroundColor: positiveGradient,
                    borderWidth: 2.5,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#10b981'
                },
                {
                    label: '👎 Negative Reviews',
                    data: negative,
                    borderColor: '#ef4444',
                    backgroundColor: negativeGradient,
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#ef4444'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, padding: 20 } },
                tooltip: {
                    backgroundColor: '#1e293b',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    titleFont: { weight: '600' },
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${formatNumber(ctx.parsed.y)}`
                    }
                }
            },
            scales: {
                y: { beginAtZero: true, ticks: { callback: (v) => formatNumber(v) } },
                x: { grid: { display: false } }
            }
        }
    });
}

// ===== Update Bar Chart (Top Games) =====
function updateBarChart(data) {
    if (!data || data.length === 0) return;

    const labels = data.slice(0, 10).map(d => {
        const name = d.name || d.app_name || "Unknown Game";
        return name.length > 20 ? name.substring(0, 18) + '...' : name;
    });
    const reviews = data.slice(0, 10).map(d => d.recommendations_total || d.total_reviews);
    const positiveRates = data.slice(0, 10).map(d => {
        if (d.positive_rate) return d.positive_rate;
        return d.total_reviews > 0 ? (d.positive_reviews / d.total_reviews * 100).toFixed(1) : 0;
    });

    const barCtx = document.getElementById('barChart').getContext('2d');
    if (barChartInstance) barChartInstance.destroy();

    // สร้างสีตามอัตรา positive (เขียว = ดี, แดง = ไม่ดี)
    const barColors = positiveRates.map(rate => {
        if (rate >= 80) return 'rgba(16, 185, 129, 0.8)';
        if (rate >= 60) return 'rgba(245, 158, 11, 0.8)';
        return 'rgba(239, 68, 68, 0.8)';
    });

    barChartInstance = new Chart(barCtx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Total Reviews',
                data: reviews,
                backgroundColor: barColors,
                borderRadius: 6,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            interaction: { intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e293b',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: (ctx) => {
                            const idx = ctx.dataIndex;
                            return [
                                `Reviews: ${formatNumber(ctx.parsed.x)}`,
                                `Positive: ${positiveRates[idx]}%`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: { beginAtZero: true, ticks: { callback: (v) => formatNumber(v) } },
                y: { grid: { display: false } }
            }
        }
    });
}

// ===== Initial Load & Polling =====
fetchDashboardData();
fetchTopGames();
fetchPipelineStatus();

// Poll dashboard data every 10 seconds
setInterval(fetchDashboardData, 10000);

// Poll top games every 60 seconds
setInterval(fetchTopGames, 60000);

// Poll pipeline status every 30 seconds
setInterval(fetchPipelineStatus, 30000);
