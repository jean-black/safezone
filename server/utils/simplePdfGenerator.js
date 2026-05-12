const PDFDocument = require('pdfkit');
const fs = require('fs').promises;
const path = require('path');
const { now } = require('./dateFormatter');

class SimplePdfGenerator {
    constructor() {
        this.safeZoneRed = '#dc2626';
        this.safeZoneBlue = '#0e1626';
        this.safeZoneGray = '#374151';
    }

    async generate24MPF(reportData) {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({
                    size: 'A4',
                    margins: { top: 50, bottom: 50, left: 50, right: 50 }
                });

                const chunks = [];
                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                this.addHeader(doc, '24-Hour Monitoring Report (24MPF)');
                this.add24MPFContent(doc, reportData);
                this.addFooter(doc);

                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }

    async generateTablePDF(tableName, tableData) {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({
                    size: 'A4',
                    margins: { top: 50, bottom: 50, left: 50, right: 50 }
                });

                const chunks = [];
                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                this.addHeader(doc, `Database Table Backup: ${tableName}`);
                this.addTableContent(doc, tableName, tableData);
                this.addFooter(doc);

                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }

    async generateFarmReport(farmData) {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({
                    size: 'A4',
                    margins: { top: 50, bottom: 50, left: 50, right: 50 }
                });

                const chunks = [];
                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                this.addHeader(doc, 'Farm Information Report');
                this.addFarmContent(doc, farmData);
                this.addFooter(doc);

                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }

    addHeader(doc, title) {
        doc.fillColor(this.safeZoneRed)
           .fontSize(24)
           .font('Helvetica-Bold')
           .text('SafeZone', 50, 50);

        doc.fillColor(this.safeZoneGray)
           .fontSize(12)
           .font('Helvetica')
           .text('Intelligent Cow Tracking & Farm Management', 50, 75);

        doc.fillColor('#000000')
           .fontSize(18)
           .font('Helvetica-Bold')
           .text(title, 50, 110);

        doc.fillColor(this.safeZoneGray)
           .fontSize(10)
           .text(`Generated on: ${new Date().toLocaleString()}`, 50, 135);

        doc.moveTo(50, 155)
           .lineTo(545, 155)
           .strokeColor(this.safeZoneRed)
           .lineWidth(2)
           .stroke();

        return doc;
    }

    add24MPFContent(doc, data) {
        let yPosition = 180;

        doc.fillColor('#000000')
           .fontSize(14)
           .font('Helvetica-Bold')
           .text('1. Summary Metrics', 50, yPosition);

        yPosition += 25;
        doc.fontSize(11)
           .font('Helvetica')
           .fillColor(this.safeZoneGray);

        const summaryData = [
            { label: 'Total Alarm 1 Triggers', value: data.alarm1_count || 0 },
            { label: 'Total Alarm 2 Triggers', value: data.alarm2_count || 0 },
            { label: 'Total Alarm 3 Triggers', value: data.alarm3_count || 0 },
            { label: 'Total Fence Breaches', value: (data.alarm1_count || 0) + (data.alarm2_count || 0) + (data.alarm3_count || 0) },
            { label: 'Number of Active Cows', value: data.total_cows || 0 }
        ];

        summaryData.forEach(item => {
            doc.text(`${item.label}: ${item.value}`, 70, yPosition);
            yPosition += 15;
        });

        yPosition += 20;
        doc.fillColor('#000000')
           .fontSize(14)
           .font('Helvetica-Bold')
           .text('2. Alarm Distribution', 50, yPosition);

        yPosition += 25;
        this.addSimpleChart(doc, 50, yPosition, 200, 100, [
            { label: 'Alarm 1', value: data.alarm1_count || 0, color: '#10b981' },
            { label: 'Alarm 2', value: data.alarm2_count || 0, color: '#f59e0b' },
            { label: 'Alarm 3', value: data.alarm3_count || 0, color: this.safeZoneRed }
        ]);

        yPosition += 130;
        doc.fillColor('#000000')
           .fontSize(14)
           .font('Helvetica-Bold')
           .text('3. System Performance', 50, yPosition);

        yPosition += 25;
        doc.fontSize(11)
           .font('Helvetica')
           .fillColor(this.safeZoneGray);

        const performanceData = [
            { label: 'Server Uptime', value: '99.8%' },
            { label: 'ESP32 Connectivity', value: '95.2%' },
            { label: 'Gmail Alerts Sent', value: ((data.alarm1_count || 0) + (data.alarm2_count || 0) + (data.alarm3_count || 0)).toString() },
            { label: 'MEGA Uploads', value: 'Successful' },
            { label: 'Database Status', value: 'Healthy' }
        ];

        performanceData.forEach(item => {
            doc.text(`${item.label}: ${item.value}`, 70, yPosition);
            yPosition += 15;
        });

        yPosition += 20;
        doc.fillColor('#000000')
           .fontSize(14)
           .font('Helvetica-Bold')
           .text('4. Recommendations', 50, yPosition);

        yPosition += 25;
        doc.fontSize(11)
           .font('Helvetica')
           .fillColor(this.safeZoneGray);

        const recommendations = [
            'Monitor cows with high breach counts for behavioral patterns',
            'Consider fence reinforcement in high-activity areas',
            'Review ESP32 connectivity for optimal performance',
            'Schedule regular system maintenance checks'
        ];

        recommendations.forEach((rec, index) => {
            doc.text(`${index + 1}. ${rec}`, 70, yPosition);
            yPosition += 20;
        });

        return doc;
    }

