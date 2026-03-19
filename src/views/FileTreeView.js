import { normalizePath } from '../utils/FileUtils.js';

/**
 * FileTreeView - File tree view
 * Responsible for displaying and managing file tree structure
 */

export class FileTreeView {
    constructor() {
        this.availableModels = [];
        this.onFileClick = null;
    }

    /**
     * Update file tree
     */
    updateFileTree(files, fileMap, preserveState = false) {
        this.availableModels = files;
        const listContainer = document.getElementById('model-list');
        if (!listContainer) return;

        // Save expanded state
        const expandedPaths = preserveState ? this.saveTreeState() : [];

        listContainer.innerHTML = '';

        const hasVisibleFiles = fileMap instanceof Map ? fileMap.size > 0 : false;
        if (!hasVisibleFiles) {
            this.showLoadButton(listContainer);
            return;
        }

        this.buildFileTree(listContainer, files, fileMap);

        // Restore expanded state
        if (preserveState && expandedPaths.length > 0) {
            setTimeout(() => this.restoreTreeState(expandedPaths), 0);
        }
    }

    /**
     * Show load file/folder button when no files are loaded
     */
    showLoadButton(container) {
        const emptyContainer = document.createElement('div');
        emptyContainer.className = 'file-tree-empty-container';
        emptyContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            min-height: 200px;
            padding: 20px;
            gap: 12px;
        `;

        const emptyText = document.createElement('div');
        emptyText.className = 'empty-state';
        emptyText.style.cssText = 'margin: 0; padding: 0; text-align: center; line-height: 1.6;';

        // First line: drag and drop hint
        const line1 = document.createElement('div');
        line1.textContent = window.i18n?.t('dropHint') || 'Drag and drop robot model files or folders anywhere';
        line1.setAttribute('data-i18n', 'dropHint');

        // Second line: or click button
        const line2 = document.createElement('div');
        line2.textContent = window.i18n?.t('orClickButton') || 'or click button to load';
        line2.setAttribute('data-i18n', 'orClickButton');
        line2.style.marginTop = '4px';

        emptyText.appendChild(line1);
        emptyText.appendChild(line2);

        // Create button container for two buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 8px;
        `;

        // Load Files Button
        const loadFilesButton = document.createElement('button');
        loadFilesButton.className = 'control-button load-files-btn';
        const loadFilesSpan = document.createElement('span');
        loadFilesSpan.textContent = window.i18n?.t('loadFiles') || 'Load Files';
        loadFilesSpan.setAttribute('data-i18n', 'loadFiles');
        loadFilesButton.appendChild(loadFilesSpan);
        loadFilesButton.style.cssText = `
            padding: 8px 16px;
            font-size: 13px;
            flex: 1;
        `;
        loadFilesButton.title = '选择单个或多个文件';
        loadFilesButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.triggerFileLoad(false);
        });

        // Load Folder Button
        const loadFolderButton = document.createElement('button');
        loadFolderButton.className = 'control-button load-folder-btn';
        const loadFolderSpan = document.createElement('span');
        loadFolderSpan.textContent = window.i18n?.t('loadFolder') || 'Load Folder';
        loadFolderSpan.setAttribute('data-i18n', 'loadFolder');
        loadFolderButton.appendChild(loadFolderSpan);
        loadFolderButton.style.cssText = `
            padding: 8px 16px;
            font-size: 13px;
            flex: 1;
        `;
        loadFolderButton.title = '选择整个文件夹';
        loadFolderButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.triggerFileLoad(true);
        });

        buttonContainer.appendChild(loadFilesButton);
        buttonContainer.appendChild(loadFolderButton);

        emptyContainer.appendChild(emptyText);
        emptyContainer.appendChild(buttonContainer);
        container.appendChild(emptyContainer);
    }

    /**
     * Trigger file/folder loading dialog
     */
    triggerFileLoad(isFolder = false) {
        // Create a temporary file input to allow file selection
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.webkitdirectory = isFolder;
        input.style.display = 'none';

        if (!isFolder) {
            input.setAttribute('accept', '.urdf,.xacro,.mjcf,.xml,.dae,.stl,.obj,.collada,.gltf,.glb,.usd,.usda,.usdc,.usdz');
        }

        input.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            if (files && files.length > 0) {
                // Create a drag event and dispatch it
                const dt = new DataTransfer();
                files.forEach(file => dt.items.add(file));

                const dropEvent = new DragEvent('drop', {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: dt
                });

                document.body.dispatchEvent(dropEvent);
            }
            // Clean up
            document.body.removeChild(input);
        });

        // Add to DOM temporarily and trigger click
        document.body.appendChild(input);
        input.click();
    }

    /**
     * Save file tree state
     */
    saveTreeState() {
        const expandedPaths = [];
        document.querySelectorAll('.tree-item.folder:not(.collapsed)').forEach(folder => {
            const nameSpan = folder.querySelector('.name');
            if (nameSpan) {
                expandedPaths.push(nameSpan.textContent);
            }
        });
        return expandedPaths;
    }

    /**
     * Restore file tree state
     */
    restoreTreeState(expandedPaths) {
        if (!expandedPaths || expandedPaths.length === 0) return;

        document.querySelectorAll('.tree-item.folder').forEach(folder => {
            const nameSpan = folder.querySelector('.name');
            if (nameSpan && expandedPaths.includes(nameSpan.textContent)) {
                folder.classList.remove('collapsed');
            }
        });
    }

    /**
     * Mark current active file
     */
    markActiveFile(file) {
        if (!file) {
            return;
        }

        const matchingItem = Array.from(document.querySelectorAll('#model-list .tree-item.file')).find(item => {
            const itemPath = normalizePath(item.dataset.filePath || '');
            return itemPath.endsWith(`/${file.name}`) || itemPath === normalizePath(file.name);
        });

        if (matchingItem) {
            this.selectTreeItem(matchingItem);
            matchingItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    /**
     * Expand folder containing file and scroll to file position
     */
    expandAndScrollToFile(file, fileMap) {
        if (!file) return;

        let filePath = '';
        fileMap?.forEach((candidateFile, path) => {
            if (!filePath && candidateFile === file) {
                filePath = path;
            }
        });

        if (!filePath) {
            filePath = file.webkitRelativePath || file.name;
        }

        this.selectFileByPath(filePath);
    }

    /**
     * Check if XML file is a model file (URDF/MJCF)
     */
    isModelXML(fileName) {
        const lowerName = fileName.toLowerCase();
        // Exclude common non-model XML files
        const excludePatterns = ['package', 'launch', 'config', 'scene', 'ros'];
        return !excludePatterns.some(pattern => lowerName.includes(pattern));
    }

    /**
     * Build file tree
     */
    buildFileTree(container, files, fileMap) {
        const fileStructure = {};
        const loadableFileInfoByPath = new Map(
            (Array.isArray(files) ? files : []).map(fileInfo => [normalizePath(fileInfo.path), fileInfo])
        );

        fileMap.forEach((file, path) => {
            const normalizedPath = normalizePath(path || file?.webkitRelativePath || file?.name || '');
            const ext = (file?.name || normalizedPath).includes('.')
                ? (file?.name || normalizedPath).split('.').pop().toLowerCase()
                : '';
            const loadableFileInfo = loadableFileInfoByPath.get(normalizedPath) || null;
            const parts = normalizedPath.split('/').filter(p => p);
            let current = fileStructure;

            parts.forEach((part, index) => {
                if (index === parts.length - 1) {
                    if (!current.__files) current.__files = [];
                    current.__files.push({
                        name: part,
                        file: file,
                        path: normalizedPath,
                        ext,
                        category: loadableFileInfo?.category || 'resource',
                        type: loadableFileInfo?.type || 'resource'
                    });
                } else {
                    if (!current[part]) current[part] = {};
                    current = current[part];
                }
            });
        });

        this.renderFileTreeStructure(fileStructure, container, '');
    }

    /**
     * Render file tree structure
     */
    renderFileTreeStructure(structure, container, parentPath = '') {
        const folders = [];
        const files = [];

        Object.keys(structure).forEach(key => {
            if (key === '__files') {
                files.push(...structure[key]);
            } else {
                folders.push(key);
            }
        });

        folders.sort().forEach(folderName => {
            const folderPath = normalizePath(parentPath ? `${parentPath}/${folderName}` : folderName);
            const folder = this.createTreeFolder(folderName, folderPath);
            const folderChildren = folder.querySelector('.tree-children');
            this.renderFileTreeStructure(structure[folderName], folderChildren, folderPath);
            container.appendChild(folder);
        });

        if (files.length > 0) {
            this.renderFiles(files, container);
        }
    }

    /**
     * Create folder node
     */
    createTreeFolder(name, folderPath = '') {
        const folder = document.createElement('div');
        folder.className = 'tree-item folder collapsed';
        folder.dataset.folderPath = folderPath;

        const header = document.createElement('div');
        header.className = 'tree-item-header';

        const leftContent = document.createElement('div');
        leftContent.className = 'tree-item-left';

        const arrow = document.createElement('span');
        arrow.className = 'tree-arrow';

        const icon = document.createElement('span');
        icon.className = 'icon';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = name;

        leftContent.appendChild(arrow);
        leftContent.appendChild(icon);
        leftContent.appendChild(nameSpan);
        header.appendChild(leftContent);

        const children = document.createElement('div');
        children.className = 'tree-children';

        folder.appendChild(header);
        folder.appendChild(children);

        header.addEventListener('click', (e) => {
            e.stopPropagation();
            folder.classList.toggle('collapsed');
        });

        return folder;
    }

    /**
     * Render file list
     */
    renderFiles(files, container) {
        files.sort((a, b) => {
            const priority = {
                model: 0,
                mesh: 1,
                resource: 2
            };
            const priorityDiff = (priority[a.category] ?? 99) - (priority[b.category] ?? 99);
            if (priorityDiff !== 0) {
                return priorityDiff;
            }
            return a.name.localeCompare(b.name);
        });

        files.forEach(fileInfo => {
            const item = this.createTreeItem(fileInfo);
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectTreeItem(item);
                this.onFileClick?.(fileInfo);
            });
            container.appendChild(item);
        });
    }

    /**
     * Create file node
     */
    createTreeItem(fileInfo) {
        const { name, ext, path, category } = fileInfo;
        const item = document.createElement('div');
        item.className = 'tree-item file';
        item.dataset.filePath = normalizePath(path || name || '');
        item.dataset.fileCategory = category || 'resource';

        const header = document.createElement('div');
        header.className = 'tree-item-header';

        const leftContent = document.createElement('div');
        leftContent.className = 'tree-item-left';

        const icon = document.createElement('span');
        icon.className = 'icon';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = name;

        leftContent.appendChild(icon);
        leftContent.appendChild(nameSpan);
        header.appendChild(leftContent);

        // Add type label (e.g., URDF, XACRO, STL, etc.)
        if (ext) {
            const badge = document.createElement('span');
            badge.className = 'type-badge';
            badge.textContent = ext.toUpperCase();
            header.appendChild(badge);
        }

        item.appendChild(header);

        return item;
    }

    selectTreeItem(item) {
        document.querySelectorAll('.tree-item.selected').forEach(elem => {
            elem.classList.remove('selected');
        });

        item?.classList.add('selected');
    }

    clearSelectedFile() {
        document.querySelectorAll('#model-list .tree-item.selected').forEach(item => {
            item.classList.remove('selected');
        });
    }

    selectFileByPath(filePath, options = {}) {
        const { scroll = true } = options;
        const normalizedPath = normalizePath(filePath);
        if (!normalizedPath) {
            return false;
        }

        document.querySelectorAll('#model-list .tree-item.folder').forEach(folder => {
            const folderPath = normalizePath(folder.dataset.folderPath || '');
            if (folderPath && (normalizedPath === folderPath || normalizedPath.startsWith(`${folderPath}/`))) {
                folder.classList.remove('collapsed');
            }
        });

        const items = Array.from(document.querySelectorAll('#model-list .tree-item.file'));
        const targetItem = items.find(item => normalizePath(item.dataset.filePath || '') === normalizedPath);
        if (!targetItem) {
            return false;
        }

        this.selectTreeItem(targetItem);
        if (scroll) {
            targetItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        return true;
    }
}

