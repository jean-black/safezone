// New Cows List Functionality for Tracking Page
let newCows = [];
let availableFarms = [];
let newCowsCheckInterval;

// Load new cows when tracking page loads
if (window.location.pathname.includes('page6_real-time-tracking.html')) {
    // Check for new cows every 30 seconds
    loadNewCows();
    newCowsCheckInterval = setInterval(loadNewCows, 30000);
}

// Load new cows from API
async function loadNewCows() {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch('/api/cows/new', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            newCows = data.newCows || [];

            // Show or hide the panel based on if there are new cows
            const panel = document.getElementById('newCowsPanel');
            if (newCows.length > 0) {
                panel.style.display = 'block';
                renderNewCows();
            } else {
                panel.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error loading new cows:', error);
    }
}

// Load available farms for assignment
async function loadAvailableFarms() {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch('/api/farms', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            availableFarms = data.farms || [];
        }
    } catch (error) {
        console.error('Error loading farms:', error);
    }
}

// Render new cows list
function renderNewCows() {
    const container = document.getElementById('newCowsList');

    if (newCows.length === 0) {
        container.innerHTML = '<p class="no-new-cows">No new cows to assign</p>';
        return;
    }

    // Load farms for dropdown
    if (availableFarms.length === 0) {
        loadAvailableFarms();
    }

    // Bulk assign section
    let html = `
        <div class="bulk-assign-section">
            <h4>Bulk Assign All New Cows</h4>
            <div class="bulk-controls">
                <select id="bulkAssignFarm">
                    <option value="">Select Farm</option>
                    ${availableFarms.map(farm => `<option value="${farm.farm_token}">${farm.farm_name}</option>`).join('')}
                </select>
                <button onclick="bulkAssignCows()">Assign All to Farm</button>
            </div>
        </div>
    `;

    // Individual cow cards
    html += newCows.map(cow => `
        <div class="new-cow-card">
            <h4>🐄 ${cow.cow_nickname || cow.cow_name}</h4>
            <div class="new-cow-info">
                <strong>Collar ID:</strong> ${cow.collar_id}
            </div>
            <div class="new-cow-info">
                <strong>Added:</strong> ${new Date(cow.timestamp).toLocaleString()}
            </div>
            <select class="assign-farm-select" id="farm-${cow.cow_token}">
                <option value="">Select Farm</option>
                ${availableFarms.map(farm => `<option value="${farm.farm_token}">${farm.farm_name}</option>`).join('')}
            </select>
            <button class="assign-btn" onclick="assignSingleCow('${cow.cow_token}')">
                Assign to Farm
            </button>
        </div>
    `).join('');

    container.innerHTML = html;
}

// Assign a single cow to a farm
async function assignSingleCow(cowToken) {
    const farmToken = document.getElementById(`farm-${cowToken}`).value;

    if (!farmToken) {
        alert('Please select a farm first');
        return;
    }

    const token = localStorage.getItem('authToken');

    try {
        const response = await fetch(`/api/cows/${cowToken}/assign-farm`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ farmToken })
        });

        if (response.ok) {
            alert('Cow assigned to farm successfully!');
            loadNewCows(); // Refresh the list
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'Failed to assign cow'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to assign cow. Please try again.');
    }
}

// Bulk assign all new cows to a farm
async function bulkAssignCows() {
    const farmToken = document.getElementById('bulkAssignFarm').value;

    if (!farmToken) {
        alert('Please select a farm first');
        return;
    }

    if (!confirm(`Assign all ${newCows.length} new cows to this farm?`)) {
        return;
    }

    const token = localStorage.getItem('authToken');
    const cowTokens = newCows.map(cow => cow.cow_token);

    try {
        const response = await fetch('/api/cows/bulk-assign', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ cowTokens, farmToken })
        });

        if (response.ok) {
            alert('All cows assigned successfully!');
            loadNewCows(); // Refresh the list
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'Failed to assign cows'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to assign cows. Please try again.');
    }
}

// Close the new cows panel
function closeNewCowsPanel() {
    document.getElementById('newCowsPanel').style.display = 'none';
}

// Clean up interval when leaving the page
window.addEventListener('beforeunload', () => {
    if (newCowsCheckInterval) {
        clearInterval(newCowsCheckInterval);
    }
});