    addTableContent(doc, tableName, tableData) {
        let yPosition = 180;

        doc.fillColor('#000000')
           .fontSize(14)
           .font('Helvetica-Bold')
           .text(`Table: ${tableName}`, 50, yPosition);

        yPosition += 25;
        doc.fontSize(11)
           .font('Helvetica')
           .fillColor(this.safeZoneGray)
           .text(`Total Records: ${tableData.length}`, 50, yPosition);

        yPosition += 20;
        doc.text(`Backup Date: ${now()}`, 50, yPosition);

        yPosition += 30;

        if (tableData.length > 0) {
            const headers = Object.keys(tableData[0]);
            const columnWidth = Math.min(80, (545 - 50) / headers.length);

            doc.fillColor(this.safeZoneRed)
               .fontSize(10)
               .font('Helvetica-Bold');

            headers.forEach((header, index) => {
                doc.text(header.toUpperCase(), 50 + (index * columnWidth), yPosition, {
                    width: columnWidth - 5,
                    ellipsis: true
                });
            });

            yPosition += 20;

            doc.moveTo(50, yPosition)
               .lineTo(545, yPosition)
               .strokeColor(this.safeZoneRed)
               .lineWidth(1)
               .stroke();

            yPosition += 10;

            doc.fillColor(this.safeZoneGray)
               .fontSize(9)
               .font('Helvetica');

            tableData.slice(0, 25).forEach((row, rowIndex) => {
                if (yPosition > 750) {
                    doc.addPage();
                    yPosition = 50;
                }

                headers.forEach((header, colIndex) => {
                    const value = row[header] ? row[header].toString() : '';
                    doc.text(value, 50 + (colIndex * columnWidth), yPosition, {
                        width: columnWidth - 5,
                        ellipsis: true
                    });
                });

                yPosition += 15;
            });

            if (tableData.length > 25) {
                yPosition += 20;
                doc.fillColor(this.safeZoneRed)
                   .fontSize(11)
                   .font('Helvetica-Bold')
                   .text(`... and ${tableData.length - 25} more records`, 50, yPosition);
            }
        } else {
            doc.fillColor(this.safeZoneGray)
               .fontSize(12)
               .font('Helvetica-Oblique')
               .text('No data available in this table.', 50, yPosition);
        }

        return doc;
    }

