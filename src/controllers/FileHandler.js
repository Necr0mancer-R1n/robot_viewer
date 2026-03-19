/**
 * FileHandler - File handling module
 * Handles file drag-drop, loading, type detection, etc.
 */
import * as THREE from 'three';
import { ModelLoaderFactory } from '../loaders/ModelLoaderFactory.js';
import { readFileContent, getFileFromEntry, getFileTypeFromExtension, getFileDisplayType } from '../utils/FileUtils.js';
import { addDiagnostics, addRuntimeDiagnostic, clearRuntimeDiagnostics, createDiagnostic, getRuntimeDiagnostics, upsertResourceSummaryDiagnostic, validateModelDiagnostics } from '../utils/DiagnosticsUtils.js';

export class FileHandler {
    constructor() {
        this.fileMap = new Map();
        this.availableModels = [];
        this.currentModelFile = null;
        this.onModelLoaded = null; // Callback function
        this.onLoadError = null;
        this.usdViewerManager = null; // USD viewer manager (lazy loaded)
    }

    /**
     * Set USD viewer manager
     */
    setUSDViewerManager(manager) {
        this.usdViewerManager = manager;
    }

    /**
     * Set USD viewer initializer callback (for lazy loading)
     */
    setUSDViewerInitializer(initializer) {
        this.usdViewerInitializer = initializer;
    }

