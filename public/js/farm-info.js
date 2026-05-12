// Farm Information Page - Data Loading and Download Functionality
let farms = [];
let cows = [];

// Load all data when page loads
document.addEventListener('DOMContentLoaded', () => {
    loadAllData();
});

// Load all data
async function loadAllData() {
    await Promise.all([
        loadFarms(),
        loadCows()
    ]);
}

// Load farms from API
async function loadFarms() {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch('/api/farms', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            farms = data.farms || [];
            renderFarms();
        } else {
            document.getElementById('farmTableBody').innerHTML = '<tr><td colspan="4" class="empty-state">Failed to load farms</td></tr>';
        }
    } catch (error) {
        console.error('Error loading farms:', error);
        document.getElementById('farmTableBody').innerHTML = '<tr><td colspan="4" class="empty-state">Error loading farms</td></tr>';
    }
}

// Load cows from API
async function loadCows() {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch('/api/cows', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            cows = (await response.json()).cows || [];
            renderCows();
        } else {
            document.getElementById('cowTableBody').innerHTML = '<tr><td colspan="7" class="empty-state">Failed to load cows</td></tr>';
        }
    } catch (error) {
        console.error('Error loading cows:', error);
        document.getElementById('cowTableBody').innerHTML = '<tr><td colspan="7" class="empty-state">Error loading cows</td></tr>';
    }
}

// Render farms as table
function renderFarms() {
    const tbody = document.getElementById('farmTableBody');

    if (farms.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No farms found.</td></tr>';
        return;
    }

    tbody.innerHTML = farms.map(farm => {
        const farmCows = cows.filter(cow => cow.farm_token === farm.farm_token);

        return `
            <tr>
                <td><strong>${farm.farm_name}</strong></td>
                <td>${farm.farm_gps || 'Not set'}</td>
                <td>${farmCows.length}</td>
                <td>${new Date(farm.timestamp).toLocaleString()}</td>
            </tr>
        `;
    }).join('');
}

// Render cows as table, sorted by farm name
function renderCows() {
    const tbody = document.getElementById('cowTableBody');

    if (cows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No cows found.</td></tr>';
        return;
    }

    // Sort cows by farm name
    const sortedCows = [...cows].sort((a, b) => {
        const farmA = farms.find(f => f.farm_token === a.farm_token);
        const farmB = farms.find(f => f.farm_token === b.farm_token);

        const farmNameA = farmA ? farmA.farm_name : 'Unassigned';
        const farmNameB = farmB ? farmB.farm_name : 'Unassigned';

        return farmNameA.localeCompare(farmNameB);
    });

    tbody.innerHTML = sortedCows.map(cow => {
        const farm = farms.find(f => f.farm_token === cow.farm_token);
        const farmName = farm ? farm.farm_name : 'Not Assigned';

        return `
            <tr>
                <td><strong>${cow.cow_name}</strong></td>
                <td>${cow.cow_nickname || '-'}</td>
                <td>${farmName}</td>
                <td>${cow.collar_id}</td>
                <td>${cow.state_fence || 'Unknown'}</td>
                <td>${cow.total_breach || 0}</td>
                <td>${new Date(cow.timestamp).toLocaleString()}</td>
            </tr>
        `;
    }).join('');
}

// Format time in seconds to readable format
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

