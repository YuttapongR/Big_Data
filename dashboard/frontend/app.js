document.addEventListener('DOMContentLoaded', () => {
    // API URL Base (handle local file opened directly or via Live Server on arbitrary ports)
    let API_BASE = '/api';
    if (window.location.protocol === 'file:') {
        API_BASE = 'http://localhost:8000/api';
    } else if (window.location.port && window.location.port !== '8000') {
        // Accessing from a different port (e.g. Live Server), target port 8000
        API_BASE = `http://${window.location.hostname}:8000/api`;
    }

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
        dqAppsClean: document.getElementById('dq-apps-clean'),
        // Sorting Controls
        sortSelect: document.getElementById('table-sort-select'),
        sortDirBtn: document.getElementById('table-sort-dir')
    };

    // Chart Instances
    let lineChart = null;
    let barChart = null;
    let hardcoreChart = null;
    let wordChart = null;

    // State
    let currentGamesData = [];
    let currentSortCol = 'recommendations_total';
    let currentSortDir = -1; // -1 for desc, 1 for asc

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

            currentGamesData = gamesData.data;

            updateKPIs(dashData);
            updateLineChart(dashData.data);
            updateBarChart(currentGamesData);
            
            // Fetch Hardcore Games Data
            try {
                const hcRes = await fetch(`${API_BASE}/hardcore-games`);
                const hcData = await hcRes.json();
                updateHardcoreChart(hcData.data);
            } catch (e) { console.warn("Hardcore Games API not ready yet"); }

            // Fetch Keywords Data
            try {
                const wordRes = await fetch(`${API_BASE}/common-words`);
                const wordData = await wordRes.json();
                updateWordChart(wordData.data);
            } catch (e) { console.warn("Keywords API not ready yet"); }

            sortAndRenderGamesTable();

            setStatus('online', dashData.is_mock);
        } catch (error) {
            console.error('Error fetching data from API:', error);
            const errorMsg = error.message || 'Connection Error';
            elements.statusText.textContent = `Error: ${errorMsg}`;
            const dot = elements.statusBadge.querySelector('.status-dot');
            dot.style.backgroundColor = '#ef4444';
            dot.style.boxShadow = '0 0 8px #ef4444';
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
                        label: 'Positive',
                        data: positive,
                        borderColor: chartTheme.positiveColor,
                        backgroundColor: 'rgba(16, 185, 129, 0.25)',
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true,
                        pointRadius: 0
                    },
                    {
                        label: 'Negative',
                        data: negative,
                        borderColor: chartTheme.negativeColor,
                        backgroundColor: 'rgba(239, 68, 68, 0.25)',
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
                    y: { stacked: true, grid: { color: chartTheme.gridColor }, beginAtZero: true }
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
        // Top 10 for bar chart, sorted by total reviews descending
        const top10 = [...data].sort((a, b) => b.total_reviews - a.total_reviews).slice(0, 10);
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
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { grid: { color: chartTheme.gridColor } },
                    y: { grid: { color: chartTheme.gridColor }, ticks: { autoSkip: false } }
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

    // Update Hardcore Fans Chart
    function updateHardcoreChart(data) {
        const ctx = document.getElementById('hardcoreChart');
        if (!ctx) return;

        if (!data || data.length === 0) {
            if (hardcoreChart) hardcoreChart.destroy();
            return;
        }

        const labels = data.map(d => d.name);
        const counts = data.map(d => d.hardcore_reviews);

        if (hardcoreChart) hardcoreChart.destroy();

        hardcoreChart = new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Reviews by Hardcore Fans',
                        data: counts,
                        backgroundColor: 'rgba(243, 156, 18, 0.7)',
                        borderColor: '#f39c12',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: chartTheme.gridColor },
                        ticks: { color: chartTheme.textColor },
                        title: { display: true, text: 'Number of Reviews (100+ hrs)', color: chartTheme.textColor }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: chartTheme.textColor }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(26, 30, 41, 0.9)',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1
                    }
                }
            }
        });
    }

    // Update Word Cloud Chart
    function updateWordChart(data) {
        const canvas = document.getElementById('wordCloudCanvas');
        if (!canvas) return;

        if (!data || data.length === 0) return;

        // Fix blurry canvas issue by setting internal resolution to match container
        const container = canvas.parentElement;
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;

        const maxCount = Math.max(...data.map(d => d.count));
        
        // Limit to top 80 words for a cleaner look
        const topWords = data.slice(0, 80);
        
        // Scale word size relative to max count, ensuring minimum readable size
        const list = topWords.map(d => [d.word, Math.max(16, (d.count / maxCount) * (canvas.width > 600 ? 90 : 60))]);

        WordCloud(canvas, {
            list: list,
            gridSize: 6,
            weightFactor: 1,
            fontFamily: 'Outfit, Inter, sans-serif',
            fontWeight: '700',
            color: function (word, weight) {
                // Color scale based on importance (weight)
                if (weight > 60) return '#66c0f4'; // Primary Blue
                if (weight > 45) return '#10b981'; // Accent Green
                if (weight > 30) return '#8b5cf6'; // Accent Purple
                if (weight > 20) return '#ec4899'; // Accent Pink
                return '#94a3b8'; // Muted Text for small words
            },
            rotateRatio: 0.15, // Keep mostly horizontal for easy reading
            rotationSteps: 2,
            backgroundColor: 'transparent',
            shape: 'square', // Fits the rectangular container better
            drawOutOfBound: false,
            shrinkToFit: true
        });
    }

    // Sorting Logic
    function sortAndRenderGamesTable() {
        if (!currentGamesData || currentGamesData.length === 0) {
            updateGamesTable([]);
            return;
        }

        currentGamesData.sort((a, b) => {
            let valA = a[currentSortCol];
            let valB = b[currentSortCol];

            // Convert to number for numeric columns
            if (currentSortCol !== 'name') {
                valA = Number(valA) || 0;
                valB = Number(valB) || 0;
            } else {
                valA = String(valA || '').toLowerCase();
                valB = String(valB || '').toLowerCase();
            }

            if (valA < valB) return -1 * currentSortDir;
            if (valA > valB) return 1 * currentSortDir;
            return 0;
        });

        updateGamesTable(currentGamesData);
        updateSortIcons();
    }

    function updateSortIcons() {
        if (elements.sortSelect) {
            elements.sortSelect.value = currentSortCol;
        }
        if (elements.sortDirBtn) {
            elements.sortDirBtn.innerHTML = currentSortDir === -1 ? '<i class="fa-solid fa-arrow-down-z-a"></i>' : '<i class="fa-solid fa-arrow-up-a-z"></i>';
        }
        document.querySelectorAll('th.sortable').forEach(th => {
            const icon = th.querySelector('i');
            icon.className = 'fa-solid fa-sort'; // reset
            if (th.dataset.sort === currentSortCol) {
                icon.className = currentSortDir === -1 ? 'fa-solid fa-sort-down' : 'fa-solid fa-sort-up';
            }
        });
    }

    // Update Games Table
    function updateGamesTable(data) {
        elements.gamesTbody.innerHTML = '';

        if (data.length === 0) {
            elements.gamesTbody.innerHTML = `<tr><td colspan="7" style="text-align:center">No games found</td></tr>`;
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
                <td>${game.metacritic_score > 0 ? game.metacritic_score : '-'}</td>
                <td>${Number(game.price) > 0 ? '$' + Number(game.price).toFixed(2) : (game.is_free ? 'Free' : '-')}</td>
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

    elements.refreshBtn.addEventListener('click', initDashboard);
    elements.applyFiltersBtn.addEventListener('click', initDashboard);
    elements.gameSearch.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') initDashboard();
    });

    if (elements.sortSelect) {
        elements.sortSelect.addEventListener('change', (e) => {
            currentSortCol = e.target.value;
            sortAndRenderGamesTable();
        });
    }

    if (elements.sortDirBtn) {
        elements.sortDirBtn.addEventListener('click', () => {
            currentSortDir *= -1;
            sortAndRenderGamesTable();
        });
    }

    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (currentSortCol === col) {
                currentSortDir *= -1; // toggle
            } else {
                currentSortCol = col;
                currentSortDir = -1; // default desc
            }
            sortAndRenderGamesTable();
        });
    });

    // Start
    initDashboard();

    // Auto refresh every 5 minutes
    setInterval(initDashboard, 5 * 60 * 1000);
});
