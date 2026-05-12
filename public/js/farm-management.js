// Farm Management JavaScript - Table View
let farms = [];
let cows = [];
let fences = [];
let newCows = [];
let currentItem = null;
let currentType = null;

// Load all data when page loads
document.addEventListener('DOMContentLoaded', () => {
    loadFarms();
    loadCows();
    loadFences();

    // Refresh cows every 30 seconds (includes new ESP32 cows from dbt5)
    setInterval(loadCows, 30000);
});

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
            console.error('Failed to load farms');
            document.getElementById('farmsTableBody').innerHTML = '<tr><td colspan="5" class="empty-state">Failed to load farms</td></tr>';
        }
    } catch (error) {
        console.error('Error loading farms:', error);
        document.getElementById('farmsTableBody').innerHTML = '<tr><td colspan="5" class="empty-state">Error loading farms</td></tr>';
    }
}

// Load cows from API (combines dbt4, dbt5, and dbt6 via /api/cows endpoint)
async function loadCows() {
    try {
        const token = localStorage.getItem('authToken');

        // Load cows from /api/cows (handles both real and virtual cows for developers)
        const cowsResponse = await fetch('/api/cows', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        // Load dbt5 cows (new ESP32 connected)
        const dbt5Response = await fetch('/api/cows/new', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (cowsResponse.ok && dbt5Response.ok) {
            const cowsData = await cowsResponse.json();
            const dbt5Data = await dbt5Response.json();

            let allCows = cowsData.cows || [];
            const dbt5Cows = dbt5Data.newCows || [];

            // Mark dbt5 cows as new ESP32
            dbt5Cows.forEach(cow => {
                cow.isNewESP32 = true;
                cow.farm_token = null; // These are unassigned
            });

            // Mark virtual cows (already included in /api/cows for developers)
            allCows.forEach(cow => {
                if (cow.cow_type === 'virtual') {
                    cow.isVirtualCow = true;
                }
            });

            // Combine all lists
            cows = [...allCows, ...dbt5Cows];
            newCows = dbt5Cows; // Keep for compatibility

            console.log(`Total cows loaded: ${cows.length} (from /api/cows: ${allCows.length}, dbt5: ${dbt5Cows.length})`);

            renderCows();
        } else {
            console.error('Failed to load cows');
            document.getElementById('assignedCowsTableBody').innerHTML = '<tr><td colspan="5" class="empty-state">Failed to load cows</td></tr>';
            document.getElementById('unassignedCowsTableBody').innerHTML = '<tr><td colspan="5" class="empty-state">Failed to load cows</td></tr>';
        }
    } catch (error) {
        console.error('Error loading cows:', error);
        document.getElementById('assignedCowsTableBody').innerHTML = '<tr><td colspan="5" class="empty-state">Error loading cows</td></tr>';
        document.getElementById('unassignedCowsTableBody').innerHTML = '<tr><td colspan="5" class="empty-state">Error loading cows</td></tr>';
    }
}

// Load fences from API
async function loadFences() {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch('/api/farms/fences', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            fences = data.fences || [];
            renderFences();
        } else {
            console.error('Failed to load fences');
            document.getElementById('fencesTableBody').innerHTML = '<tr><td colspan="4" class="empty-state">Failed to load fences</td></tr>';
        }
    } catch (error) {
        console.error('Error loading fences:', error);
        document.getElementById('fencesTableBody').innerHTML = '<tr><td colspan="4" class="empty-state">Error loading fences</td></tr>';
    }
}


// Render farms as table
function renderFarms() {
    const tbody = document.getElementById('farmsTableBody');

    if (farms.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No farms found. Create a new farm to get started.</td></tr>';
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
                <td>
                    <div class="action-cell">
                        <button class="btn btn-primary btn-sm" onclick="openRenameFarmModal('${farm.farm_token}', '${farm.farm_name}')">Rename</button>
                        <button class="btn btn-danger btn-sm" onclick="openDeleteFarmModal('${farm.farm_token}', '${farm.farm_name}')">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Render assigned cows as table
function renderCows() {
    renderAssignedCows();
    renderUnassignedCows();
}

function renderAssignedCows() {
    const tbody = document.getElementById('assignedCowsTableBody');
    const assignedCows = cows.filter(cow => cow.farm_token && cow.farm_token !== '');

    if (assignedCows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No assigned cows yet. Assign cows from the "Unassigned Cows" section below.</td></tr>';
        return;
    }

    tbody.innerHTML = assignedCows.map(cow => {
        const farm = farms.find(f => f.farm_token === cow.farm_token);
        const farmName = farm ? farm.farm_name : 'Unknown Farm';

        // Format connection state with color
        const connectionState = cow.collar_state || 'unknown';
        const stateColor = connectionState === 'connected' ? '#10b981' : (connectionState === 'disconnected' ? '#ef4444' : '#f59e0b');
        const stateIcon = connectionState === 'connected' ? '●' : (connectionState === 'disconnected' ? '○' : '◐');

        // Format timestamps
        const formatDate = (dateStr) => dateStr ? new Date(dateStr).toLocaleString() : '-';

        return `
            <tr>
                <td><strong>${cow.cow_name}</strong></td>
                <td>${cow.cow_nickname || '-'}</td>
                <td>${farmName}</td>
                <td>${cow.collar_id}</td>
                <td><span style="color: ${stateColor};">${stateIcon} ${connectionState}</span></td>
                <td>${formatDate(cow.registered_at)}</td>
                <td>${formatDate(cow.assigned_at)}</td>
                <td>${formatDate(cow.connected_at)}</td>
                <td>${formatDate(cow.last_seen)}</td>
                <td>
                    <div class="action-cell">
                        <button class="btn btn-primary btn-sm" onclick="openRenameCowModal('${cow.collar_id}', '${cow.cow_nickname || ''}')">Nickname</button>
                        <button class="btn btn-success btn-sm" onclick="openAssignCowModal('${cow.cow_token}')">Reassign</button>
                        <button class="btn btn-danger btn-sm" onclick="openDeleteCowModal('${cow.collar_id}', '${cow.cow_name}')">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderUnassignedCows() {
    const tbody = document.getElementById('unassignedCowsTableBody');

    // Get assigned cows and create a Set of their collar_ids for fast lookup
    const assignedCows = cows.filter(cow => cow.farm_token && cow.farm_token !== '');
    const assignedCollarIds = new Set(assignedCows.map(cow => cow.collar_id));

    // Filter unassigned cows and exclude those already in assigned list
    const unassignedCows = cows.filter(cow => {
        const isUnassigned = !cow.farm_token || cow.farm_token === '';
        const notInAssigned = !assignedCollarIds.has(cow.collar_id);
        return isUnassigned && notInAssigned;
    });

    if (unassignedCows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No unassigned cows. All cows are assigned to farms.</td></tr>';
        return;
    }

    tbody.innerHTML = unassignedCows.map(cow => {
        // Create farm options dropdown
        const farmOptions = farms.map(farm =>
            `<option value="${farm.farm_token}">${farm.farm_name}</option>`
        ).join('');

        // Add badge for new ESP32 cows or virtual cows
        let badge = '';
        if (cow.isNewESP32) {
            badge = '<span style="background: #f39c12; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.75rem; margin-left: 0.5rem;">NEW ESP32</span>';
        } else if (cow.isVirtualCow) {
            badge = '<span style="background: #10b981; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.75rem; margin-left: 0.5rem;">VIRTUAL</span>';
        }

        // Format connection state with color
        const connectionState = cow.collar_state || 'unknown';
        const stateColor = connectionState === 'connected' ? '#10b981' : (connectionState === 'disconnected' ? '#ef4444' : '#f59e0b');
        const stateIcon = connectionState === 'connected' ? '●' : (connectionState === 'disconnected' ? '○' : '◐');

        // Format timestamps
        const formatDate = (dateStr) => dateStr ? new Date(dateStr).toLocaleString() : '-';

        return `
            <tr style="${cow.isNewESP32 ? 'background: #2d3a28 !important;' : ''}">
                <td><strong>${cow.cow_name}</strong>${badge}</td>
                <td>${cow.cow_nickname || '-'}</td>
                <td>${cow.collar_id}</td>
                <td><span style="color: ${stateColor};">${stateIcon} ${connectionState}</span></td>
                <td>${formatDate(cow.registered_at)}</td>
                <td>${formatDate(cow.connected_at)}</td>
                <td>${formatDate(cow.last_seen)}</td>
                <td>
                    <div class="action-cell" style="align-items: center;">
                        <select id="farmSelect_${cow.cow_token}" style="padding: 0.4rem; border: 1px solid #3a4555; border-radius: 4px; background: #2a3545; color: white; margin-right: 0.5rem;">
                            <option value="">Select Farm...</option>
                            ${farmOptions}
                        </select>
                        <button class="btn btn-success btn-sm" onclick="assignCowToFarm('${cow.cow_token}')">Assign</button>
                        <button class="btn btn-primary btn-sm" onclick="openRenameCowModal('${cow.collar_id}', '${cow.cow_nickname || ''}')">Nickname</button>
                        <button class="btn btn-danger btn-sm" onclick="openDeleteCowModal('${cow.collar_id}', '${cow.cow_name}')">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Render fences as table
function renderFences() {
    const tbody = document.getElementById('fencesTableBody');

    if (fences.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No fences found. Create fences in the Farm and Fence page.</td></tr>';
        return;
    }

    tbody.innerHTML = fences.map(fence => {
        return `
            <tr>
                <td><strong>${fence.fence_id}</strong></td>
                <td>${fence.area_size ? fence.area_size.toFixed(2) + ' m²' : 'N/A'}</td>
                <td>${new Date(fence.timestamp).toLocaleString()}</td>
                <td>
                    <div class="action-cell">
                        <button class="btn btn-primary btn-sm" onclick="openRenameFenceModal('${fence.fence_token}', '${fence.fence_id}')">Rename</button>
                        <button class="btn btn-danger btn-sm" onclick="openDeleteFenceModal('${fence.fence_token}', '${fence.fence_id}')">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Modal Functions
function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function openNewFarmModal() {
    document.getElementById('newFarmModal').style.display = 'block';
}

function openNewCowModal() {
    document.getElementById('newCowModal').style.display = 'block';
}

// Farm rename functions
function openRenameFarmModal(farmToken, currentName) {
    currentItem = farmToken;
    currentType = 'farm';
    document.getElementById('newFarmName').value = currentName;
    document.getElementById('renameFarmModal').style.display = 'block';
}

async function confirmRenameFarm() {
    const newName = document.getElementById('newFarmName').value.trim();

    if (!newName) {
        alert('Please enter a farm name');
        return;
    }

    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/farms/${currentItem}/name`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: newName })
        });

        if (response.ok) {
            alert('Farm renamed successfully!');
            closeModal('renameFarmModal');
            loadFarms();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'Failed to rename farm'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to rename farm');
    }
}

// Farm delete functions
function openDeleteFarmModal(farmToken, farmName) {
    currentItem = farmToken;
    currentType = 'farm';

    const farmCows = cows.filter(cow => cow.farm_token === farmToken);
    const message = document.getElementById('deleteFarmMessage');

    if (farmCows.length > 0) {
        message.textContent = `Farm "${farmName}" has ${farmCows.length} cow(s). What would you like to do with them?`;
        document.getElementById('transferFarmGroup').style.display = 'block';

        // Populate transfer options
        const select = document.getElementById('transferFarmSelect');
        select.innerHTML = '<option value="">Do not transfer (unassign cows)</option>';
        farms.filter(f => f.farm_token !== farmToken).forEach(farm => {
            select.innerHTML += `<option value="${farm.farm_token}">${farm.farm_name}</option>`;
        });
    } else {
        message.textContent = `Are you sure you want to delete farm "${farmName}"?`;
        document.getElementById('transferFarmGroup').style.display = 'none';
    }

    document.getElementById('deleteFarmModal').style.display = 'block';
}

async function confirmDeleteFarm() {
    const transferTo = document.getElementById('transferFarmSelect').value;

    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/farms/${currentItem}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ transferToFarmToken: transferTo || null })
        });

        if (response.ok) {
            alert('Farm deleted successfully!');
            closeModal('deleteFarmModal');
            loadFarms();
            loadCows();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'Failed to delete farm'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to delete farm');
    }
}

