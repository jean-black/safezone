// Dashboard Histograms — Page 2
//
// Histogram 1: one bar per completed hour today  (resets at midnight)
// Histogram 2: one bar per completed day this month (resets end of month)
//
// The server adds bars at :59 of each hour / 23:59 each day.
// The page just fetches whatever bars are already stored.

let _chart1 = null;
let _chart2 = null;

// ─── Chart builders ──────────────────────────────────────────────────────────

function buildChart1(ctx) {
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: '#dc2626',
                borderColor: '#dc2626',
                borderRadius: 4,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title:  items => `Hour ${items[0].label}`,
                        label:  item  => `${item.parsed.y} breach${item.parsed.y !== 1 ? 'es' : ''}`
                    }
                }
            },
            scales: {
                x: { ticks: { color: '#ccc', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.07)' } },
                y: { beginAtZero: true, ticks: { color: '#ccc', stepSize: 1, precision: 0 }, grid: { color: 'rgba(255,255,255,0.07)' } }
            }
        }
    });
}

function buildChart2(ctx) {
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: '#dc2626',
                borderColor: '#dc2626',
                borderRadius: 4,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: item => `${item.parsed.y} breach${item.parsed.y !== 1 ? 'es' : ''}`
                    }
                }
            },
            scales: {
                x: { ticks: { color: '#ccc', font: { size: 11 }, maxRotation: 45 }, grid: { color: 'rgba(255,255,255,0.07)' } },
                y: { beginAtZero: true, ticks: { color: '#ccc', stepSize: 1, precision: 0 }, grid: { color: 'rgba(255,255,255,0.07)' } }
            }
        }
    });
}

// ─── Fetch & render ──────────────────────────────────────────────────────────

async function fetchAndRender() {
    const token = localStorage.getItem('authToken');
    if (!token || !_chart1 || !_chart2) return;

    try {
        const res = await fetch('/api/try/histogram-data', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const { hist1, hist2, today, month } = await res.json();

        // — Histogram 1: completed hours today —
        const h1Labels = (hist1 || []).map(b => `${String(b.h).padStart(2, '0')}h`);
        const h1Data   = (hist1 || []).map(b => b.c);

        _chart1.data.labels                        = h1Labels;
        _chart1.data.datasets[0].data              = h1Data;
        _chart1.update();

        // Update title date
        const d1 = document.getElementById('hist1Date');
        if (d1 && today) d1.textContent = today;

        // — Histogram 2: completed days this month —
        const h2Labels = (hist2 || []).map(b => b.date);
        const h2Data   = (hist2 || []).map(b => b.c);

        _chart2.data.labels           = h2Labels;
        _chart2.data.datasets[0].data = h2Data;
        _chart2.update();

        // Update title month
        const d2 = document.getElementById('hist2Month');
        if (d2 && month) d2.textContent = month;

    } catch (e) {
        console.error('Histogram fetch error:', e);
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function initDashboardHistograms() {
    const c1 = document.getElementById('histogram1Canvas');
    const c2 = document.getElementById('histogram2Canvas');
    if (!c1 || !c2) return;

    _chart1 = buildChart1(c1.getContext('2d'));
    _chart2 = buildChart2(c2.getContext('2d'));

    // Initial load
    fetchAndRender();

    // Refresh every 2 minutes to pick up any bar added while page is open
    setInterval(fetchAndRender, 120000);
}

document.addEventListener('DOMContentLoaded', () => setTimeout(initDashboardHistograms, 500));
