/**
 * CodeEditorManager - Code editor management module
 * Responsible for complete code editor functionality: open, close, save, reload, etc.
 */
import { CodeEditor } from '../editor/CodeEditor.js';
import { readFileContent } from '../utils/FileUtils.js';

export class CodeEditorManager {
    constructor() {
        this.codeEditorInstance = null;
        this.editorState = {
            currentFile: null,
            currentContent: '',
            originalContent: '',
            defaultFileName: 'newfile.xml',
            defaultFileType: 'urdf' // urdf, mjcf, usd
        };
        this.onReload = null; // Reload callback
        this.fileMap = null; // File map reference
    }

    /**
     * Initialize editor
     */
    init(fileMap) {
        this.fileMap = fileMap;

        const editorWrapper = document.getElementById('code-editor-wrapper');
        if (!editorWrapper) {
            return;
        }

        this.codeEditorInstance = new CodeEditor(editorWrapper);

        // Listen for content changes
        this.codeEditorInstance.onChange((content) => {
            this.editorState.currentContent = content;
            this.updateEditorSaveStatus();
        });

        this.setupEditorControls();

        // Update save status on initialization (show "unsaved")
        this.updateEditorSaveStatus();

        // Initialize filename input and type selector
        this.setupFileControls();
    }

    /**
     * Setup filename input
     */
    setupFileControls() {
        const filenameInput = document.getElementById('editor-filename-input');
        const filenameDisplay = document.getElementById('editor-filename');

        if (!filenameInput || !filenameDisplay) return;

        // Show/hide controls based on file state
        const updateControlsVisibility = () => {
            if (this.editorState.currentFile) {
                // When file exists, hide input, show filename
                filenameInput.style.display = 'none';
                filenameDisplay.style.display = 'inline-block';
            } else {
                // When no file, show input, hide filename
                filenameInput.style.display = 'inline-block';
                filenameDisplay.style.display = 'none';
                filenameInput.value = this.editorState.defaultFileName;
            }
        };

        // Initialize display state
        updateControlsVisibility();

        // Listen for filename input
        filenameInput.addEventListener('input', (e) => {
            this.editorState.defaultFileName = e.target.value.trim() || 'newfile.xml';
        });

        // Store update function for later use
        this.updateControlsVisibility = updateControlsVisibility;
    }

    /**
     * Infer file type from filename extension
     */
    detectFileTypeFromName(fileName) {
        const ext = fileName.toLowerCase().split('.').pop();

        // Supported extension mapping
        const extensionMap = {
            'xml': 'urdf',  // Default XML files treated as URDF (may also be MJCF, but loader will auto-detect)
            'urdf': 'urdf',
            'xacro': 'xacro',
            'mjcf': 'mjcf',
            'usd': 'usd',
            'usda': 'usd',
            'usdc': 'usd',
            'usdz': 'usd'
        };

        return extensionMap[ext] || 'urdf';
    }