// Cow rename functions
function openRenameCowModal(collarId, currentNickname) {
    currentItem = collarId;
    currentType = 'cow';
    document.getElementById('newCowNickname').value = currentNickname;
    document.getElementById('renameCowModal').style.display = 'block';
}

async function confirmRenameCow() {
    const newNickname = document.getElementById('newCowNickname').value.trim();

    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/cows/${currentItem}/nickname`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ nickname: newNickname })
        });

        if (response.ok) {
            alert('Cow nickname updated successfully!');
            closeModal('renameCowModal');
            loadCows();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'Failed to update nickname'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to update nickname');
    }
}

// Direct cow assignment from dropdown
async function assignCowToFarm(cowToken) {
    const selectElement = document.getElementById(`farmSelect_${cowToken}`);
    const farmToken = selectElement.value;

    if (!farmToken) {
        alert('Please select a farm first');
        return;
    }

    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/cows/${cowToken}/assign-farm`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ farmToken: farmToken })
        });

        if (response.ok) {
            const result = await response.json();
            alert(result.message || 'Cow assigned successfully!');
            // Reload all cows (this will automatically update both tables)
            loadCows();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'Failed to assign cow'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to assign cow');
    }
}

// Cow assign functions (modal version)
function openAssignCowModal(cowToken) {
    currentItem = cowToken;
    currentType = 'assign';

    // Populate farm options
    const select = document.getElementById('assignFarmSelect');
    select.innerHTML = '<option value="">Unassign (no farm)</option>';
    farms.forEach(farm => {
        select.innerHTML += `<option value="${farm.farm_token}">${farm.farm_name}</option>`;
    });

    document.getElementById('assignCowModal').style.display = 'block';
}

