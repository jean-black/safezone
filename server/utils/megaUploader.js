const { Storage } = require('megajs');
const fs = require('fs').promises;
const path = require('path');
const { now, formatDate } = require('./dateFormatter');
require('dotenv').config();

class MegaUploader {
    constructor() {
        this.storage = null;
        this.isAuthenticated = false;
        this.email = process.env.MEGA_EMAIL || 'modeblackmng@gmail.com';
        this.password = process.env.MEGA_PASSWORD || 'hgm$12HGM';
    }

    async authenticate() {
        if (this.isAuthenticated) {
            return true;
        }

        try {
            this.storage = await new Storage({
                email: this.email,
                password: this.password
            }).ready;
            
            this.isAuthenticated = true;
            console.log('MEGA authentication successful');
            return true;
        } catch (error) {
            console.error('MEGA authentication failed:', error);
            this.isAuthenticated = false;
            return false;
        }
    }

    async uploadFile(fileBuffer, fileName, folder = 'SafeZone') {
        try {
            await this.authenticate();
            
            if (!this.isAuthenticated) {
                throw new Error('MEGA authentication failed');
            }

            let targetFolder = this.storage.root;
            
            if (folder && folder !== 'root') {
                const folders = await this.storage.root.children;
                let folderExists = folders.find(child => 
                    child.name === folder && child.directory
                );
                
                if (!folderExists) {
                    folderExists = await this.storage.root.mkdir(folder);
                    console.log(`Created MEGA folder: ${folder}`);
                }
                
                targetFolder = folderExists;
            }

            const uploadedFile = await targetFolder.upload(fileName, fileBuffer);
            const shareLink = await uploadedFile.link();
            
            console.log(`File uploaded to MEGA: ${fileName}`);
            console.log(`Share link: ${shareLink}`);
            
            return {
                success: true,
                fileName: fileName,
                shareLink: shareLink,
                fileSize: fileBuffer.length,
                uploadDate: now()
            };
            
        } catch (error) {
            console.error('MEGA upload error:', error);
            return {
                success: false,
                error: error.message,
                fileName: fileName
            };
        }
    }

    async uploadFromFilePath(filePath, customFileName = null, folder = 'SafeZone') {
        try {
            const fileBuffer = await fs.readFile(filePath);
            const fileName = customFileName || path.basename(filePath);
            
            return await this.uploadFile(fileBuffer, fileName, folder);
        } catch (error) {
            console.error('File read error:', error);
            return {
                success: false,
                error: `Failed to read file: ${error.message}`,
                fileName: customFileName || path.basename(filePath)
            };
        }
    }

    async uploadPDFReport(pdfBuffer, reportType, reportDate) {
        const fileName = `${reportType}_${reportDate.replace(/:/g, '-')}.pdf`;
        const folder = `SafeZone/Reports/${new Date().getFullYear()}`;
        
        return await this.uploadFile(pdfBuffer, fileName, folder);
    }

    async upload24MPF(pdfBuffer, date) {
        const fileName = `24MPF_${date}.pdf`;
        const folder = `SafeZone/Daily_Reports/${new Date().getFullYear()}`;
        
        return await this.uploadFile(pdfBuffer, fileName, folder);
    }

    async uploadTableBackup(csvBuffer, tableName, timestamp) {
        const fileName = `${tableName}_backup_${timestamp.replace(/:/g, '-')}.csv`;
        const folder = `SafeZone/Database_Backups/${new Date().getFullYear()}`;
        
        return await this.uploadFile(csvBuffer, fileName, folder);
    }

    async listFiles(folderPath = 'SafeZone') {
        try {
            await this.authenticate();
            
            if (!this.isAuthenticated) {
                throw new Error('MEGA authentication failed');
            }

            let targetFolder = this.storage.root;
            
            if (folderPath && folderPath !== 'root') {
                const pathParts = folderPath.split('/');
                
                for (const part of pathParts) {
                    const children = await targetFolder.children;
                    const nextFolder = children.find(child => 
                        child.name === part && child.directory
                    );
                    
                    if (!nextFolder) {
                        throw new Error(`Folder not found: ${part}`);
                    }
                    
                    targetFolder = nextFolder;
                }
            }

            const children = await targetFolder.children;
            const files = children
                .filter(child => !child.directory)
                .map(file => ({
                    name: file.name,
                    size: file.size,
                    createdAt: new Date(file.timestamp * 1000),
                    nodeId: file.nodeId
                }))
                .sort((a, b) => b.createdAt - a.createdAt);

            return {
                success: true,
                files: files
            };
            
        } catch (error) {
            console.error('MEGA list files error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async deleteOldFiles(folderPath = 'SafeZone', daysOld = 30) {
        try {
            const filesList = await this.listFiles(folderPath);
            
            if (!filesList.success) {
                throw new Error('Failed to list files');
            }

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);

            const filesToDelete = filesList.files.filter(file => 
                file.createdAt < cutoffDate
            );

            let deletedCount = 0;
            
            for (const file of filesToDelete) {
                try {
                    await this.storage.root.children
                        .then(children => children.find(child => child.nodeId === file.nodeId))
                        .then(fileNode => {
                            if (fileNode) {
                                return fileNode.delete();
                            }
                        });
                    
                    deletedCount++;
                    console.log(`Deleted old file: ${file.name}`);
                } catch (deleteError) {
                    console.error(`Failed to delete file ${file.name}:`, deleteError);
                }
            }

            return {
                success: true,
                deletedCount: deletedCount,
                totalFiles: filesToDelete.length
            };
            
        } catch (error) {
            console.error('MEGA cleanup error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getStorageInfo() {
        try {
            await this.authenticate();
            
            if (!this.isAuthenticated) {
                throw new Error('MEGA authentication failed');
            }

            const info = await this.storage.getAccountInfo();
            
            return {
                success: true,
                totalSpace: info.spaceTotal,
                usedSpace: info.spaceUsed,
                freeSpace: info.spaceTotal - info.spaceUsed,
                email: this.email
            };
            
        } catch (error) {
            console.error('MEGA storage info error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async testConnection() {
        try {
            const authenticated = await this.authenticate();
            if (!authenticated) {
                return {
                    success: false,
                    error: 'Authentication failed'
                };
            }

            const storageInfo = await this.getStorageInfo();
            
            return {
                success: true,
                message: 'MEGA connection successful',
                storageInfo: storageInfo
            };
            
        } catch (error) {
            console.error('MEGA connection test failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async createBackupManifest(backupData) {
        const manifest = {
            backupDate: now(),
            safeZoneVersion: '1.0.0',
            files: backupData,
            totalFiles: backupData.length,
            totalSize: backupData.reduce((sum, file) => sum + (file.fileSize || 0), 0)
        };

        const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2));
        const fileName = `backup_manifest_${formatDate()}.json`;
        
        return await this.uploadFile(manifestBuffer, fileName, 'SafeZone/Manifests');
    }
}

module.exports = new MegaUploader();