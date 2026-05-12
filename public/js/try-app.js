// Histogram1 Visualization - Vertical Waveform Style
class Histogram1 {
    constructor(canvasId, backgroundColor = '#000000') {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        this.backgroundColor = backgroundColor;

        // Margins for axes
        this.margin = { top: 30, right: 10, bottom: 90, left: 60 };
        this.plotWidth = this.width - this.margin.left - this.margin.right;
        this.plotHeight = this.height - this.margin.top - this.margin.bottom;

        // Data structure matching dbt9 columns
        this.data = {
            day: {
                farmTokens: [],      // column 1
                timestamps: [],       // column 2
                breachCounts: []      // column 3
            },
            hour: {
                farmTokens: [],      // column 4
                timestamps: [],       // column 5
                breachCounts: []      // column 6
            },
            minute: {
                farmTokens: [],      // column 7
                timestamps: [],       // column 8
                breachCounts: []      // column 9
            }
        };

        // Current hour tracking (for dynamic accumulation)
        this.currentHourStartTime = Date.now();
        this.currentHourAccumulation = 0;
        this.currentHourLabel = this.formatCurrentTime(this.currentHourStartTime);

        // Initialize with empty data (7 days, 24 hours, 60 minutes)
        this.initializeData();
        this.draw();
    }

    formatCurrentTime(timestamp) {
        const date = new Date(timestamp);
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return hours + ':' + minutes;
    }