async function confirmAssignCow() {
    const farmToken = document.getElementById('assignFarmSelect').value;

    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/cows/${currentItem}/assign-farm`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ farmToken: farmToken || null })
        });

        if (response.ok) {
            const result = await response.json();
            alert(result.message || 'Cow assigned successfully!');
            closeModal('assignCowModal');
            // Reload all cows (this will automatically update both tables)
            loadCows();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'Failed to assign cow'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to assign cow');
    }
}

// Cow delete functions
function openDeleteCowModal(collarId, cowName) {
    currentItem = collarId;
    currentType = 'cow';
    document.getElementById('deleteCowMessage').textContent = `Are you sure you want to delete cow "${cowName}"?`;
    document.getElementById('deleteCowModal').style.display = 'block';
}

async function confirmDeleteCow() {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/cows/${currentItem}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            alert('Cow deleted successfully!');
            closeModal('deleteCowModal');
            loadCows();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'Failed to delete cow'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to delete cow');
    }
}

// Fence rename functions
function openRenameFenceModal(fenceToken, currentName) {
    currentItem = fenceToken;
    currentType = 'fence';
    document.getElementById('newFenceName').value = currentName;
    document.getElementById('renameFenceModal').style.display = 'block';
}

async function confirmRenameFence() {
    const newName = document.getElementById('newFenceName').value.trim();

    if (!newName) {
        alert('Please enter a fence name');
        return;
    }

    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/farms/fences/${currentItem}/name`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: newName })
        });

        if (response.ok) {
            alert('Fence renamed successfully!');
            closeModal('renameFenceModal');
            loadFences();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'Failed to rename fence'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to rename fence');
    }
}

// Fence delete functions
function openDeleteFenceModal(fenceToken, fenceName) {
    currentItem = fenceToken;
    currentType = 'fence';
    document.getElementById('deleteFenceMessage').textContent = `Are you sure you want to delete fence "${fenceName}"?`;
    document.getElementById('deleteFenceModal').style.display = 'block';
}

async function confirmDeleteFence() {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/farms/fences/${currentItem}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            alert('Fence deleted successfully!');
            closeModal('deleteFenceModal');
            loadFences();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'Failed to delete fence'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to delete fence');
    }
}

// Close modals when clicking outside
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
}
