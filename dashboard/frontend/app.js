document.addEventListener('DOMContentLoaded', () => {
    let API_BASE = '/api';
    if (window.location.protocol === 'file:') {
        API_BASE = 'http://localhost:8000/api';
    } else if (window.location.port && window.location.port !== '8000') {
        API_BASE = `http://${window.location.hostname}:8000/api`;
    }

    const elements = {
        totalReviews: document.getElementById('total-reviews'),
        positiveRate: document.getElementById('positive-rate'),
        uniqueReviewers: document.getElementById('unique-reviewers'),
        uniqueGames: document.getElementById('unique-games'),
        statusBadge: document.getElementById('live-status'),
        statusText: document.getElementById('update-status'),
        pipelineBadge: document.getElementById('pipeline-badge'),
        lastUpdate: document.getElementById('last-update-time'),
        refreshBtn: document.getElementById('refresh-btn'),
        applyFiltersBtn: document.getElementById('apply-filters'),

        gameSearch: document.getElementById('game-search'),
        slicerGenre: document.getElementById('slicer-genre'),
        slicerYear: document.getElementById('slicer-year'),
        slicerPrice: document.getElementById('slicer-price'),
        gamesTbody: document.getElementById('games-tbody'),
        dqReviewsTotal: document.getElementById('dq-reviews-total'),
        dqReviewsClean: document.getElementById('dq-reviews-clean'),
        dqReviewsDropped: document.getElementById('dq-reviews-dropped'),
        dqAppsTotal: document.getElementById('dq-apps-total'),
        dqAppsClean: document.getElementById('dq-apps-clean'),
        dqAppsIndexed: document.getElementById('dq-apps-indexed'),
        tableSortSelect: document.getElementById('table-sort-select'),
        tableSortDir: document.getElementById('table-sort-dir')
    };

    let charts = {};
    let fullGamesData = [];
    let lastWordData = []; // Store for re-render
    let currentFilteredData = []; // Store for re-render
    let sortKey = 'total_reviews';
    let sortDir = 'desc';

    const chartTheme = {
        gridColor: 'rgba(255, 255, 255, 0.05)',
        textColor: '#94a3b8',
        colors: ['#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4', '#ef4444', '#84cc16']
    };

    Chart.defaults.color = chartTheme.textColor;
    Chart.defaults.font.family = "'Inter', sans-serif";

    async function initDashboard() {
        await checkPipelineStatus();
        await fetchAllData();
        await fetchDataQuality();
    }

    async function fetchAllData() {
        setStatus('loading');
        try {
            // Fetch dash (for area chart)
            const dashRes = await fetch(`${API_BASE}/dashboard-data`);
            const dashData = await dashRes.json();

            // Fetch games analytics
            let gUrl = `${API_BASE}/games-analytics?`;
            const gRes = await fetch(gUrl);
            const gData = await gRes.json();
            fullGamesData = gData.data;

            // Extract slicer options
            populateSlicers(fullGamesData);

            // Fetch words
            try {
                const wordRes = await fetch(`${API_BASE}/common-words`);
                const wordData = await wordRes.json();
                lastWordData = wordData.data; // Save to global
                updateWordCloud(lastWordData);
            } catch (e) { console.error("Word data fail", e); }

            updateKPIs(dashData);
            updateAreaChart(dashData.data);

            applyClientSideFiltersAndRender();

            setStatus('online', false);
        } catch (e) {
            console.error(e);
            setStatus('error');
        }
    }

    function populateSlicers(data) {
        if (!data || !data.length) return;
        const genres = [...new Set(data.map(d => d.genre))].filter(Boolean).sort();
        const years = [...new Set(data.map(d => d.release_year))].filter(y => y > 1990).sort((a, b) => b - a);

        const gVal = elements.slicerGenre.value;
        const yVal = elements.slicerYear.value;

        elements.slicerGenre.innerHTML = '<option value="All">ทุกแนวเกม</option>' + genres.map(g => `<option value="${g}">${g}</option>`).join('');
        elements.slicerYear.innerHTML = '<option value="All">ทุกปี</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');

        if (genres.includes(gVal)) elements.slicerGenre.value = gVal;
        if (years.includes(Number(yVal))) elements.slicerYear.value = yVal;
    }

    function applyClientSideFiltersAndRender() {
        let filtered = [...fullGamesData];

        const search = elements.gameSearch.value.toLowerCase();
        const genre = elements.slicerGenre.value;
        const year = elements.slicerYear.value;
        const maxPrice = parseFloat(elements.slicerPrice.value);
        const removeOutlier = true; // กรอง top 1% outlier เสมอ

        if (search) filtered = filtered.filter(d => (d.name || '').toLowerCase().includes(search));
        if (genre !== 'All') filtered = filtered.filter(d => d.genre === genre);
        if (year !== 'All') filtered = filtered.filter(d => d.release_year == year);
        if (!isNaN(maxPrice)) filtered = filtered.filter(d => d.price <= maxPrice);

        if (removeOutlier && filtered.length > 20) {
            // Remove top 1% by reviews to prevent skewed charts
            filtered.sort((a, b) => b.total_reviews - a.total_reviews);
            const p1 = Math.ceil(filtered.length * 0.01);
            filtered = filtered.slice(p1);
        }

        currentFilteredData = filtered; // Save to global
        renderGamesCharts(filtered);
    }

    function renderGamesCharts(data) {
        try { updateGenreBarChart(data); } catch (e) { console.error("Genre chart error", e); }
        try { updateScatter(data); } catch (e) { console.error("Scatter chart error", e); }
        try { updateRevenueBar(data); } catch (e) { console.error("Revenue chart error", e); }
        try { updateBubble(data); } catch (e) { console.error("Bubble chart error", e); }
        try { updateFreePaidDonut(data); } catch (e) { console.error("Free/Paid chart error", e); }
        try { updateLangStacked(data); } catch (e) { console.error("Lang chart error", e); }

        // Sort data before table update
        const sorted = [...data].sort((a, b) => {
            const valA = a[sortKey] || 0;
            const valB = b[sortKey] || 0;
            return sortDir === 'asc' ? valA - valB : valB - valA;
        });

        try { updateTable(sorted.slice(0, 50)); } catch (e) { console.error("Table error", e); }
    }

    function destroyChart(id) {
        if (charts[id]) { charts[id].destroy(); }
    }

    function updateAreaChart(data) {
        destroyChart('releaseAreaChart');
        const ctx = document.getElementById('releaseAreaChart').getContext('2d');
        const labels = data.map(d => d.review_date);

        charts['releaseAreaChart'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'จำนวนรีวิว (ตัวแทนกิจกรรม)',
                    data: data.map(d => d.total_reviews),
                    borderColor: chartTheme.colors[0],
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    fill: true, tension: 0.4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { x: { grid: { color: chartTheme.gridColor } }, y: { grid: { color: chartTheme.gridColor } } }
            }
        });
    }

    function updateGenreBarChart(data) {
        destroyChart('genreBarChart');
        const canvas = document.getElementById('genreBarChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        const genreStats = {};
        data.forEach(d => {
            if (!d.genre) return;
            if (!genreStats[d.genre]) genreStats[d.genre] = { free: 0, paid: 0, total: 0 };

            genreStats[d.genre].total++;
            // Assume price is 0 or is_free is true for free games
            if (Number(d.price) === 0 || d.is_free) {
                genreStats[d.genre].free++;
            } else {
                genreStats[d.genre].paid++;
            }
        });

        // Sort by total count descending
        let sortedGenres = Object.keys(genreStats)
            .map(g => ({ genre: g, ...genreStats[g] }))
            .sort((a, b) => b.total - a.total);

        // Take top 15, group the rest
        let displayData = [];
        if (sortedGenres.length > 15) {
            displayData = sortedGenres.slice(0, 15);
            const others = sortedGenres.slice(15).reduce((acc, curr) => {
                acc.free += curr.free;
                acc.paid += curr.paid;
                acc.total += curr.total;
                return acc;
            }, { genre: 'Others (Misc)', free: 0, paid: 0, total: 0 });
            displayData.push(others);
        } else {
            displayData = sortedGenres;
        }

        charts['genreBarChart'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: displayData.map(d => d.genre),
                datasets: [
                    {
                        label: 'เกมฟรี',
                        data: displayData.map(d => d.free),
                        backgroundColor: chartTheme.colors[1], // Accent Green
                        borderRadius: 4
                    },
                    {
                        label: 'เกมจ่ายเงิน',
                        data: displayData.map(d => d.paid),
                        backgroundColor: chartTheme.colors[0], // Accent Blue
                        borderRadius: 4
                    }
                ]
            },
            options: {
                indexAxis: 'y', // Horizontal Bar
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: true, grid: { color: chartTheme.gridColor } },
                    y: { stacked: true, grid: { color: chartTheme.gridColor } }
                },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            footer: (tooltipItems) => {
                                let total = 0;
                                tooltipItems.forEach(item => {
                                    total += item.raw;
                                });
                                return 'รวมทั้งหมด: ' + total + ' เกม';
                            }
                        }
                    }
                }
            }
        });
    }

    function updateScatter(data) {
        destroyChart('priceScoreScatterChart');
        const ctx = document.getElementById('priceScoreScatterChart').getContext('2d');

        const scatterData = data.map(d => ({ x: d.price, y: d.positive_rate, name: d.name }));

        charts['priceScoreScatterChart'] = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'เกม',
                    data: scatterData,
                    backgroundColor: chartTheme.colors[1] + '99',
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: 'ราคา ($)' }, grid: { color: chartTheme.gridColor } },
                    y: { title: { display: true, text: 'อัตรารีวิวดี (%)' }, grid: { color: chartTheme.gridColor } }
                },
                plugins: {
                    tooltip: {
                        callbacks: { label: (ctx) => `${ctx.raw.name}: $${ctx.raw.x}, ดี ${ctx.raw.y}%` }
                    }
                }
            }
        });
    }

    function updateRevenueBar(data) {
        destroyChart('revenueBarChart');
        const ctx = document.getElementById('revenueBarChart').getContext('2d');

        const rev = {};
        data.forEach(d => {
            if (d.genre) rev[d.genre] = (rev[d.genre] || 0) + (d.estimated_revenue || 0);
        });

        const sorted = Object.keys(rev).map(g => ({ g, r: rev[g] })).sort((a, b) => b.r - a.r).slice(0, 10);

        charts['revenueBarChart'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: sorted.map(s => s.g),
                datasets: [{
                    label: 'รายได้ประมาณการ',
                    data: sorted.map(s => s.r),
                    backgroundColor: chartTheme.colors[4],
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                scales: { x: { grid: { color: chartTheme.gridColor } }, y: { grid: { color: chartTheme.gridColor } } }
            }
        });
    }

    function updateBubble(data) {
        destroyChart('revenueBubbleChart');
        const ctx = document.getElementById('revenueBubbleChart').getContext('2d');

        // Take top 50 by revenue for bubble to avoid crowding
        const top = [...data].sort((a, b) => (b.estimated_revenue || 0) - (a.estimated_revenue || 0)).slice(0, 50);
        const maxRev = Math.max(1, ...top.map(d => d.estimated_revenue || 0));

        const bubbleData = top.map(d => ({
            x: d.total_reviews || 0,
            y: d.price || 0,
            r: Math.max(5, ((d.estimated_revenue || 0) / maxRev) * 30),
            name: d.name || 'Unknown',
            rev: d.estimated_revenue || 0
        }));

        charts['revenueBubbleChart'] = new Chart(ctx, {
            type: 'bubble',
            data: {
                datasets: [{
                    label: 'เกมรายได้สูงสุด',
                    data: bubbleData,
                    backgroundColor: chartTheme.colors[3] + 'aa'
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: 'รีวิวทั้งหมด' }, grid: { color: chartTheme.gridColor } },
                    y: { title: { display: true, text: 'ราคา ($)' }, grid: { color: chartTheme.gridColor } }
                },
                plugins: {
                    tooltip: {
                        callbacks: { label: (ctx) => `${ctx.raw.name}: รายได้ $${(ctx.raw.rev / 1000000).toFixed(1)}M` }
                    }
                }
            }
        });
    }

    function updateFreePaidDonut(data) {
        destroyChart('freePaidDonutChart');
        const canvas = document.getElementById('freePaidDonutChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let free = 0, paid = 0;
        data.forEach(d => {
            if (Number(d.price) === 0 || d.is_free) {
                free++;
            } else {
                paid++;
            }
        });

        charts['freePaidDonutChart'] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['เกมฟรี', 'เกมจ่ายเงิน'],
                datasets: [{
                    data: [free, paid],
                    backgroundColor: [chartTheme.colors[1], chartTheme.colors[0]],
                    borderWidth: 0
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, cutout: '70%' }
        });
    }

    function updateLangStacked(data) {
        destroyChart('langStackedBarChart');
        const ctx = document.getElementById('langStackedBarChart').getContext('2d');

        const langByGenre = {};
        data.forEach(d => {
            if (!d.genre) return;
            if (!langByGenre[d.genre]) langByGenre[d.genre] = [];
            langByGenre[d.genre].push(d.language_count || 1);
        });

        const genres = Object.keys(langByGenre).slice(0, 10);
        const avgLangs = genres.map(g => langByGenre[g].reduce((a, b) => a + b, 0) / langByGenre[g].length);

        charts['langStackedBarChart'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: genres,
                datasets: [{
                    label: 'จำนวนภาษาเฉลี่ยที่รองรับ',
                    data: avgLangs,
                    backgroundColor: chartTheme.colors[2]
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { color: chartTheme.gridColor } }, y: { grid: { color: chartTheme.gridColor } } } }
        });
    }

    function updateWordCloud(data) {
        const canvas = document.getElementById('wordCloudCanvas');
        if (!canvas) return;

        const container = canvas.parentElement;
        if (container.clientWidth === 0) return; // Wait for tab to be visible

        if (!data || !data.length) return;

        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;

        const maxCount = Math.max(1, ...data.map(d => d.count || 0));
        const list = data.slice(0, 80).map(d => [d.word, Math.max(16, ((d.count || 0) / maxCount) * (canvas.width > 600 ? 90 : 60))]);

        WordCloud(canvas, {
            list,
            gridSize: 8,
            weightFactor: 1,
            fontFamily: 'Outfit, sans-serif',
            fontWeight: '700',
            color: (word, weight) => {
                if (weight > 60) return '#66c0f4';
                if (weight > 40) return '#10b981';
                if (weight > 25) return '#8b5cf6';
                return '#94a3b8';
            },
            rotateRatio: 0.1,
            backgroundColor: 'transparent',
            shape: 'square',
            shrinkToFit: true
        });
    }

    function updateTable(data) {
        elements.gamesTbody.innerHTML = '';
        if (!data || !data.length) return elements.gamesTbody.innerHTML = '<tr><td colspan="6">ไม่พบเกม</td></tr>';

        data.forEach(game => {
            const tr = document.createElement('tr');

            const name = game.name || 'Unknown';
            const genre = game.genre || '';
            const reviews = (game.total_reviews || 0).toLocaleString();
            const rate = game.positive_rate !== undefined && game.positive_rate !== null ? Number(game.positive_rate) : 0;
            const posRate = rate + '%';
            const playtime = game.avg_playtime_hours !== undefined && game.avg_playtime_hours !== null ? game.avg_playtime_hours : 'N/A';
            const price = (Number(game.price) > 0) ? '$' + Number(game.price).toFixed(2) : (game.is_free ? 'Free' : '$0.00');
            const recs = (game.recommendations_total || 0).toLocaleString();

            // กำหนดสีตาม Positive Rate
            let rateClass = '';
            let rateStyle = '';
            if (rate >= 80) {
                rateClass = 'success-text';          // เขียว: รีวิวดี
            } else if (rate >= 50) {
                rateStyle = 'color: #f59e0b; font-weight: 600;'; // เหลือง: กึ่งกลาง
            } else {
                rateClass = 'danger-text';            // แดง: รีวิวไม่ดี
            }

            tr.innerHTML = `
                <td><strong>${name}</strong><br><small style="color:var(--text-muted)">${genre}</small></td>
                <td>${reviews}</td>
                <td class="${rateClass}" style="${rateStyle}">${posRate}</td>
                <td>${playtime}</td>
                <td>${price}</td>
                <td>${recs}</td>
            `;
            elements.gamesTbody.appendChild(tr);
        });
    }

    function updateKPIs(payload) {
        if (payload && payload.summary) {
            const s = payload.summary;
            if (elements.totalReviews) elements.totalReviews.textContent = (s.total_reviews || 0).toLocaleString();
            if (elements.positiveRate) elements.positiveRate.textContent = `${s.positive_rate || 0}%`;
            if (elements.uniqueReviewers) elements.uniqueReviewers.textContent = (s.unique_reviewers || 0).toLocaleString();
            if (elements.uniqueGames) elements.uniqueGames.textContent = (s.total_games || 0).toLocaleString();
            if (elements.lastUpdate && s.last_updated) elements.lastUpdate.textContent = `อัปเดตล่าสุด: ${s.last_updated}`;
        }
    }

    async function checkPipelineStatus() {
        try {
            const res = await fetch(`${API_BASE}/pipeline-status`);
            const st = await res.json();
            if (st.status === 'completed') { elements.pipelineBadge.className = 'status-item pipeline-status success'; elements.pipelineBadge.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>Pipeline: พร้อมใช้งาน</span>`; }
        } catch (e) { }
    }

    async function fetchDataQuality() {
        try {
            const res = await fetch(`${API_BASE}/data-quality`);
            const dq = await res.json();
            if (dq.data) {
                if (dq.data.reviews_total_scanned !== undefined && elements.dqReviewsTotal) {
                    elements.dqReviewsTotal.textContent = (dq.data.reviews_total_scanned || 0).toLocaleString();
                }
                if (dq.data.reviews_cleaned_count !== undefined && elements.dqReviewsClean) {
                    elements.dqReviewsClean.textContent = (dq.data.reviews_cleaned_count || 0).toLocaleString();
                }
                if (dq.data.reviews_dropped !== undefined && elements.dqReviewsDropped) {
                    elements.dqReviewsDropped.textContent = (dq.data.reviews_dropped || 0).toLocaleString();
                }
                if (dq.data.apps_total !== undefined && elements.dqAppsTotal) {
                    elements.dqAppsTotal.textContent = (dq.data.apps_total || 0).toLocaleString();
                }
                if (dq.data.apps_cleaned !== undefined && elements.dqAppsClean) {
                    elements.dqAppsClean.textContent = (dq.data.apps_cleaned || 0).toLocaleString();
                    if (elements.dqAppsIndexed) {
                        elements.dqAppsIndexed.textContent = (dq.data.apps_cleaned || 0).toLocaleString();
                    }
                }
            }
        } catch (e) { console.error('DQ fetch error:', e); }
    }

    function setStatus(state, isMock = false) {
        const dot = elements.statusBadge.querySelector('.status-dot');
        if (state === 'loading') { dot.style.backgroundColor = '#f1c40f'; elements.statusText.textContent = 'กำลังอัปเดต...'; }
        else if (state === 'online') { dot.style.backgroundColor = '#10b981'; elements.statusText.textContent = 'เชื่อมต่อแล้ว'; }
        else { dot.style.backgroundColor = '#ef4444'; elements.statusText.textContent = 'ข้อผิดพลาด'; }
    }

    elements.refreshBtn.addEventListener('click', initDashboard);
    elements.applyFiltersBtn.addEventListener('click', applyClientSideFiltersAndRender);
    elements.gameSearch.addEventListener('keypress', (e) => { if (e.key === 'Enter') applyClientSideFiltersAndRender(); });

    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const newSortKey = th.getAttribute('data-sort');
            if (sortKey === newSortKey) {
                sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortKey = newSortKey;
                sortDir = 'desc'; // default to desc for most metrics
            }

            // update UI icons
            document.querySelectorAll('.sortable i').forEach(i => i.className = 'fa-solid fa-sort');
            const icon = sortDir === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
            th.querySelector('i').className = icon;

            renderGamesCharts(currentFilteredData);
        });
    });

    // Tab Switching Logic
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Reset all buttons
            tabBtns.forEach(b => {
                b.classList.remove('active', 'glow-button');
                b.style.color = 'var(--text-muted)';
                b.style.borderBottomColor = 'transparent';
            });

            // Set active button
            btn.classList.add('active', 'glow-button');
            btn.style.color = 'var(--text-color)';
            btn.style.borderBottomColor = 'var(--primary-glow)'; // or any highlight color

            // Hide all tab contents
            tabContents.forEach(tc => {
                tc.style.display = 'none';
                tc.classList.remove('active-tab');
            });

            // Show active tab content
            const targetId = btn.getAttribute('data-tab');
            const targetContent = document.getElementById(targetId);
            if (targetContent) {
                targetContent.style.display = 'block';
                targetContent.classList.add('active-tab');

                // Trigger re-render for charts that need visibility to calculate size
                setTimeout(() => {
                    if (targetId === 'tab-quality' && lastWordData.length > 0) {
                        updateWordCloud(lastWordData);
                    }
                    if (currentFilteredData.length > 0) {
                        renderGamesCharts(currentFilteredData);
                    }
                }, 50);
            }
        });
    });

    // Initialize first tab styles
    const activeBtn = document.querySelector('.tab-btn.active');
    if (activeBtn) {
        activeBtn.style.color = 'var(--text-color)';
        activeBtn.style.borderBottomColor = '#3b82f6';
    }

    initDashboard();
});
