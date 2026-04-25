document.addEventListener('DOMContentLoaded', () => {
    // API URL Base (relative to host)
    const API_BASE = '/api';

    // DOM Elements
    const elements = {
        totalReviews: document.getElementById('total-reviews'),
        positiveRate: document.getElementById('positive-rate'),
        uniqueReviewers: document.getElementById('unique-reviewers'),
        uniqueGames: document.getElementById('unique-games'),
        statusBadge: document.getElementById('live-status'),
        statusText: document.getElementById('update-status'),
        pipelineBadge: document.getElementById('pipeline-badge'),
        pipelineText: document.getElementById('pipeline-status-text'),
        lastUpdate: document.getElementById('last-update-time'),
        refreshBtn: document.getElementById('refresh-btn'),
        applyFiltersBtn: document.getElementById('apply-filters'),
        dateStart: document.getElementById('date-start'),
        dateEnd: document.getElementById('date-end'),
        gameSearch: document.getElementById('game-search'),
        gamesTbody: document.getElementById('games-tbody'),
        // Data Quality
        dqReviewsTotal: document.getElementById('dq-reviews-total'),
        dqReviewsClean: document.getElementById('dq-reviews-clean'),
        dqReviewsDrop: document.getElementById('dq-reviews-drop'),
        dqAppsTotal: document.getElementById('dq-apps-total'),
        dqAppsClean: document.getElementById('dq-apps-clean')
    };

    // Chart Instances
    let lineChart = null;
    let barChart = null;

    // Theme colors for Chart.js
    const chartTheme = {
        gridColor: 'rgba(255, 255, 255, 0.05)',
        textColor: '#94a3b8',
        positiveColor: '#10b981', // Accent Green
        negativeColor: '#ef4444', // Accent Danger
        totalColor: '#3b82f6'     // Accent Blue
    };

    Chart.defaults.color = chartTheme.textColor;
    Chart.defaults.font.family = "'Inter', sans-serif";

    // Do not set default dates so the backend returns the latest 90 days of available data
    elements.dateStart.value = "";
    elements.dateEnd.value = "";

    // Format numbers
    const fmt = (num) => new Intl.NumberFormat('en-US').format(num || 0);

    // Initialization
    async function initDashboard() {
        await checkPipelineStatus();
        await fetchAllData();
        await fetchDataQuality();
    }

    // Fetch all required data
    async function fetchAllData() {
        setStatus('loading');

        try {
            const startDate = elements.dateStart.value;
            const endDate = elements.dateEnd.value;
            const search = elements.gameSearch.value;

            // Fetch Dashboard Data
            const dashRes = await fetch(`${API_BASE}/dashboard-data?start_date=${startDate}&end_date=${endDate}`);
            const dashData = await dashRes.json();

            // Fetch Top Games Data
            const gamesUrl = search ? `${API_BASE}/top-games?search=${encodeURIComponent(search)}&limit=50` : `${API_BASE}/top-games?limit=50`;
            const gamesRes = await fetch(gamesUrl);
            const gamesData = await gamesRes.json();

            updateKPIs(dashData);
            updateLineChart(dashData.data);
            updateBarChart(gamesData.data);
            updateGamesTable(gamesData.data);

            setStatus('online', dashData.is_mock);
        } catch (error) {
            console.error('Error fetching data:', error);
            setStatus('error');
        }
    }

    // Fetch Data Quality Log
    async function fetchDataQuality() {
        try {
            const res = await fetch(`${API_BASE}/data-quality`);
            const dq = await res.json();
            const d = dq.data;

            elements.dqReviewsTotal.textContent = fmt(d.reviews_total_scanned);
            elements.dqReviewsClean.textContent = fmt(d.reviews_cleaned_count);
            elements.dqReviewsDrop.textContent = fmt(d.reviews_dropped);
            elements.dqAppsTotal.textContent = fmt(d.apps_total);
            elements.dqAppsClean.textContent = fmt(d.apps_cleaned);
        } catch (error) {
            console.error('Error fetching DQ:', error);
        }
    }

    // Check Airflow Pipeline Status
    async function checkPipelineStatus() {
        try {
            const response = await fetch(`${API_BASE}/pipeline-status`);
            const status = await response.json();

            if (status.status === 'completed') {
                elements.pipelineBadge.className = 'status-item pipeline-status success';
                elements.pipelineBadge.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>Pipeline: OK</span>`;
            } else if (status.status === 'waiting') {
                elements.pipelineBadge.className = 'status-item pipeline-status';
                elements.pipelineBadge.innerHTML = `<i class="fa-solid fa-clock"></i> <span>Pipeline: Waiting</span>`;
            } else {
                elements.pipelineBadge.className = 'status-item pipeline-status error';
                elements.pipelineBadge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>Pipeline: Error</span>`;
            }
        } catch (error) {
            console.error('Error fetching pipeline status:', error);
        }
    }

    // Update KPI Cards
    function updateKPIs(payload) {
        if (payload.summary) {
            const s = payload.summary;
            elements.totalReviews.textContent = fmt(s.total_reviews);
            elements.positiveRate.textContent = `${s.positive_rate}%`;
            elements.uniqueReviewers.textContent = fmt(s.unique_reviewers);
            elements.uniqueGames.textContent = fmt(s.total_games);
            elements.lastUpdate.textContent = `Last update: ${s.last_updated}`;
        } else {
            // Aggregate from filtered data if summary not available
            const data = payload.data;
            if (data && data.length > 0) {
                const total = data.reduce((sum, row) => sum + row.total_reviews, 0);
                const pos = data.reduce((sum, row) => sum + row.positive_reviews, 0);
                const posRate = total > 0 ? ((pos / total) * 100).toFixed(1) : 0;

                elements.totalReviews.textContent = fmt(total);
                elements.positiveRate.textContent = `${posRate}%`;
                elements.uniqueReviewers.textContent = "See Global";
                elements.uniqueGames.textContent = "See Global";
            } else {
                elements.totalReviews.textContent = '0';
                elements.positiveRate.textContent = '0%';
            }
        }
    }

    // Update Line Chart
    function updateLineChart(data) {
        const ctx = document.getElementById('lineChart').getContext('2d');
        const labels = data.map(d => d.review_date);
        const positive = data.map(d => d.positive_reviews);
        const negative = data.map(d => d.negative_reviews);
        const total = data.map(d => d.total_reviews);

        if (lineChart) lineChart.destroy();

        lineChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Total Reviews',
                        data: total,
                        borderColor: chartTheme.totalColor,
                        backgroundColor: chartTheme.totalColor,
                        borderWidth: 2,
                        tension: 0.4,
                        fill: false,
                        pointRadius: 0
                    },
                    {
                        label: 'Positive',
                        data: positive,
                        borderColor: chartTheme.positiveColor,
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true,
                        pointRadius: 0
                    },
                    {
                        label: 'Negative',
                        data: negative,
                        borderColor: chartTheme.negativeColor,
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: { grid: { color: chartTheme.gridColor } },
                    y: { grid: { color: chartTheme.gridColor } }
                },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        backgroundColor: 'rgba(26, 30, 41, 0.9)',
                        titleColor: '#fff',
                        bodyColor: '#e2e8f0',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1
                    }
                }
            }
        });
    }

    // Update Bar Chart
    function updateBarChart(data) {
        const ctx = document.getElementById('barChart').getContext('2d');
        // Top 10 for bar chart
        const top10 = data.slice(0, 10);
        const labels = top10.map(d => d.name);
        const positive = top10.map(d => d.positive_reviews);
        const negative = top10.map(d => d.negative_reviews);

        if (barChart) barChart.destroy();

        barChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Positive Reviews',
                        data: positive,
                        backgroundColor: chartTheme.positiveColor,
                    },
                    {
                        label: 'Negative Reviews',
                        data: negative,
                        backgroundColor: chartTheme.negativeColor,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: true, grid: { color: chartTheme.gridColor }, ticks: { maxRotation: 45, minRotation: 45 } },
                    y: { stacked: true, grid: { color: chartTheme.gridColor } }
                },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        backgroundColor: 'rgba(26, 30, 41, 0.9)',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1
                    }
                }
            }
        });
    }

    // Update Games Table
    function updateGamesTable(data) {
        elements.gamesTbody.innerHTML = '';

        if (data.length === 0) {
            elements.gamesTbody.innerHTML = `<tr><td colspan="5" style="text-align:center">No games found</td></tr>`;
            return;
        }

        data.forEach(game => {
            const tr = document.createElement('tr');

            // Color code positive rate
            let prClass = '';
            if (game.positive_rate > 80) prClass = 'success-text';
            else if (game.positive_rate < 50) prClass = 'danger-text';

            tr.innerHTML = `
                <td><strong>${game.name}</strong></td>
                <td>${fmt(game.total_reviews)}</td>
                <td class="${prClass}">${game.positive_rate}%</td>
                <td>${game.avg_playtime_hours}</td>
                <td>${fmt(game.recommendations_total)}</td>
            `;
            elements.gamesTbody.appendChild(tr);
        });
    }

    // Connection Status helper
    function setStatus(state, isMock = false) {
        const dot = elements.statusBadge.querySelector('.status-dot');
        if (state === 'loading') {
            dot.style.backgroundColor = '#f1c40f'; // Yellow
            dot.style.boxShadow = '0 0 8px #f1c40f';
            elements.statusText.textContent = 'Updating...';
        } else if (state === 'online') {
            dot.style.backgroundColor = isMock ? '#f39c12' : '#10b981';
            dot.style.boxShadow = isMock ? '0 0 8px #f39c12' : '0 0 8px #10b981';
            elements.statusText.textContent = isMock ? 'Connected' : 'Connected';
        } else if (state === 'error') {
            dot.style.backgroundColor = '#ef4444'; // Red
            dot.style.boxShadow = '0 0 8px #ef4444';
            elements.statusText.textContent = 'Connection Error';
        }
    }

    // Event Listeners
    elements.refreshBtn.addEventListener('click', initDashboard);
    elements.applyFiltersBtn.addEventListener('click', initDashboard);
    elements.gameSearch.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') initDashboard();
    });

    // Start
    initDashboard();

    // Auto refresh every 5 minutes
    setInterval(initDashboard, 5 * 60 * 1000);
});