    /**
     * Setup editor control buttons
     */
    setupEditorControls() {
        const openEditorBtn = document.getElementById('open-editor-btn');
        const editorPanel = document.getElementById('code-editor-panel');
        const closeEditorBtn = document.getElementById('close-editor-btn');
        const saveBtn = document.getElementById('save-btn');
        const reloadBtn = document.getElementById('reload-btn');

        if (!openEditorBtn || !editorPanel) return;

        // Show editor by default
        editorPanel.classList.add('visible');
        openEditorBtn.classList.add('active');

        // Open/close editor
        openEditorBtn.addEventListener('click', async () => {
            if (editorPanel.classList.contains('visible')) {
                // Directly toggle visibility, no need to show unsaved prompt
                editorPanel.classList.remove('visible');
                openEditorBtn.classList.remove('active');
                return;
            }

            editorPanel.classList.add('visible');
            openEditorBtn.classList.add('active');

            if (!this.editorState.currentFile) {
                this.codeEditorInstance.setValue('');
                document.getElementById('editor-filename').textContent = window.i18n.t('newFile');
                this.updateEditorSaveStatus();
            }
        });

        // Close editor
        if (closeEditorBtn) {
            closeEditorBtn.addEventListener('click', () => {
                // Directly toggle visibility, no need to show unsaved prompt
                editorPanel.classList.remove('visible');
                openEditorBtn.classList.remove('active');
            });
        }

        // Note: Maximize button logic moved to PanelManager.js for unified management

        // Reload - reload model using current editor content (without saving)
        if (reloadBtn) {
            reloadBtn.addEventListener('click', async () => {
                try {
                    // Get current editor content
                    const newContent = this.codeEditorInstance.getValue();

                    // Check if content is empty
                    if (!newContent || newContent.trim().length === 0) {
                        return;
                    }

                    // Determine filename and type
                    let fileName, fileType;
                    if (this.editorState.currentFile) {
                        // If file is open, use its filename
                        fileName = this.editorState.currentFile.name;
                        fileType = this.editorState.currentFile.type;
                    } else {
                        // If no file, get filename from input, infer type from extension
                        const filenameInput = document.getElementById('editor-filename-input');

                        if (filenameInput) {
                            fileName = filenameInput.value.trim() || this.editorState.defaultFileName;
                        } else {
                            fileName = this.editorState.defaultFileName;
                        }

                        // Infer type from filename extension
                        fileType = this.detectFileTypeFromName(fileName);
                    }

                    // Create temporary file
                    const blob = new Blob([newContent], { type: 'text/plain' });
                    const newFile = new File([blob], fileName, {
                        type: fileType
                    });

                    // If has current file, update file map (temporary)
                    if (this.editorState.currentFile) {
                        // Collect keys to update
                        const keysToUpdate = [];
                        for (const [key] of this.fileMap.entries()) {
                            if (key.endsWith(fileName) || key === fileName) {
                                keysToUpdate.push(key);
                            }
                        }

                        // Only update existing keys (don't add new keys)
                        keysToUpdate.forEach(key => {
                            this.fileMap.set(key, newFile);
                        });
                    } else {
                        // If new file, add to fileMap
                        this.fileMap.set(fileName, newFile);
                    }

                    // Save current editor content to prevent being overwritten by loadFile
                    const savedEditorContent = newContent;

                    // Temporarily disable editor auto-loading in loadFile
                    this._reloadingInProgress = true;

                    // Call reload callback (pass flag indicating this is a reload)
                    if (this.onReload) {
                        await this.onReload(newFile, true); // true means this is a reload
                    }

                    // Don't modify editor content on reload to avoid focus loss
                    // Content is already user-edited content, no need to reset
                    this.editorState.currentContent = savedEditorContent;

                    // If loaded from blank state, update currentFile
                    if (!this.editorState.currentFile) {
                        this.editorState.currentFile = newFile;
                        const filenameEl = document.getElementById('editor-filename');
                        if (filenameEl) {
                            filenameEl.textContent = fileName;
                        }
                        // Update control visibility
                        if (this.updateControlsVisibility) {
                            this.updateControlsVisibility();
                        }
                    }

                    // Note: Don't update originalContent, keep original content unchanged
                    // This allows user to continue editing, still showing "unsaved" state

                    this._reloadingInProgress = false;

                } catch (error) {
                    this._reloadingInProgress = false;
                    console.error(`${window.i18n.t('reloadFailed')}: ${error.message}`);
                }
            });
        }

        // Download button - directly download current content
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                if (!this.editorState.currentFile) {
                    // Don't show prompt when no file
                    return;
                }

                // Directly download (regardless of whether modified)
                await this.performSave();
            });
        }

    }

    /**
     * Load file into editor
     */
    async loadFile(file, skipIfReloading = true) {
        if (!file || !this.codeEditorInstance) return;

        // If reloading in progress, skip (avoid overwriting editor content)
        if (skipIfReloading && this._reloadingInProgress) {
            return;
        }

        try {
            const content = await readFileContent(file);

            // Save file reference and original content
            this.editorState.currentFile = file;
            this.editorState.originalContent = content;
            this.editorState.currentContent = content;

            // Display file content
            this.codeEditorInstance.setValue(content);
            const filenameEl = document.getElementById('editor-filename');
            if (filenameEl) {
                filenameEl.textContent = file.name;
            }

            // Update control visibility
            if (this.updateControlsVisibility) {
                this.updateControlsVisibility();
            }

            // Delay updating save status to ensure setup is complete
            setTimeout(() => {
                // Force set to saved state
                const saveStatus = document.getElementById('editor-save-status');
                if (saveStatus) {
                    saveStatus.textContent = window.i18n.t('saved');
                    saveStatus.className = 'code-editor-save-status saved';
                }
            }, 100);

        } catch (error) {
            console.error(`${window.i18n.t('loadFailed')}: ${error.message}`);
        }
    }

    /**
     * Update editor save status
     */
    updateEditorSaveStatus() {
        const saveStatus = document.getElementById('editor-save-status');
        if (!saveStatus || !this.codeEditorInstance) return;

        // If no file loaded, show "unsaved"
        if (!this.editorState.currentFile) {
            saveStatus.textContent = window.i18n.t('unsaved');
            saveStatus.className = 'code-editor-save-status unsaved';
            return;
        }

        const hasChanges = this.codeEditorInstance.getValue() !== this.editorState.originalContent;

        if (hasChanges) {
            saveStatus.textContent = window.i18n.t('unsaved');
            saveStatus.className = 'code-editor-save-status unsaved';
        } else {
            saveStatus.textContent = window.i18n.t('saved');
            saveStatus.className = 'code-editor-save-status saved';
        }
    }

    /**
     * Update theme
     */
    updateTheme(theme) {
        if (this.codeEditorInstance) {
            this.codeEditorInstance.updateTheme(theme);
        }
    }

    /**
     * Perform download operation
     */
    async performSave() {
        try {
            const newContent = this.codeEditorInstance.getValue();
            const fileName = this.editorState.currentFile.name;

            // 1. Download file to local
            this.downloadFile(newContent, fileName);

            // 2. Create new File object for memory update
            const blob = new Blob([newContent], { type: 'text/plain' });
            const newFile = new File([blob], fileName, {
                type: this.editorState.currentFile.type
            });

            // 3. Update all related fileMap entries (don't add new, only replace)
            for (const [key, value] of this.fileMap.entries()) {
                if (value === this.editorState.currentFile ||
                    key === fileName ||
                    key.endsWith('/' + fileName)) {
                    this.fileMap.set(key, newFile);
                }
            }

            // 4. Update editor state
            this.editorState.currentFile = newFile;
            this.editorState.originalContent = newContent;
            this.editorState.currentContent = newContent;

            this.updateEditorSaveStatus();

        } catch (error) {
            console.error('Download failed:', error);
            this.showInlineMessage(`Download failed: ${error.message}`, 'error');
        }
    }

    /**
     * Download file to local
     */
    downloadFile(content, fileName) {
        try {
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to download file:', error);
            throw error;
        }
    }

    /**
     * Show inline message in editor
     */
    showInlineMessage(message, type = 'info') {
        const editorPanel = document.getElementById('code-editor-panel');
        if (!editorPanel) {
            return;
        }

        // Remove old message
        const oldMsg = editorPanel.querySelector('.editor-inline-message');
        if (oldMsg) oldMsg.remove();

        const colors = {
            success: '#4ade80',
            error: '#ff6b6b',
            warning: '#fbbf24',
            info: '#4a9eff'
        };

        const msg = document.createElement('div');
        msg.className = 'editor-inline-message';
        msg.textContent = message;
        msg.style.cssText = `
            position: absolute;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            background: ${colors[type] || colors.info};
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            z-index: 999;
            font-size: 14px;
            animation: messageSlideIn 0.3s ease;
        `;

        editorPanel.appendChild(msg);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            msg.style.animation = 'messageSlideOut 0.3s ease';
            setTimeout(() => msg.remove(), 300);
        }, 3000);
    }

    /**
     * Clear editor content
     */
    clearEditor() {
        if (!this.codeEditorInstance) return;

        // Clear editor content
        this.codeEditorInstance.setValue('');

        // Reset state
        this.editorState.currentFile = null;
        this.editorState.originalContent = '';
        this.editorState.currentContent = '';

        // Update filename display
        const filenameEl = document.getElementById('editor-filename');
        if (filenameEl) {
            filenameEl.textContent = window.i18n.t('newFile');
        }

        // Update control visibility
        if (this.updateControlsVisibility) {
            this.updateControlsVisibility();
        }

        // Update save status
        this.updateEditorSaveStatus();
    }

    /**
     * Get editor instance
     */
    getEditor() {
        return this.codeEditorInstance;
    }

    /**
     * Scroll to link definition in code
     * @param {string} linkName - Link name
     */
    scrollToLink(linkName) {
        if (!this.codeEditorInstance || !linkName) {
            return false;
        }

        // Ensure editor panel is visible
        const editorPanel = document.getElementById('code-editor-panel');
        const openEditorBtn = document.getElementById('open-editor-btn');
        if (editorPanel && !editorPanel.classList.contains('visible')) {
            editorPanel.classList.add('visible');
            if (openEditorBtn) {
                openEditorBtn.classList.add('active');
            }
        }

        // Search for link definition based on different XML formats
        // URDF format: <link name="link_name">
        // MJCF format: <body name="link_name">

        const urdfPattern = `<link name="${linkName}"`;
        const mjcfPattern = `<body name="${linkName}"`;

        // Try URDF format first
        let found = this.codeEditorInstance.searchAndScroll(urdfPattern, true);

        // If not found, try MJCF format
        if (!found) {
            found = this.codeEditorInstance.searchAndScroll(mjcfPattern, true);
        }

        return found;
    }

    /**
     * Scroll to joint definition in code
     * @param {string} jointName - Joint name
     */
    scrollToJoint(jointName) {
        if (!this.codeEditorInstance || !jointName) {
            return false;
        }

        // Ensure editor panel is visible
        const editorPanel = document.getElementById('code-editor-panel');
        const openEditorBtn = document.getElementById('open-editor-btn');
        if (editorPanel && !editorPanel.classList.contains('visible')) {
            editorPanel.classList.add('visible');
            if (openEditorBtn) {
                openEditorBtn.classList.add('active');
            }
        }

        // Search for joint definition based on different XML formats
        // URDF format: <joint name="joint_name"
        // MJCF format: <joint name="joint_name"

        const pattern = `<joint name="${jointName}"`;
        const found = this.codeEditorInstance.searchAndScroll(pattern, true);

        return found;
    }

    scrollToDiagnostic(diagnostic) {
        if (!this.codeEditorInstance || !diagnostic) {
            return false;
        }

        const editorPanel = document.getElementById('code-editor-panel');
        const openEditorBtn = document.getElementById('open-editor-btn');
        if (editorPanel && !editorPanel.classList.contains('visible')) {
            editorPanel.classList.add('visible');
            if (openEditorBtn) {
                openEditorBtn.classList.add('active');
            }
        }

        const openInCurrentEditor = () => {
            const lineNumber = diagnostic.metadata?.lineNumber;
            const searchText = diagnostic.metadata?.searchText;
            let found = this.codeEditorInstance.scrollToLineOrSearch(lineNumber, searchText);

            if (!found && diagnostic.targetType === 'link' && diagnostic.targetName) {
                found = this.scrollToLink(diagnostic.targetName);
            }

            if (!found && diagnostic.targetType === 'joint' && diagnostic.targetName) {
                found = this.scrollToJoint(diagnostic.targetName);
            }

            return found;
        };

        const targetFilePath = diagnostic.filePath;
        if (targetFilePath && this.fileMap && this.editorState.currentFile) {
            const currentFile = this.editorState.currentFile;
            let currentFilePath = currentFile.name;

            for (const [key, value] of this.fileMap.entries()) {
                if (value === currentFile) {
                    currentFilePath = key;
                    break;
                }
            }

            if (currentFilePath !== targetFilePath) {
                const targetFile = this.fileMap.get(targetFilePath);
                if (targetFile) {
                    this.loadFile(targetFile).then(() => {
                        openInCurrentEditor();
                    });
                    return true;
                }
            }
        }

        return openInCurrentEditor();
    }
}