    /**
     * Setup file drag-drop
     */
    setupFileDrop() {
        const body = document.body;

        const preventDefaults = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            body.addEventListener(eventName, preventDefaults, false);
        });

        let dragCounter = 0;
        body.addEventListener('dragenter', (e) => {
            dragCounter++;
            const dropZone = document.getElementById('drop-zone');
            if (dropZone) dropZone.classList.add('drag-over');
        }, false);

        body.addEventListener('dragleave', (e) => {
            dragCounter--;
            if (dragCounter === 0) {
                const dropZone = document.getElementById('drop-zone');
                if (dropZone) dropZone.classList.remove('drag-over');
            }
        }, false);

        body.addEventListener('drop', (e) => {
            dragCounter = 0;
            const dropZone = document.getElementById('drop-zone');
            if (dropZone) dropZone.classList.remove('drag-over');
            this.handleDrop(e);
        }, false);
    }


    /**
     * Handle file drop
     */
    async handleDrop(e) {
        const items = e.dataTransfer.items;
        if (!items || items.length === 0) return;

        this.fileMap.clear();

        const entries = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.webkitGetAsEntry) {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    entries.push(entry);
                }
            }
        }

        if (entries.length > 0) {
            await this.processEntries(entries);
        } else {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                for (const file of files) {
                    const path = file.webkitRelativePath || file.name;
                    this.fileMap.set(path, file);
                    // Only add file.name as a separate key if there's no webkitRelativePath
                    // This prevents duplicate entries in the file tree
                    if (!file.webkitRelativePath) {
                        this.fileMap.set(file.name, file);
                    }
                }

                const loadableFiles = await this.findAllLoadableFiles(Array.from(files));

                if (loadableFiles.length > 0) {
                    this.availableModels = loadableFiles;
                    this.onFilesLoaded?.(loadableFiles);
                    await this.loadFileOrMesh(loadableFiles[0]);
                }
            }
        }
    }

    /**
     * Process file system entries
     */
    async processEntries(entries) {
        const files = [];

        for (const entry of entries) {
            if (entry.isFile) {
                const file = await getFileFromEntry(entry);
                const path = entry.fullPath || entry.name;
                this.fileMap.set(path, file);
                files.push(file);
            } else if (entry.isDirectory) {
                const dirFiles = await this.readDirectory(entry);
                files.push(...dirFiles);
            }
        }

        if (files.length === 0) return;

        const loadableFiles = await this.findAllLoadableFiles(files);

        if (loadableFiles.length === 0) {
            this.onFilesLoaded?.([]);
            return;
        }

        this.availableModels = loadableFiles;
        this.onFilesLoaded?.(loadableFiles);

        if (loadableFiles.length > 0) {
            await this.loadFileOrMesh(loadableFiles[0]);
        }
    }

    /**
     * Recursively read directory
     */
    async readDirectory(dirEntry) {
        const files = [];

        return new Promise((resolve, reject) => {
            const reader = dirEntry.createReader();

            const readEntries = () => {
                reader.readEntries(async (entries) => {
                    if (entries.length === 0) {
                        resolve(files);
                        return;
                    }

                    for (const entry of entries) {
                        if (entry.isFile) {
                            const file = await getFileFromEntry(entry);
                            const path = entry.fullPath || entry.name;
                            this.fileMap.set(path, file);
                            files.push(file);
                        } else if (entry.isDirectory) {
                            const subFiles = await this.readDirectory(entry);
                            files.push(...subFiles);
                        }
                    }

                    readEntries();
                }, reject);
            };

            readEntries();
        });
    }

    /**
     * Find all loadable files
     */
    async findAllLoadableFiles(files) {
        const supportedExtensions = {
            model: ['urdf', 'xacro', 'mjcf', 'xml', 'usd', 'usda', 'usdc', 'usdz'],
            mesh: ['dae', 'stl', 'obj', 'collada', 'gltf', 'glb']
        };
        const loadableFiles = [];

        const checkPromises = files.map(async (file) => {
            const ext = file.name.toLowerCase().split('.').pop();

            if (supportedExtensions.model.includes(ext)) {
                if (ext === 'xml') {
                    try {
                        const content = await readFileContent(file);
                        const fileType = ModelLoaderFactory.detectFileType(file.name, content);

                        if (!fileType) {
                            return null;
                        }

                        return {
                            file: file,
                            name: file.name,
                            type: fileType,
                            path: file.webkitRelativePath || file.name,
                            category: 'model'
                        };
                    } catch (error) {
                        console.error(`Failed to read XML file: ${file.name}`, error);
                        return null;
                    }
                } else {
                    const fileType = getFileTypeFromExtension(ext);
                    return {
                        file: file,
                        name: file.name,
                        type: fileType,
                        path: file.webkitRelativePath || file.name,
                        category: 'model'
                    };
                }
            } else if (supportedExtensions.mesh.includes(ext)) {
                return {
                    file: file,
                    name: file.name,
                    type: 'mesh',
                    path: file.webkitRelativePath || file.name,
                    category: 'mesh'
                };
            }

            return null;
        });

        const results = await Promise.all(checkPromises);

        results.forEach(result => {
            if (result) {
                loadableFiles.push(result);
            }
        });

        loadableFiles.sort((a, b) => {
            if (a.category !== b.category) {
                return a.category === 'model' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        return loadableFiles;
    }

    /**
     * Load file or mesh
     */
    async loadFileOrMesh(fileInfo) {
        if (fileInfo.category === 'model') {
            await this.loadFile(fileInfo.file);
        } else if (fileInfo.category === 'mesh') {
            await this.loadMeshAsModel(fileInfo.file, fileInfo.name);
        }
    }

    /**
     * Load model file
     */
    async loadFile(file) {
        this.currentModelFile = file;
        clearRuntimeDiagnostics();

        try {
            const fileName = file.name.toLowerCase();

            // Get the full path from fileMap
            let fullPath = file.name;
            for (const [path, f] of this.fileMap.entries()) {
                if (f === file) {
                    fullPath = path;
                    break;
                }
            }

            // Handle USD format files (all USD formats use WASM)
            const isUSD = fileName.endsWith('.usd') || fileName.endsWith('.usda') ||
                         fileName.endsWith('.usdc') || fileName.endsWith('.usdz');
            if (isUSD) {
                // Ensure USD viewer is initialized
                if (!this.usdViewerManager && this.usdViewerInitializer) {
                    try {
                        await this.usdViewerInitializer();
                    } catch (error) {
                        console.error('USD viewer initialization failed:', error);
                        this.notifyLoadError(error, {
                            code: 'usd/init-failed',
                            source: 'usd',
                            filePath: fullPath
                        });
                        return;
                    }
                }

                if (this.fileMap.size === 0) {
                    this.fileMap.set(file.name, file);
                }

                // USD files need File object passed
                const model = await ModelLoaderFactory.loadModel(
                    'usd',
                    null,
                    fullPath,
                    this.fileMap,
                    file,
                    { usdViewerManager: this.usdViewerManager }
                );

                model.userData.filePath = fullPath;
                model.userData.fileType = 'usd';
                addDiagnostics(model, validateModelDiagnostics(model, {
                    source: 'usd',
                    filePath: fullPath
                }));
                upsertResourceSummaryDiagnostic(model);

                this.onModelLoaded?.(model, file, false, null);
                document.getElementById('drop-zone')?.classList.remove('show');
                document.getElementById('drop-zone')?.classList.remove('drag-over');
                return;
            }

            // For other files, read text content
            const content = await readFileContent(file);

            // Detect if USDC binary format (based on content)
            if (this.isUSDCBinaryContent(content)) {
                console.error('Cannot load USDC binary format, please convert to USDZ or USDA');
                this.notifyLoadError(new Error('Cannot load USDC binary format, please convert to USDZ or USDA'), {
                    code: 'usd/usdc-binary',
                    source: 'usd',
                    filePath: fullPath
                });
                return;
            }

            const fileType = ModelLoaderFactory.detectFileType(file.name, content);

            if (!fileType) {
                console.error(`${window.i18n.t('unsupportedFormat')}: ${file.name}`);
                this.notifyLoadError(new Error(`${window.i18n.t('unsupportedFormat')}: ${file.name}`), {
                    code: 'model/unsupported-format',
                    source: 'file',
                    filePath: fullPath
                });
                return;
            }

            if (this.fileMap.size === 0) {
                this.fileMap.set(file.name, file);
            }

            const model = await ModelLoaderFactory.loadModel(
                fileType,
                content,
                fullPath,  // Use full path instead of just file.name
                this.fileMap,
                file,
                { usdViewerManager: this.usdViewerManager }
            );

            model.userData.filePath = fullPath;
            model.userData.fileType = fileType;
            addDiagnostics(model, validateModelDiagnostics(model, {
                source: fileType,
                filePath: fullPath,
                content
            }));
            upsertResourceSummaryDiagnostic(model);

            // Notify model loaded (pass null as snapshot, let main.js create it)
            this.onModelLoaded?.(model, file, false, null);

            document.getElementById('drop-zone')?.classList.remove('show');
            document.getElementById('drop-zone')?.classList.remove('drag-over');

        } catch (error) {
            console.error('Failed to load file:', error);

            // If error message contains USDC related content
            if (error.message && (error.message.includes('USDC') || error.message.includes('binary format'))) {
                console.error('Cannot load USDC binary format, please convert to USDZ or USDA');
            } else {
                console.error(`${window.i18n.t('loadFailed')}: ${error.message}`);
            }

            this.notifyLoadError(error, {
                code: 'model/load-failed',
                source: 'file',
                filePath: file?.name || ''
            });

            // Remove snapshot if exists
            const snapshot = document.getElementById('canvas-snapshot');
            if (snapshot?.parentNode) {
                snapshot.parentNode.removeChild(snapshot);
            }
        }
    }

    /**
     * Detect if file content is USDC binary format
     */
    isUSDCBinaryContent(content) {
        if (!content || typeof content !== 'string') {
            return false;
        }

        // Detect USDC binary format characteristics
        // 1. Starts with "PXR-USDC" (USDC file magic bytes)
        if (content.startsWith('PXR-USDC')) {
            return true;
        }

        // 2. Check first 100 bytes, if contains many null bytes, likely binary
        const firstBytes = content.substring(0, 100);
        const nullCount = (firstBytes.match(/\x00/g) || []).length;
        if (nullCount > 10) {
            return true;
        }

        // 3. Check if valid ASCII USD file
        // Valid USDA files usually start with #usda or contain def keywords
        if (content.includes('#usda') ||
            (content.includes('def ') && content.includes('{'))) {
            return false;
        }

        // 4. File starts with non-printable characters (excluding newline, carriage return, tab, space)
        const firstChar = content.charCodeAt(0);
        if (firstChar < 32 && firstChar !== 10 && firstChar !== 13 && firstChar !== 9 && firstChar !== 32) {
            return true;
        }

        return false;
    }

    /**
     * Create loading snapshot
     */
    createLoadingSnapshot() {
        const canvas = document.getElementById('canvas');
        if (!canvas) return null;

        try {
            const dataURL = canvas.toDataURL('image/png');
            const snapshot = document.createElement('div');
            snapshot.id = 'canvas-snapshot';
            snapshot.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-image: url(${dataURL});
                background-size: cover;
                background-position: center;
                background-color: var(--bg-primary);
                background-repeat: no-repeat;
                z-index: 2;
                pointer-events: none;
            `;

            const canvasContainer = document.getElementById('canvas-container');
            if (canvasContainer) {
                canvasContainer.appendChild(snapshot);
            }

            return snapshot;
        } catch (error) {
            console.error('Failed to create snapshot:', error);
            return null;
        }
    }

    /**
     * Remove loading snapshot
     */
    removeLoadingSnapshot(snapshot) {
        if (!snapshot || !snapshot.parentNode) return;

        snapshot.style.transition = 'opacity 0.3s ease';
        snapshot.style.opacity = '0';

        setTimeout(() => {
            if (snapshot.parentNode) {
                snapshot.parentNode.removeChild(snapshot);
            }
        }, 300);
    }

    /**
     * Load single mesh file as model
     */
    async loadMeshAsModel(file, fileName) {
        clearRuntimeDiagnostics();
        try {
            const meshObject = await ModelLoaderFactory.loadMeshFileDirect(file, fileName);

            if (!meshObject) {
                throw new Error(window.i18n.t('cannotLoadMesh'));
            }

            // Ensure mesh materials support lighting and shadows
            meshObject.traverse((child) => {
                if (child.isMesh) {
                    if (child.material?.type === 'MeshBasicMaterial') {
                        const oldMaterial = child.material;
                        child.material = new THREE.MeshPhongMaterial({
                            color: oldMaterial.color,
                            map: oldMaterial.map,
                            transparent: oldMaterial.transparent,
                            opacity: oldMaterial.opacity,
                            side: oldMaterial.side,
                            shininess: 30
                        });
                        if (child.material.map) {
                            child.material.map.colorSpace = THREE.SRGBColorSpace;
                        }
                    }
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            const buildMeshLinks = (rootObject, sourceFileName) => {
                const links = new Map();
                const usedNames = new Set();
                const baseName = sourceFileName.replace(/\.[^.]+$/, '') || 'mesh';
                let unnamedIndex = 1;

                const createUniqueName = (preferredName) => {
                    let candidate = (preferredName || '').trim();
                    if (!candidate) {
                        candidate = `${baseName}_part_${unnamedIndex++}`;
                    }

                    if (!usedNames.has(candidate)) {
                        usedNames.add(candidate);
                        return candidate;
                    }

                    let suffix = 2;
                    while (usedNames.has(`${candidate}_${suffix}`)) {
                        suffix += 1;
                    }
                    const uniqueName = `${candidate}_${suffix}`;
                    usedNames.add(uniqueName);
                    return uniqueName;
                };

                rootObject.traverse((child) => {
                    if (!child.isMesh) {
                        return;
                    }

                    const linkName = createUniqueName(child.name);
                    child.userData = child.userData || {};
                    child.userData.reviewLinkName = linkName;

                    links.set(linkName, {
                        name: linkName,
                        threeObject: child,
                        visuals: [{
                            name: linkName,
                            threeObject: child,
                            geometry: { mesh: sourceFileName }
                        }],
                        inertial: null,
                        userData: {
                            sourceType: 'mesh',
                            sourceFileName
                        }
                    });
                });

                if (links.size === 0) {
                    const linkName = createUniqueName(rootObject.name || 'mesh_root');
                    rootObject.userData = rootObject.userData || {};
                    rootObject.userData.reviewLinkName = linkName;

                    links.set(linkName, {
                        name: linkName,
                        threeObject: rootObject,
                        visuals: [{
                            name: linkName,
                            threeObject: rootObject,
                            geometry: { mesh: sourceFileName }
                        }],
                        inertial: null,
                        userData: {
                            sourceType: 'mesh',
                            sourceFileName
                        }
                    });
                }

                return links;
            };

            const meshLinks = buildMeshLinks(meshObject, fileName);
            const rootLinkName = meshLinks.keys().next().value || 'mesh_root';
            const simpleMeshModel = {
                name: fileName,
                rootLink: rootLinkName,
                links: meshLinks,
                joints: new Map(),
                threeObject: meshObject,
                userData: {
                    fileType: 'mesh'
                }
            };

            this.currentModelFile = file;
            this.onModelLoaded?.(simpleMeshModel, file, true, null);

        } catch (error) {
            console.error('Failed to load mesh file:', error);
            this.notifyLoadError(error, {
                code: 'mesh/load-failed',
                source: 'mesh',
                filePath: fileName
            });

            const snapshot = document.getElementById('canvas-snapshot');
            if (snapshot?.parentNode) {
                snapshot.parentNode.removeChild(snapshot);
            }
        }
    }

    /**
     * Get file map
     */
    getFileMap() {
        return this.fileMap;
    }

    /**
     * Get available models list
     */
    getAvailableModels() {
        return this.availableModels;
    }

    /**
     * Get current model file
     */
    getCurrentModelFile() {
        return this.currentModelFile;
    }

    notifyLoadError(error, options = {}) {
        const diagnostic = addRuntimeDiagnostic(createDiagnostic({
            level: 'error',
            code: options.code || 'runtime/error',
            source: options.source || 'runtime',
            message: error?.message || String(error),
            details: error?.stack || '',
            filePath: options.filePath || ''
        }));

        this.onLoadError?.(diagnostic, getRuntimeDiagnostics());
    }
}