    initializeData() {
        // Day: 7 points
        for (let i = 0; i < 7; i++) {
            this.data.day.farmTokens.push([]);
            this.data.day.timestamps.push(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
            this.data.day.breachCounts.push(0);
        }

        // Hour: 24 points
        for (let i = 0; i < 24; i++) {
            this.data.hour.farmTokens.push([]);
            this.data.hour.timestamps.push(Date.now() - (23 - i) * 60 * 60 * 1000);
            this.data.hour.breachCounts.push(0);
        }

        // Minute: Start with just a few initial points (will accumulate over time)
        for (let i = 0; i < 10; i++) {
            this.data.minute.farmTokens.push([]);
            this.data.minute.timestamps.push(Date.now() - (9 - i) * 60 * 1000);
            this.data.minute.breachCounts.push(0);
        }
    }

    draw() {
        // Clear canvas
        this.ctx.fillStyle = this.backgroundColor;
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Draw axes
        this.drawAxes();

        // Draw the three sections
        this.drawSection('day', 0, 7);
        this.drawSection('hour', 7, 24);
        this.drawSection('minute', 24, 60);

        // Draw labels
        this.drawLabels();
    }

    drawAxes() {
        this.ctx.strokeStyle = '#ff0000';
        this.ctx.lineWidth = 2;

        // Y-axis
        this.ctx.beginPath();
        this.ctx.moveTo(this.margin.left, this.margin.top);
        this.ctx.lineTo(this.margin.left, this.height - this.margin.bottom);
        this.ctx.stroke();

        // X-axis (extended to full width)
        this.ctx.beginPath();
        this.ctx.moveTo(this.margin.left, this.height - this.margin.bottom);
        this.ctx.lineTo(this.width, this.height - this.margin.bottom);
        this.ctx.stroke();
    }

    drawSection(section, startIndex, numPoints) {
        const sectionData = this.data[section].breachCounts;
        const sectionTimestamps = this.data[section].timestamps;

        // For hour section: include current hour block if accumulation > 0
        let includeCurrentHour = false;
        if (section === 'hour' && this.currentHourAccumulation > 0) {
            includeCurrentHour = true;
        }

        // For day/hour: count only non-zero breaches, for minute: use all data length
        let actualPoints;
        if (section === 'day') {
            actualPoints = sectionData.filter(count => count > 0).length;
        } else if (section === 'hour') {
            actualPoints = sectionData.filter(count => count > 0).length;
            if (includeCurrentHour) actualPoints += 1; // Add current hour block
        } else { // minute
            actualPoints = sectionData.length;
        }

        // If no data points, skip drawing this section
        if (actualPoints === 0) {
            return;
        }

        // Count actual points for all sections to calculate proportions
        const dayPoints = this.data.day.breachCounts.filter(count => count > 0).length;
        let hourPoints = this.data.hour.breachCounts.filter(count => count > 0).length;
        if (includeCurrentHour) hourPoints += 1; // Include current hour in calculation
        const minutePoints = this.data.minute.breachCounts.length;
        const totalActualPoints = dayPoints + hourPoints + minutePoints;

        // Calculate section width based on actual non-zero points (no gaps between sections)
        const sectionWidth = this.plotWidth * (actualPoints / totalActualPoints);
        const pointSpacing = sectionWidth / actualPoints;

        // Starting X position for this section (stocked together, no gaps)
        let startX = this.margin.left;
        if (section === 'hour') {
            startX += this.plotWidth * (dayPoints / totalActualPoints);
        } else if (section === 'minute') {
            startX += this.plotWidth * ((dayPoints + hourPoints) / totalActualPoints);
        }

        // Find max value for auto-scaling
        const maxValue = this.getMaxValue();
        const scale = maxValue > 0 ? this.plotHeight / maxValue : 1;

        if (sectionData.length > 0) {
            // Day and Hour sections: draw as rectangles
            if (section === 'day' || section === 'hour') {
                // Set color based on section
                if (section === 'day') {
                    this.ctx.fillStyle = 'rgba(255, 0, 0, 0.5)'; // Red transparent
                } else {
                    this.ctx.fillStyle = 'rgba(128, 128, 128, 0.5)'; // Grey transparent
                }

                // Draw rectangles only for breaches > 0
                let barIndex = 0; // Separate index for positioning non-zero bars
                for (let i = 0; i < sectionData.length; i++) {
                    if (sectionData[i] > 0) {
                        const barWidth = pointSpacing * 0.8; // 80% of spacing for gap between bars
                        const x = startX + (barIndex * pointSpacing) + (pointSpacing * 0.1);
                        const barHeight = sectionData[i] * scale;
                        const y = this.height - this.margin.bottom - barHeight;

                        this.ctx.fillRect(x, y, barWidth, barHeight);
                        barIndex++;
                    }
                }

                // Draw current hour block (dynamic) for hour section
                if (section === 'hour' && includeCurrentHour) {
                    const barWidth = pointSpacing * 0.8;
                    const x = startX + (barIndex * pointSpacing) + (pointSpacing * 0.1);
                    const barHeight = this.currentHourAccumulation * scale;
                    const y = this.height - this.margin.bottom - barHeight;

                    this.ctx.fillRect(x, y, barWidth, barHeight);
                }

                // Draw white dots and horizontal breach numbers for events (breaches > 0)
                this.ctx.fillStyle = '#ffffff';
                this.ctx.font = '10px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'bottom';

                let dotIndex = 0; // Separate index for positioning dots
                for (let i = 0; i < sectionData.length; i++) {
                    if (sectionData[i] > 0) {
                        const x = startX + (dotIndex * pointSpacing) + (pointSpacing / 2);
                        const y = this.height - this.margin.bottom - (sectionData[i] * scale);

                        // Draw white dot
                        this.ctx.beginPath();
                        this.ctx.arc(x, y, 4, 0, Math.PI * 2);
                        this.ctx.fill();

                        // Draw breach number horizontally above the dot
                        this.ctx.fillText(sectionData[i].toString(), x, y - 8);
                        dotIndex++;
                    }
                }

                // Draw dot and number for current hour block (dynamic)
                if (section === 'hour' && includeCurrentHour) {
                    const x = startX + (dotIndex * pointSpacing) + (pointSpacing / 2);
                    const y = this.height - this.margin.bottom - (this.currentHourAccumulation * scale);

                    // Draw white dot
                    this.ctx.beginPath();
                    this.ctx.arc(x, y, 4, 0, Math.PI * 2);
                    this.ctx.fill();

                    // Draw breach number horizontally above the dot
                    this.ctx.fillText(this.currentHourAccumulation.toString(), x, y - 8);
                }

                // Draw vertical timestamp labels below x-axis
                this.ctx.save();
                this.ctx.font = '9px Arial';
                this.ctx.textAlign = 'left';
                this.ctx.textBaseline = 'middle';

                // Set label color based on section
                if (section === 'day') {
                    this.ctx.fillStyle = '#ff0000'; // Red for day
                } else {
                    this.ctx.fillStyle = '#808080'; // Grey for hour
                }

                let labelIndex = 0; // Separate index for positioning labels
                for (let i = 0; i < sectionData.length; i++) {
                    if (sectionData[i] > 0) {
                        const x = startX + (labelIndex * pointSpacing) + (pointSpacing / 2);
                        const baseY = this.height - this.margin.bottom + 10;

                        // Format timestamp
                        const date = new Date(sectionTimestamps[i]);
                        let label = '';

                        if (section === 'day') {
                            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                                          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                            label = months[date.getMonth()] + ' ' + date.getDate();
                        } else if (section === 'hour') {
                            // Completed hour blocks: show only "HH:00" format
                            const hours = date.getHours().toString().padStart(2, '0');
                            label = hours + ':00';
                        }

                        // Draw vertical text
                        this.ctx.translate(x, baseY);
                        this.ctx.rotate(Math.PI / 2);
                        this.ctx.fillText(label, 0, 0);
                        this.ctx.rotate(-Math.PI / 2);
                        this.ctx.translate(-x, -baseY);
                        labelIndex++;
                    }
                }

                // Draw dynamic label for current hour block
                if (section === 'hour' && includeCurrentHour) {
                    const x = startX + (labelIndex * pointSpacing) + (pointSpacing / 2);
                    const baseY = this.height - this.margin.bottom + 10;

                    // Use the dynamic current hour label (updates in real-time)
                    const label = this.currentHourLabel;

                    // Draw vertical text
                    this.ctx.translate(x, baseY);
                    this.ctx.rotate(Math.PI / 2);
                    this.ctx.fillText(label, 0, 0);
                    this.ctx.rotate(-Math.PI / 2);
                    this.ctx.translate(-x, -baseY);
                }

                this.ctx.restore();
            }
            // Minute section: draw as smooth curve
            else if (section === 'minute') {
                this.ctx.strokeStyle = '#ffff00'; // Yellow line
                this.ctx.lineWidth = 2;

                // Draw line connecting ALL points (including zeros)
                this.ctx.beginPath();
                for (let i = 0; i < sectionData.length; i++) {
                    const x = startX + (i * pointSpacing) + (pointSpacing / 2);
                    const y = this.height - this.margin.bottom - (sectionData[i] * scale);

                    if (i === 0) {
                        this.ctx.moveTo(x, y);
                    } else {
                        this.ctx.lineTo(x, y);
                    }
                }
                this.ctx.stroke();

                // Draw white dots and horizontal breach numbers ONLY for breaches > 0
                this.ctx.fillStyle = '#ffffff';
                this.ctx.font = '10px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'bottom';

                for (let i = 0; i < sectionData.length; i++) {
                    if (sectionData[i] > 0) {
                        const x = startX + (i * pointSpacing) + (pointSpacing / 2);
                        const y = this.height - this.margin.bottom - (sectionData[i] * scale);

                        // Draw white dot
                        this.ctx.beginPath();
                        this.ctx.arc(x, y, 4, 0, Math.PI * 2);
                        this.ctx.fill();

                        // Draw breach number horizontally above the dot
                        this.ctx.fillText(sectionData[i].toString(), x, y - 8);
                    }
                }

                // Draw vertical timestamp labels below x-axis for ALL points
                this.ctx.save();
                this.ctx.font = '9px Arial';
                this.ctx.fillStyle = '#ffff00'; // Yellow for minute
                this.ctx.textAlign = 'left';
                this.ctx.textBaseline = 'middle';

                for (let i = 0; i < sectionData.length; i++) {
                    const x = startX + (i * pointSpacing) + (pointSpacing / 2);
                    const baseY = this.height - this.margin.bottom + 10;

                    // Format timestamp
                    const date = new Date(sectionTimestamps[i]);
                    const hours = date.getHours().toString().padStart(2, '0');
                    const minutes = date.getMinutes().toString().padStart(2, '0');
                    const label = hours + ':' + minutes;

                    // Draw vertical text
                    this.ctx.translate(x, baseY);
                    this.ctx.rotate(Math.PI / 2);
                    this.ctx.fillText(label, 0, 0);
                    this.ctx.rotate(-Math.PI / 2);
                    this.ctx.translate(-x, -baseY);
                }
                this.ctx.restore();
            }
        }
    }

    drawLabels() {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'center';

        // Section labels (moved below timestamp labels to avoid collision)
        const dayPoints = this.data.day.breachCounts.filter(count => count > 0).length;
        const hourPoints = this.data.hour.breachCounts.filter(count => count > 0).length;
        const minutePoints = this.data.minute.breachCounts.length;
        const totalActualPoints = dayPoints + hourPoints + minutePoints;

        if (totalActualPoints === 0) return; // Don't draw labels if no data

        const dayWidth = this.plotWidth * (dayPoints / totalActualPoints);
        const hourWidth = this.plotWidth * (hourPoints / totalActualPoints);
        const minuteWidth = this.plotWidth * (minutePoints / totalActualPoints);

        // Day label (only if day section has data)
        if (dayPoints > 0) {
            this.ctx.fillText('DAY', this.margin.left + dayWidth / 2, this.height - this.margin.bottom + 70);
        }

        // Hour label (only if hour section has data)
        if (hourPoints > 0) {
            this.ctx.fillText('HOUR', this.margin.left + dayWidth + hourWidth / 2, this.height - this.margin.bottom + 70);
        }

        // Minute label (only if minute section has data)
        if (minutePoints > 0) {
            this.ctx.fillText('MINUTE', this.margin.left + dayWidth + hourWidth + minuteWidth / 2, this.height - this.margin.bottom + 70);
        }

        // Y-axis label
        this.ctx.save();
        this.ctx.translate(15, this.margin.top + this.plotHeight / 2);
        this.ctx.rotate(-Math.PI / 2);
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Breach Count', 0, 0);
        this.ctx.restore();

        // Title
        this.ctx.font = '14px Arial';
        this.ctx.fillText('Breach Timeline - All Farms Combined', this.width / 2, 20);
    }

    getMaxValue() {
        const allValues = [
            ...this.data.day.breachCounts,
            ...this.data.hour.breachCounts,
            ...this.data.minute.breachCounts,
            this.currentHourAccumulation
        ];
        return Math.max(...allValues, 10); // Minimum scale of 10
    }

    getTotalBreaches() {
        const allValues = [
            ...this.data.day.breachCounts,
            ...this.data.hour.breachCounts,
            ...this.data.minute.breachCounts
        ];
        const total = allValues.reduce((sum, val) => sum + val, 0);
        // Add current hour accumulation
        return total + this.currentHourAccumulation;
    }

    addBreach(section = 'minute') {
        // Add a random breach to the most recent data point or add new point
        const randomBreach = Math.floor(Math.random() * 10) + 1;

        if (section === 'day') {
            // Day section: FIFO - rolling 7-day window
            this.data.day.breachCounts.push(randomBreach);
            this.data.day.farmTokens.push([]);
            this.data.day.timestamps.push(Date.now());

            // If more than 7 elements, remove the first one
            if (this.data.day.breachCounts.length > 7) {
                this.data.day.breachCounts.shift();
                this.data.day.farmTokens.shift();
                this.data.day.timestamps.shift();
            }
        } else {
            // Hour/Minute: add to existing last point
            const lastIndex = this.data[section].breachCounts.length - 1;
            this.data[section].breachCounts[lastIndex] += randomBreach;
        }

        this.updateStats();
        this.draw();
    }

    simulateRealTimeData() {
        const currentTime = Date.now();
        const currentDate = new Date(currentTime);
        const startDate = new Date(this.currentHourStartTime);

        // Check if we've crossed into a new hour
        if (currentDate.getHours() !== startDate.getHours() ||
            currentDate.getDate() !== startDate.getDate()) {
            // New hour started - finalize the old hour block
            if (this.currentHourAccumulation > 0) {
                // Add completed hour to hour section
                this.data.hour.breachCounts.push(this.currentHourAccumulation);
                this.data.hour.farmTokens.push([]);
                this.data.hour.timestamps.push(this.currentHourStartTime);
            }

            // Reset for new hour cycle
            this.currentHourStartTime = currentTime;
            this.currentHourAccumulation = 0;
        }

        // Simulate minute updates with FIFO (keep only 10 most recent signals)
        const newBreach = Math.random() < 0.3 ? Math.floor(Math.random() * 8) + 1 : 0;
        this.data.minute.breachCounts.push(newBreach);
        this.data.minute.farmTokens.push([]);
        this.data.minute.timestamps.push(currentTime);

        // Accumulate to current hour (from the beginning of hour cycle)
        this.currentHourAccumulation += newBreach;

        // Update dynamic label to current time
        this.currentHourLabel = this.formatCurrentTime(currentTime);

        // FIFO: If more than 10 elements, remove the first one
        if (this.data.minute.breachCounts.length > 10) {
            this.data.minute.breachCounts.shift();
            this.data.minute.farmTokens.shift();
            this.data.minute.timestamps.shift();
        }

        this.updateStats();
        this.draw();
    }

    clearData() {
        // Day section uses FIFO, so just reset to zeros (keep length)
        this.data.day.breachCounts.fill(0);

        // Hour and Minute: one-time clearing (empty the arrays completely)
        this.data.hour.breachCounts = [];
        this.data.hour.farmTokens = [];
        this.data.hour.timestamps = [];

        this.data.minute.breachCounts = [];
        this.data.minute.farmTokens = [];
        this.data.minute.timestamps = [];

        // Reset current hour tracking
        this.currentHourStartTime = Date.now();
        this.currentHourAccumulation = 0;
        this.currentHourLabel = this.formatCurrentTime(this.currentHourStartTime);

        // Reinitialize with starting points
        for (let i = 0; i < 24; i++) {
            this.data.hour.farmTokens.push([]);
            this.data.hour.timestamps.push(Date.now() - (23 - i) * 60 * 60 * 1000);
            this.data.hour.breachCounts.push(0);
        }

        for (let i = 0; i < 10; i++) {
            this.data.minute.farmTokens.push([]);
            this.data.minute.timestamps.push(Date.now() - (9 - i) * 60 * 1000);
            this.data.minute.breachCounts.push(0);
        }

        this.updateStats();
        this.draw();
    }

    updateStats() {
        const total = this.getTotalBreaches();
        const max = this.getMaxValue();
        document.getElementById('statsDisplay').textContent =
            `Total Breaches: ${total} | Max Value: ${max}`;
    }
}

// Initialize histogram
let histogram;
let simulationInterval;

document.addEventListener('DOMContentLoaded', function() {
    histogram = new Histogram1('histogramCanvas');

    // Add full sample data for visualization (showing histogram at fullest state)
    // Day section: 7 blocks all with data
    histogram.data.day.breachCounts = [2, 5, 3, 8, 4, 6, 7];

    // Hour section: 23 completed hour blocks with data
    histogram.data.hour.breachCounts = [1, 2, 1, 3, 5, 4, 2, 1, 2, 3, 4, 2, 1, 2, 3, 6, 8, 5, 3, 2, 4, 3, 2];

    // Current hour block (dynamic - will show as 24th block with current time label)
    histogram.currentHourAccumulation = 15; // Sample: 15 breaches accumulated in current hour so far
    histogram.currentHourLabel = histogram.formatCurrentTime(Date.now());

    // Minute section: 10 blocks all with data (FIFO keeps only 10 most recent)
    histogram.data.minute.breachCounts = [1, 2, 3, 4, 5, 6, 4, 3, 2, 5];
    histogram.updateStats();
    histogram.draw();

    // Button handlers
    document.getElementById('startSimBtn').addEventListener('click', function() {
        if (simulationInterval) {
            clearInterval(simulationInterval);
            simulationInterval = null;
            this.textContent = 'Start Simulation';
        } else {
            simulationInterval = setInterval(() => {
                histogram.simulateRealTimeData();
            }, 1000);
            this.textContent = 'Stop Simulation';
        }
    });

    document.getElementById('addBreachBtn').addEventListener('click', function() {
        histogram.addBreach('minute');
    });

    document.getElementById('clearDataBtn').addEventListener('click', function() {
        if (confirm('Clear all histogram data?')) {
            histogram.clearData();
        }
    });

    document.getElementById('resetViewBtn').addEventListener('click', function() {
        histogram.draw();
    });
});