// Download farm data as TXT
async function downloadFarmData(farmToken) {
    const token = localStorage.getItem('authToken');

    try {
        const response = await fetch(`/api/farms/${farmToken}/download`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const data = await response.json();

            // Convert to formatted text
            const farmData = data.farm;
            const farmCows = data.cows || [];
            const farmFences = data.fences || [];

            const reportContent = `
SAFEZONE FARM REPORT
====================

Farm Information
----------------
Farm Name: ${farmData.name}
Farm Token: ${farmToken}
GPS Coordinates: ${farmData.gps || 'Not set'}
Created: ${new Date(farmData.createdAt).toLocaleString()}

Statistics
----------
Total Cows: ${farmCows.length}
Total Fences: ${farmFences.length}
Cows Inside Fence: ${data.cowsInside || 0}
Cows Outside Fence: ${data.cowsOutside || 0}

Cows in this Farm
-----------------
${farmCows.length > 0 ? farmCows.map((cow, i) => `
${i + 1}. ${cow.nickname || cow.name}
   Collar ID: ${cow.collarId}
   State: ${cow.state || 'Unknown'}
   Time Inside: ${formatTime(cow.timeInside || 0)}
   Time Outside: ${formatTime(cow.timeOutside || 0)}
   Total Breaches: ${cow.breaches || 0}
`).join('\n') : 'No cows in this farm'}

Fences in this Farm
-------------------
${farmFences.length > 0 ? farmFences.map((fence, i) => `
${i + 1}. ${fence.name}
   Coordinates: ${fence.coordinates ? JSON.parse(fence.coordinates).length : 0} nodes
`).join('\n') : 'No fences in this farm'}

Generated: ${new Date().toLocaleString()}
SafeZone - Near East University
            `.trim();

            // Download as text file
            const blob = new Blob([reportContent], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${farmData.name}_report_${new Date().toISOString().split('T')[0]}.txt`;
            a.click();
            window.URL.revokeObjectURL(url);

            alert('Farm report downloaded successfully!');
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'Failed to download farm data'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to download farm data. Please try again.');
    }
}

// Download cow data as TXT
async function downloadCowData(collarId) {
    const cow = cows.find(c => c.collar_id === collarId);
    if (!cow) {
        alert('Cow not found');
        return;
    }

    const farm = farms.find(f => f.farm_token === cow.farm_token);
    const timeInside = formatTime(cow.time_inside || 0);
    const timeOutside = formatTime(cow.time_outside || 0);

    const reportContent = `
SAFEZONE COW REPORT
===================

Cow Information
---------------
Cow Name: ${cow.cow_nickname || cow.cow_name}
Cow ID: ${cow.cow_name}
Collar ID: ${cow.collar_id}
Farm: ${farm ? farm.farm_name : 'Not Assigned'}

Status Information
------------------
Current State: ${cow.state_fence || 'Unknown'}
Total Breaches: ${cow.total_breach || 0}
Time Inside Fence: ${timeInside}
Time Outside Fence: ${timeOutside}

GPS Tracking
------------
Last Known Position: ${cow.gps_latitude && cow.gps_longitude ?
    `Lat: ${cow.gps_latitude}, Lng: ${cow.gps_longitude}` : 'Not available'}

Timestamps
----------
First Recorded: ${new Date(cow.timestamp).toLocaleString()}
Last Updated: ${new Date(cow.timestamp).toLocaleString()}

Generated: ${new Date().toLocaleString()}
SafeZone - Near East University
    `.trim();

    const blob = new Blob([reportContent], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cow.cow_nickname || cow.cow_name}_report_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    window.URL.revokeObjectURL(url);

    alert('Cow report downloaded successfully!');
}

// Download all farms data
function downloadAllFarmsData() {
    if (farms.length === 0) {
        alert('No farms to download');
        return;
    }

    const reportContent = `
SAFEZONE ALL FARMS REPORT
=========================

Generated: ${new Date().toLocaleString()}
Total Farms: ${farms.length}
Total Cows: ${cows.length}

===============================

${farms.map((farm, index) => {
    const farmCows = cows.filter(cow => cow.farm_token === farm.farm_token);
    return `
Farm ${index + 1}: ${farm.farm_name}
--------------------------------
Farm Token: ${farm.farm_token}
GPS Coordinates: ${farm.farm_gps || 'Not set'}
Number of Cows: ${farmCows.length}
Created: ${new Date(farm.timestamp).toLocaleString()}

Cows in this farm:
${farmCows.length > 0 ? farmCows.map((cow, i) => `  ${i + 1}. ${cow.cow_nickname || cow.cow_name} (${cow.collar_id})`).join('\n') : '  No cows assigned'}

`;
}).join('\n')}

===============================
SafeZone - Near East University
    `.trim();

    const blob = new Blob([reportContent], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all_farms_report_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    window.URL.revokeObjectURL(url);

    alert('All farms report downloaded successfully!');
}

// Download all cows data
function downloadAllCowsData() {
    if (cows.length === 0) {
        alert('No cows to download');
        return;
    }

    // Sort cows by farm name for the report
    const sortedCows = [...cows].sort((a, b) => {
        const farmA = farms.find(f => f.farm_token === a.farm_token);
        const farmB = farms.find(f => f.farm_token === b.farm_token);
        const farmNameA = farmA ? farmA.farm_name : 'Unassigned';
        const farmNameB = farmB ? farmB.farm_name : 'Unassigned';
        return farmNameA.localeCompare(farmNameB);
    });

    const reportContent = `
SAFEZONE ALL COWS REPORT
========================

Generated: ${new Date().toLocaleString()}
Total Cows: ${cows.length}
Total Farms: ${farms.length}

===============================

${sortedCows.map((cow, index) => {
    const farm = farms.find(f => f.farm_token === cow.farm_token);
    const farmName = farm ? farm.farm_name : 'Not Assigned';
    const timeInside = formatTime(cow.time_inside || 0);
    const timeOutside = formatTime(cow.time_outside || 0);

    return `
Cow ${index + 1}: ${cow.cow_name}${cow.cow_nickname ? ` (${cow.cow_nickname})` : ''}
--------------------------------
Farm: ${farmName}
Collar ID: ${cow.collar_id}
State: ${cow.state_fence || 'Unknown'}
Total Breaches: ${cow.total_breach || 0}
Time Inside: ${timeInside}
Time Outside: ${timeOutside}
GPS: ${cow.gps_latitude && cow.gps_longitude ? `${cow.gps_latitude}, ${cow.gps_longitude}` : 'Not available'}
Timestamp: ${new Date(cow.timestamp).toLocaleString()}

`;
}).join('\n')}

===============================
SafeZone - Near East University
    `.trim();

    const blob = new Blob([reportContent], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all_cows_report_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    window.URL.revokeObjectURL(url);

    alert('All cows report downloaded successfully!');
}