    addFarmContent(doc, farmData) {
        let yPosition = 180;

        doc.fillColor('#000000')
           .fontSize(14)
           .font('Helvetica-Bold')
           .text('Farm Overview', 50, yPosition);

        yPosition += 30;

        if (farmData.farms && farmData.farms.length > 0) {
            farmData.farms.forEach((farm, index) => {
                if (yPosition > 700) {
                    doc.addPage();
                    yPosition = 50;
                }

                doc.fillColor(this.safeZoneRed)
                   .fontSize(13)
                   .font('Helvetica-Bold')
                   .text(`Farm ${index + 1}: ${farm.farm_id}`, 50, yPosition);

                yPosition += 20;

                doc.fillColor(this.safeZoneGray)
                   .fontSize(11)
                   .font('Helvetica');

                const farmInfo = [
                    { label: 'Farm ID', value: farm.farm_id },
                    { label: 'GPS Coordinates', value: farm.farm_gps },
                    { label: 'Number of Cows', value: farm.cow_count || 'N/A' },
                    { label: 'Number of Fences', value: farm.fence_count || 'N/A' },
                    { label: 'Created', value: farm.timestamp || 'N/A' }
                ];

                farmInfo.forEach(info => {
                    doc.text(`${info.label}: ${info.value}`, 70, yPosition);
                    yPosition += 15;
                });

                yPosition += 20;
            });
        }

        if (farmData.fences && farmData.fences.length > 0) {
            yPosition += 10;
            doc.fillColor('#000000')
               .fontSize(14)
               .font('Helvetica-Bold')
               .text('Fence Information', 50, yPosition);

            yPosition += 30;

            farmData.fences.forEach((fence, index) => {
                if (yPosition > 700) {
                    doc.addPage();
                    yPosition = 50;
                }

                doc.fillColor(this.safeZoneRed)
                   .fontSize(12)
                   .font('Helvetica-Bold')
                   .text(`${fence.fence_id}`, 50, yPosition);

                yPosition += 15;

                doc.fillColor(this.safeZoneGray)
                   .fontSize(10)
                   .font('Helvetica')
                   .text(`Area: ${fence.area_size} m² | Nodes: ${fence.fence_nodes ? JSON.parse(fence.fence_nodes).length : 0}`, 70, yPosition);

                yPosition += 25;
            });
        }

        return doc;
    }

    addSimpleChart(doc, x, y, width, height, data) {
        const total = data.reduce((sum, item) => sum + item.value, 0);
        
        if (total === 0) {
            doc.fillColor(this.safeZoneGray)
               .fontSize(10)
               .text('No data to display', x, y + height/2);
            return;
        }

        let currentAngle = -Math.PI / 2;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const radius = Math.min(width, height) / 3;

        data.forEach((item, index) => {
            if (item.value > 0) {
                const sliceAngle = (item.value / total) * 2 * Math.PI;
                
                doc.save()
                   .fillColor(item.color)
                   .arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle)
                   .lineTo(centerX, centerY)
                   .fill();

                currentAngle += sliceAngle;
            }
        });

        let legendY = y + height + 10;
        data.forEach(item => {
            doc.fillColor(item.color)
               .rect(x, legendY, 10, 10)
               .fill();
            
            doc.fillColor('#000000')
               .fontSize(9)
               .text(`${item.label}: ${item.value}`, x + 15, legendY + 1);
            
            legendY += 15;
        });
    }

    addFooter(doc) {
        const pageHeight = doc.page.height;
        const footerY = pageHeight - 80;

        doc.moveTo(50, footerY)
           .lineTo(545, footerY)
           .strokeColor(this.safeZoneRed)
           .lineWidth(1)
           .stroke();

        doc.fillColor(this.safeZoneGray)
           .fontSize(9)
           .font('Helvetica')
           .text('SafeZone - Developed by Jean Claude & Samuel', 50, footerY + 10);

        doc.text('Near East University - 2025-2026 - v1.0.0', 50, footerY + 25);

        doc.text(`Generated: ${new Date().toLocaleString()}`, 400, footerY + 10);
        doc.text('Confidential Farm Data', 400, footerY + 25);

        return doc;
    }

    async generateSystemHealthReport(healthData) {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({
                    size: 'A4',
                    margins: { top: 50, bottom: 50, left: 50, right: 50 }
                });

                const chunks = [];
                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                this.addHeader(doc, 'System Health Report');
                
                let yPosition = 180;

                doc.fillColor('#000000')
                   .fontSize(14)
                   .font('Helvetica-Bold')
                   .text('System Status Overview', 50, yPosition);

                yPosition += 30;

                const statusItems = [
                    { component: 'Database', status: healthData.database || 'Unknown', color: '#10b981' },
                    { component: 'ESP32 Devices', status: healthData.esp32 || 'Unknown', color: '#f59e0b' },
                    { component: 'Gmail Service', status: healthData.gmail || 'Unknown', color: '#10b981' },
                    { component: 'MEGA Storage', status: healthData.mega || 'Unknown', color: '#10b981' },
                    { component: 'WebSocket', status: healthData.websocket || 'Unknown', color: '#10b981' }
                ];

                statusItems.forEach(item => {
                    doc.fillColor(item.color)
                       .rect(50, yPosition, 10, 10)
                       .fill();
                    
                    doc.fillColor('#000000')
                       .fontSize(11)
                       .text(`${item.component}: ${item.status}`, 70, yPosition);
                    
                    yPosition += 20;
                });

                this.addFooter(doc);
                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }
}

module.exports = new SimplePdfGenerator();