/**
 * Application main entry point
 * Integrates all modules
 */
import * as THREE from 'three';
import * as d3 from 'd3';
import { SceneManager } from './renderer/SceneManager.js';
import { UIController } from './ui/UIController.js';
import { FileHandler } from './controllers/FileHandler.js';
import { JointControlsUI } from './ui/JointControlsUI.js';
import { PanelManager } from './ui/PanelManager.js';
import { ModelGraphView } from './views/ModelGraphView.js';
import { FileTreeView } from './views/FileTreeView.js';
import { DiagnosticsView } from './views/DiagnosticsView.js';
import { ReviewPanelView } from './views/ReviewPanelView.js';
import { CodeEditorManager } from './controllers/CodeEditorManager.js';
import { MeasurementController } from './controllers/MeasurementController.js';
import { USDViewerManager } from './renderer/USDViewerManager.js';
import { MujocoSimulationManager } from './renderer/MujocoSimulationManager.js';
import { ModelLoaderFactory } from './loaders/ModelLoaderFactory.js';
import { i18n } from './utils/i18n.js';
import { normalizePath } from './utils/FileUtils.js';
import { DIAGNOSTICS_FIXTURES, loadDiagnosticsFixture, runAllDiagnosticsFixtures, runDiagnosticsFixture } from './fixtures/DiagnosticsFixtures.js';
import { createReviewSnapshot, parseReviewSnapshot, stringifyReviewSnapshot } from './review/ReviewSnapshot.mjs';

// Expose d3 globally for PanelManager
window.d3 = d3;

// Expose i18n globally
window.i18n = i18n;

// Application state
class App {
    constructor() {
        this.sceneManager = null;
        this.uiController = null;
        this.fileHandler = null;
        this.jointControlsUI = null;
        this.panelManager = null;
        this.modelGraphView = null;
        this.fileTreeView = null;
        this.diagnosticsView = null;
        this.reviewPanelView = null;
        this.codeEditorManager = null;
        this.measurementController = null;
        this.usdViewerManager = null;
        this.mujocoSimulationManager = null;
        this.currentModel = null;
        this.currentMJCFFile = null;
        this.currentMJCFModel = null;
        this.angleUnit = 'rad';
        this.vscodeFileMap = new Map(); // Store VSCode files
        this.reviewComments = [];
        this.reviewDirectSelection = null;
        this.review3DSelectionEnabled = false;
        this.snapshotToastTimer = null;
        this.snapshotReportTimer = null;
    }

    /**
     * Load model from VSCode extension
     * @param {Object} fileInfo - File info from VSCode {name, path, content, directory}
     */
    async loadModelFromVSCode(fileInfo) {
        try {
            console.log('Loading model from VSCode:', fileInfo.name);

            // Create a File-like object from the content
            const blob = new Blob([fileInfo.content], { type: 'text/plain' });
            const file = new File([blob], fileInfo.name, { type: 'text/plain' });

            // Store file info for resolving relative paths
            file.vscodeDirectory = fileInfo.directory;
            file.vscodePath = fileInfo.path;

            // Add to file map
            this.fileHandler.fileMap.set(fileInfo.name, file);
            this.fileHandler.fileMap.set(fileInfo.path, file);
            this.vscodeFileMap.set(fileInfo.name, fileInfo);

            // Load the model
            await this.fileHandler.loadFile(file);

            // Update file tree
            const loadableFiles = [{
                file: file,
                name: fileInfo.name,
                type: this.detectFileType(fileInfo.name),
                path: fileInfo.path,
                category: 'model',
                ext: fileInfo.name.split('.').pop().toLowerCase()
            }];

            this.fileHandler.availableModels = loadableFiles;
            if (this.fileTreeView) {
                this.fileTreeView.updateFileTree(loadableFiles, this.fileHandler.fileMap);
            }

            vscodeAdapter.log(`Model loaded successfully: ${fileInfo.name}`);
        } catch (error) {
            console.error('Failed to load model from VSCode:', error);
            vscodeAdapter.showError(`Failed to load model: ${error.message}`);
        }
    }

    /**
     * Detect file type from filename
     */
    detectFileType(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        if (['urdf', 'xacro'].includes(ext)) return 'urdf';
        if (['mjcf', 'xml'].includes(ext)) return 'mjcf';
        if (['usd', 'usda', 'usdc', 'usdz'].includes(ext)) return 'usd';
        if (['obj', 'stl', 'dae', 'collada', 'gltf', 'glb'].includes(ext)) return 'mesh';
        return 'unknown';
    }

    /**
     * Initialize application
     */
    async init() {
        try {
            // Initialize internationalization
            i18n.init();

            // Initialize scene manager
            const canvas = document.getElementById('canvas');
            if (!canvas) {
                console.error('Canvas element not found');
                return;
            }

            this.sceneManager = new SceneManager(canvas);
            window.sceneManager = this.sceneManager; // For debugging

            // Create USD viewer container (container only, WASM initialized on demand)
            this.createUSDViewerContainer();

            // Initialize file handler
            this.fileHandler = new FileHandler();
            this.fileHandler.setupFileDrop();

            // Set USD viewer lazy loading
            this.fileHandler.setUSDViewerInitializer(async () => {
                return await this.getUSDViewerManager();
            });

            this.fileHandler.onFilesLoaded = (files) => {
                if (this.fileTreeView) {
                    this.fileTreeView.updateFileTree(files, this.fileHandler.getFileMap());
                }
            };

            this.fileHandler.onModelLoaded = (model, file, isMesh = false, snapshot = null) => {
                this.handleModelLoaded(model, file, isMesh, snapshot);
            };

            this.fileHandler.onLoadError = () => {
                if (this.diagnosticsView) {
                    this.diagnosticsView.render(this.currentModel, this.fileHandler?.getCurrentModelFile());
                }
            };

            // Initialize joint controls UI
            this.jointControlsUI = new JointControlsUI(this.sceneManager);

            // Initialize model graph view
            this.modelGraphView = new ModelGraphView(this.sceneManager);

            // Initialize diagnostics view
            this.diagnosticsView = new DiagnosticsView(this.sceneManager);

            // Initialize review panel view
            this.reviewPanelView = new ReviewPanelView();
            this.reviewPanelView.init();
            this.reviewPanelView.onAddComment = (body, anchor) => this.addReviewComment(body, anchor);
            this.reviewPanelView.onSelectComment = (comment) => this.focusReviewComment(comment);
            this.reviewPanelView.onUpdateComment = (commentId, body) => this.updateReviewComment(commentId, body);
            this.reviewPanelView.onDeleteComment = (comment) => this.deleteReviewComment(comment?.id);
            this.reviewPanelView.onToggle3DSelection = () => this.toggleReview3DSelection();

            // Initialize file tree view
            this.fileTreeView = new FileTreeView();
            this.fileTreeView.onFileClick = (fileInfo) => {
                this.handleFileClick(fileInfo);
            };

            // Initialize file tree with empty state (shows load button)
            this.fileTreeView.updateFileTree([], new Map());

            // Initialize panel manager
            this.panelManager = new PanelManager();
            this.panelManager.initAllPanels();

            // Pass ModelGraphView reference to PanelManager (set after modelGraphView initialization)
            if (this.modelGraphView) {
                this.panelManager.setModelGraphView(this.modelGraphView);
            }

            // Initialize UI controller
            this.uiController = new UIController(this.sceneManager);
            this.uiController.setupAll({
                onThemeChanged: (theme) => this.handleThemeChanged(theme),
                onAngleUnitChanged: (unit) => this.handleAngleUnitChanged(unit),
                onIgnoreLimitsChanged: (ignore) => this.handleIgnoreLimitsChanged(ignore),
                onLanguageChanged: (lang) => this.handleLanguageChanged(lang),
                onResetJoints: () => this.handleResetJoints(),
                onMujocoReset: () => this.handleMujocoReset(),
                onMujocoToggleSimulate: () => this.handleMujocoToggleSimulate(),
                onExportReviewSnapshot: () => this.handleExportReviewSnapshot(),
                onImportReviewSnapshot: (file) => this.handleImportReviewSnapshot(file)
            });

            // Set measurement update callback
            this.sceneManager.onMeasurementUpdate = () => {
                if (this.measurementController) {
                    this.measurementController.updateMeasurement();
                }
            };

            // Setup canvas click handler
            this.setupCanvasClickHandler(canvas);

            // Initialize code editor manager
            this.codeEditorManager = new CodeEditorManager();
            this.codeEditorManager.init(this.fileHandler.getFileMap());

            // Set code editor manager to joint controls UI
            if (this.jointControlsUI) {
                this.jointControlsUI.setCodeEditorManager(this.codeEditorManager);
                this.jointControlsUI.setDiagnosticsView(this.diagnosticsView);
            }

            // Set code editor manager to model graph view
            if (this.modelGraphView) {
                this.modelGraphView.setCodeEditorManager(this.codeEditorManager);
                this.modelGraphView.setDiagnosticsView(this.diagnosticsView);
                this.modelGraphView.onSelectionChanged = () => {
                    if (this.modelGraphView?.getSelectedTarget()) {
                        this.reviewDirectSelection = null;
                        this.fileTreeView?.clearSelectedFile?.();
                    }
                    this.renderReviewPanel();
                };
            }

            if (this.diagnosticsView) {
                this.diagnosticsView.setCodeEditorManager(this.codeEditorManager);
                this.diagnosticsView.onSelectionChanged = () => {
                    const hasDiagnosticSelection = Boolean(this.diagnosticsView?.getSelectedDiagnosticAnchor());
                    const hasFocusedTarget = Boolean(this.diagnosticsView?.getSnapshotState()?.focusedTarget);
                    if (hasDiagnosticSelection || hasFocusedTarget) {
                        this.reviewDirectSelection = null;
                        this.fileTreeView?.clearSelectedFile?.();
                    }
                    this.renderReviewPanel();
                };
                this.diagnosticsView.render();
            }

            this.renderReviewPanel();

            this.codeEditorManager.onReload = async (file, skipTreeUpdate = false) => {
                // Set flag when saving/reloading to avoid updating file tree
                if (skipTreeUpdate) {
                    this._isReloading = true;
                }

                // Temporarily update currentModelFile
                this.fileHandler.currentModelFile = file;

                await this.fileHandler.loadFile(file);

                this._isReloading = false;
            };

            // Save as callback: update file tree and mark new file
            this.codeEditorManager.onSaveAs = (newFile) => {
                // Update availableModels list
                const newFileInfo = {
                    file: newFile,
                    name: newFile.name,
                    type: this.detectFileType(newFile.name),
                    path: newFile.name,
                    category: 'model',
                    ext: newFile.name.split('.').pop().toLowerCase()
                };

                // Add to availableModels if not exists
                const models = this.fileHandler.getAvailableModels();
                if (!models.find(m => m.name === newFile.name)) {
                    models.push(newFileInfo);
                }

                // Update file tree
                if (this.fileTreeView) {
                    this.fileTreeView.updateFileTree(
                        models,
                        this.fileHandler.getFileMap(),
                        true
                    );
                    setTimeout(() => {
                        this.fileTreeView.markActiveFile(newFile);
                    }, 100);
                }
            };

            // Initialize measurement controller
            this.measurementController = new MeasurementController(this.sceneManager);

            // Associate measurement controller with model graph view
            if (this.modelGraphView) {
                this.modelGraphView.setMeasurementController(this.measurementController);
            }

            // Initialize MuJoCo simulation manager
            this.mujocoSimulationManager = new MujocoSimulationManager(this.sceneManager);

            // Setup model tree panel
            this.setupModelTreePanel();

            // Update editor button visibility
            this.updateEditorButtonVisibility();

            if (this.diagnosticsView) {
                this.diagnosticsView.render(this.currentModel, this.fileHandler?.getCurrentModelFile());
            }

            // Start render loop
            this.animate();

        } catch (error) {
            console.error('Initialization error:', error);
        }
    }

    /**
     * Update editor button visibility
     */
    updateEditorButtonVisibility() {
        const openEditorBtn = document.getElementById('open-editor-btn');
        if (openEditorBtn) {
            openEditorBtn.classList.add('visible');
        }
    }

    /**
     * Handle model loaded
     */
    async handleModelLoaded(model, file, isMesh = false, snapshot = null) {
        // Check if MJCF file (show simulation controls, don't auto-start simulation)
        const fileExt = file.name.split('.').pop().toLowerCase();
        const isMJCF = fileExt === 'xml' && model?.userData?.type === 'mjcf';

        // Clear MuJoCo simulation state when switching files
        if (this.mujocoSimulationManager && this.mujocoSimulationManager.hasScene()) {
            // Always clear simulation when switching files (MJCF or non-MJCF)
            this.mujocoSimulationManager.clearScene();
        }

        if (isMJCF && model.joints && model.joints.size > 0) {
            // Save model info for simulation
            this.currentMJCFFile = file;
            this.currentMJCFModel = model;

            // Show simulation control bar
            const simulationBar = document.getElementById('mujoco-simulation-bar');
            const resetBtn = document.getElementById('mujoco-reset-btn-bar');
            const simulateBtn = document.getElementById('mujoco-simulate-btn-bar');

            if (simulationBar) {
                simulationBar.style.display = 'flex';
            }

            // Enable buttons
            if (resetBtn) {
                resetBtn.disabled = false;
                resetBtn.style.opacity = '1';
                resetBtn.style.cursor = 'pointer';

                // Set localized text
                const resetSpan = resetBtn.querySelector('span');
                if (resetSpan) {
                    resetSpan.textContent = window.i18n?.t('mujocoReset') || 'Reset';
                }
            }

            if (simulateBtn) {
                simulateBtn.disabled = false;
                simulateBtn.style.opacity = '1';
                simulateBtn.style.cursor = 'pointer';
                simulateBtn.classList.remove('active');
                const span = simulateBtn.querySelector('span');
                if (span) {
                    // Use i18n to set correct text
                    span.textContent = window.i18n?.t('mujocoSimulate') || 'Simulate';
                }
            }
        } else {
            // Hide simulation control bar (non-MJCF files)
            const simulationBar = document.getElementById('mujoco-simulation-bar');
            if (simulationBar) simulationBar.style.display = 'none';

            this.currentMJCFFile = null;
            this.currentMJCFModel = null;
        }

        // Check if USD WASM model
        if (model?.userData?.isUSDWASM) {
            // Hide Three.js canvas, show USD viewer
            const canvas = document.getElementById('canvas');
            const usdContainer = document.getElementById('usd-viewer-container');
            if (canvas && usdContainer) {
                canvas.style.display = 'none';
                usdContainer.style.display = 'block';
            }

            // Hide joint controls and graph (USD WASM models don't support these features)
            const jointPanel = document.getElementById('joint-controls-panel');
            const graphPanel = document.getElementById('graph-panel');
            if (jointPanel) {
                jointPanel.style.display = 'none';
            }
            if (graphPanel) {
                graphPanel.style.display = 'none';
            }

            this.currentModel = model;
            this.updateModelInfo(model, file);

            if (this.diagnosticsView) {
                this.diagnosticsView.render(model, file);
            }

            // Hide snapshot if exists
            const snapshot = document.getElementById('canvas-snapshot');
            if (snapshot?.parentNode) {
                snapshot.parentNode.removeChild(snapshot);
            }

            this.renderReviewPanel();
            return;
        }

        // If regular model, ensure USD viewer is hidden
        let canvas = document.getElementById('canvas');
        const usdContainer = document.getElementById('usd-viewer-container');
        if (canvas && usdContainer) {
            canvas.style.display = 'block';
            usdContainer.style.display = 'none';
        }

        // Clear USD viewer if running
        if (this.usdViewerManager) {
            this.usdViewerManager.clear();
            this.usdViewerManager.hide();
        }

        // Restore joint controls and graph display
        const jointPanel = document.getElementById('joint-controls-panel');
        const graphPanel = document.getElementById('graph-panel');
        if (jointPanel) jointPanel.style.display = '';
        if (graphPanel) graphPanel.style.display = '';

        // Clear old model
        if (this.currentModel) {
            this.sceneManager.removeModel(this.currentModel);
            this.currentModel = null;
        }

        this.currentModel = model;

        // Force render current state first (important!)
        this.sceneManager.redraw();
        this.sceneManager.render();

        // Create snapshot (synchronous), before addModel
        canvas = document.getElementById('canvas');
        let loadingSnapshot = null;

        if (canvas) {
            try {
                const dataURL = canvas.toDataURL('image/png');

                loadingSnapshot = document.createElement('div');
                loadingSnapshot.id = 'canvas-snapshot';
                loadingSnapshot.style.cssText = `
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
                    canvasContainer.appendChild(loadingSnapshot);
                } else {
                    document.body.appendChild(loadingSnapshot);
                }
            } catch (error) {
                console.error('Failed to create snapshot:', error);
            }
        }

        // Define snapshot removal function
        let snapshotRemoving = false;
        const removeSnapshot = () => {
            if (loadingSnapshot && loadingSnapshot.parentNode && !snapshotRemoving) {
                snapshotRemoving = true;
                loadingSnapshot.style.transition = 'opacity 0.3s ease';
                loadingSnapshot.style.opacity = '0';

                setTimeout(() => {
                    if (loadingSnapshot && loadingSnapshot.parentNode) {
                        loadingSnapshot.parentNode.removeChild(loadingSnapshot);
                        loadingSnapshot = null;
                    }
                }, 300);
            }
        };

        // Safety mechanism: 5 second timeout
        const timeoutId = setTimeout(() => {
            if (loadingSnapshot && loadingSnapshot.parentNode) {
                console.error('Model loading timeout (5000ms)');
                removeSnapshot();
                this.sceneManager.off('modelReady', onModelReady);
            }
        }, 5000);

        // Listen for model ready event
        const onModelReady = () => {
            clearTimeout(timeoutId);
            removeSnapshot();
            this.sceneManager.off('modelReady', onModelReady);
        };
        this.sceneManager.on('modelReady', onModelReady);

        // Add to scene (render in background under snapshot)
        this.sceneManager.addModel(model);

        // Hide drop zone
        const dropZone = document.getElementById('drop-zone');
        if (dropZone) {
            dropZone.classList.remove('show');
            dropZone.classList.remove('drag-over');
        }

        if (!isMesh) {
            // Normal model
            this.sceneManager.setGroundVisible(true);
            this.jointControlsUI.setupJointControls(model);

            // Draw model graph
            if (this.modelGraphView) {
                this.modelGraphView.drawModelGraph(model);
            }

            // Show panels
            const graphPanel = document.getElementById('model-graph-panel');
            if (graphPanel) graphPanel.style.display = 'block';

            const jointsPanel = document.getElementById('joints-panel');
            if (jointsPanel) jointsPanel.style.display = 'block';

            // Hide axes by default
            this.setAxesButtonState(false);
        } else {
            // Mesh file
            this.sceneManager.setGroundVisible(false);

            // Clear and hide graph
            if (this.modelGraphView) {
                const svg = d3.select('#model-graph-svg');
                svg.selectAll('*:not(defs)').remove();
                const emptyState = document.getElementById('graph-empty-state');
                if (emptyState) {
                    emptyState.classList.remove('hidden');
                }
            }
            const graphPanel = document.getElementById('model-graph-panel');
            if (graphPanel) graphPanel.style.display = 'none';

            // Clear and hide joint controls area
            const jointContainer = document.getElementById('joint-controls');
            if (jointContainer) {
                jointContainer.innerHTML = '';
                const emptyState = document.createElement('div');
                emptyState.className = 'empty-state';
                emptyState.textContent = window.i18n.t('noModel');
                jointContainer.appendChild(emptyState);
            }
            const jointsPanel = document.getElementById('joints-panel');
            if (jointsPanel) jointsPanel.style.display = 'none';

            // Mesh files show axes by default
            this.setAxesButtonState(true);

            // Clear editor content (mesh files don't need editing)
            if (this.codeEditorManager) {
                this.codeEditorManager.clearEditor();
            }
        }

        // Update file tree: expand folders and scroll to file position
        // Note: don't update file tree on reload (avoid showing temp files)
        if (this.fileTreeView && !this._isReloading) {
            // Re-render tree to maintain expanded state
            this.fileTreeView.updateFileTree(
                this.fileHandler.getAvailableModels(),
                this.fileHandler.getFileMap(),
                true // Maintain expanded state
            );
            // Expand and scroll to current file
            this.fileTreeView.expandAndScrollToFile(file, this.fileHandler.getFileMap());
        }

        // Auto-open editor and load file (skip on reload)
        // Only robot model files (non-mesh files) are loaded into editor
        if (!this._isReloading && !isMesh) {
            const editorPanel = document.getElementById('code-editor-panel');
            if (editorPanel && this.codeEditorManager) {
                editorPanel.classList.add('visible');
                const openEditorBtn = document.getElementById('open-editor-btn');
                if (openEditorBtn) {
                    openEditorBtn.classList.add('active');
                }
                this.codeEditorManager.loadFile(file);
            }
        }

        // Update editor button visibility
        this.updateEditorButtonVisibility();

        // Update model info
        this.updateModelInfo(model, file);

        if (this.diagnosticsView) {
            this.diagnosticsView.render(model, file);
        }

        this.renderReviewPanel();
    }

    /**
     * Setup canvas click handler
     */
    setupCanvasClickHandler(canvas) {
        let mouseDownPos = null;
        let mouseDownTime = 0;

        canvas.addEventListener('mousedown', (event) => {
            if (event.button === 0) {
                mouseDownPos = { x: event.clientX, y: event.clientY };
                mouseDownTime = Date.now();
            }
        }, true);

        canvas.addEventListener('mouseup', (event) => {
            if (event.button !== 0 || !this.sceneManager || !mouseDownPos) return;

            const dx = event.clientX - mouseDownPos.x;
            const dy = event.clientY - mouseDownPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const duration = Date.now() - mouseDownTime;

            if (distance < 5 && duration < 300) {
                const raycaster = new THREE.Raycaster();
                const mouse = new THREE.Vector2();

                const rect = canvas.getBoundingClientRect();
                mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

                raycaster.setFromCamera(mouse, this.sceneManager.camera);
                const intersects = raycaster.intersectObjects(this.sceneManager.scene.children, true);

                const modelIntersects = intersects.filter(intersect => {
                    const obj = intersect.object;
                    let current = obj;
                    while (current) {
                        const name = current.name || '';
                        if (name.includes('jointAxis') || name.includes('helper') ||
                            name.includes('grid') || name.includes('Ground') ||
                            name === 'groundPlane') {
                            return false;
                        }
                        current = current.parent;
                    }
                    return obj.isMesh && obj.visible;
                });

                if (this.review3DSelectionEnabled && modelIntersects.length > 0) {
                    const selectionResult = this.selectReviewTargetFromSceneObject(modelIntersects[0].object);
                    if (!selectionResult) {
                        this.showSnapshotToast(window.i18n?.t('review3DSelectionUnavailable') || 'Could not resolve a review target from this object.', 'warning');
                    }
                } else if (modelIntersects.length === 0) {
                    this.clearReviewSelection();
                }
            }

            mouseDownPos = null;
        }, true);
    }

    /**
     * Setup model tree panel
     */
    setupModelTreePanel() {
        const toggleBtn = document.getElementById('toggle-model-tree');
        const floatingPanel = document.getElementById('floating-model-tree');

        if (toggleBtn && floatingPanel) {
            floatingPanel.style.display = 'flex';
            toggleBtn.classList.add('active');
        }

        if (floatingPanel) {
            // Click blank area to deselect
            floatingPanel.addEventListener('click', (event) => {
                const target = event.target;

                if (target === floatingPanel ||
                    target.classList?.contains('graph-controls-hint') ||
                    target.classList?.contains('empty-state') ||
                    target.id === 'floating-model-tree') {
                    this.clearReviewSelection();
                }
            });
        }
    }

    clearReviewSelection(options = {}) {
        const { clearDiagnosticsFocus = true } = options;
        this.reviewDirectSelection = null;
        this.fileTreeView?.clearSelectedFile?.();

        if (this.modelGraphView?.currentSvg) {
            this.modelGraphView.clearAllSelections(this.modelGraphView.currentSvg);
        }

        if (this.measurementController) {
            this.measurementController.clearMeasurement();
        }

        if (this.sceneManager) {
            this.sceneManager.highlightManager.clearHighlight();
            this.sceneManager.axesManager.restoreAllJointAxes();
        }

        if (this.diagnosticsView) {
            this.diagnosticsView.clearSelectedDiagnostic();
            if (clearDiagnosticsFocus) {
                this.diagnosticsView.focusTarget(null, null, false, true);
            }
        }

        this.renderReviewPanel();
    }

    setReview3DSelectionEnabled(enabled) {
        this.review3DSelectionEnabled = Boolean(enabled);
        this.reviewPanelView?.set3DSelectionEnabled(this.review3DSelectionEnabled);
        return this.review3DSelectionEnabled;
    }

    toggleReview3DSelection() {
        const enabled = this.setReview3DSelectionEnabled(!this.review3DSelectionEnabled);
        const message = enabled
            ? (window.i18n?.t('review3DSelectionEnabled') || '3D part selection for review is enabled.')
            : (window.i18n?.t('review3DSelectionDisabled') || '3D part selection for review is disabled.');
        this.showSnapshotToast(message, enabled ? 'info' : 'warning');
        return enabled;
    }

    buildReviewResourceAnchor(fileInfo) {
        if (!fileInfo) {
            return null;
        }

        const filePath = normalizePath(fileInfo.path || fileInfo.file?.webkitRelativePath || fileInfo.file?.name || fileInfo.name || '');
        const fileName = fileInfo.name || fileInfo.file?.name || filePath.split('/').pop() || '';
        const extension = (fileInfo.ext || fileName.split('.').pop() || '').toLowerCase();

        if (!filePath && !fileName) {
            return null;
        }

        return {
            kind: 'resource',
            filePath,
            fileName,
            extension
        };
    }

    resolveReviewFileInfo(resourceAnchor) {
        const fileMap = this.fileHandler?.getFileMap?.();
        if (!(fileMap instanceof Map) || fileMap.size === 0) {
            return null;
        }

        const targetPath = normalizePath(resourceAnchor?.filePath || '');
        const targetFileName = resourceAnchor?.fileName || '';
        let matchedPath = '';
        let matchedFile = null;

        for (const [path, file] of fileMap.entries()) {
            const normalizedCandidatePath = normalizePath(path || file?.webkitRelativePath || file?.name || '');
            if (targetPath && normalizedCandidatePath === targetPath) {
                matchedPath = normalizedCandidatePath;
                matchedFile = file;
                break;
            }

            if (!targetPath && targetFileName && file?.name === targetFileName) {
                matchedPath = normalizedCandidatePath || normalizePath(targetFileName);
                matchedFile = file;
                break;
            }
        }

        if (!matchedFile) {
            return null;
        }

        const loadableFileInfo = (this.fileHandler?.getAvailableModels?.() || []).find(fileInfo => {
            return fileInfo.file === matchedFile || normalizePath(fileInfo.path) === matchedPath;
        }) || null;

        const fileName = matchedFile.name || targetFileName || matchedPath.split('/').pop() || '';
        const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';

        return {
            file: matchedFile,
            name: fileName,
            path: matchedPath || normalizePath(fileName),
            ext,
            category: loadableFileInfo?.category || 'resource',
            type: loadableFileInfo?.type || 'resource'
        };
    }

    focusReviewResource(resourceAnchor, options = {}) {
        const { loadFile = true, scroll = true } = options;
        const fileInfo = this.resolveReviewFileInfo(resourceAnchor);
        if (!fileInfo) {
            return false;
        }

        const normalizedAnchor = this.buildReviewResourceAnchor(fileInfo);
        if (!normalizedAnchor) {
            return false;
        }

        this.fileTreeView?.selectFileByPath(normalizedAnchor.filePath, { scroll });
        this.reviewDirectSelection = this.cloneReviewAnchor(normalizedAnchor);
        this.renderReviewPanel();

        if (!loadFile) {
            return true;
        }

        if (fileInfo.category === 'model') {
            this.fileHandler.loadFile(fileInfo.file);

            const editorPanel = document.getElementById('code-editor-panel');
            if (editorPanel && editorPanel.classList.contains('visible') && this.codeEditorManager) {
                this.codeEditorManager.loadFile(fileInfo.file);
            }
        } else if (fileInfo.category === 'mesh') {
            this.fileHandler.loadMeshAsModel(fileInfo.file, fileInfo.name);
        }

        return true;
    }

    selectReviewAnchor(anchor, options = {}) {
        const normalizedAnchor = this.cloneReviewAnchor(anchor);
        if (!normalizedAnchor) {
            return false;
        }

        this.setReview3DSelectionEnabled(false);

        if (normalizedAnchor.kind === 'resource') {
            this.clearReviewSelection();
            return this.focusReviewResource(normalizedAnchor, {
                loadFile: options.loadFile !== false,
                scroll: options.scroll !== false
            });
        }

        this.reviewDirectSelection = null;
        this.fileTreeView?.clearSelectedFile?.();

        if (normalizedAnchor.kind === 'diagnostic') {
            const restored = this.diagnosticsView?.selectDiagnosticByAnchor(normalizedAnchor.anchor, { scroll: true });
            if (restored) {
                this.renderReviewPanel();
            }
            return Boolean(restored);
        }

        if (normalizedAnchor.kind === 'link' || normalizedAnchor.kind === 'joint') {
            const restored = this.modelGraphView?.selectTarget(normalizedAnchor.kind, normalizedAnchor.targetName, {
                syncScene: options.syncScene !== false,
                syncDiagnostics: options.syncDiagnostics !== false,
                syncEditor: Boolean(options.syncEditor),
                clearMeasurement: options.clearMeasurement !== false,
                scrollDiagnostics: Boolean(options.scrollDiagnostics)
            });
            if (restored) {
                this.renderReviewPanel();
            }
            return Boolean(restored);
        }

        return false;
    }

    findLinkBySceneObject(sceneObject) {
        if (!sceneObject || !this.currentModel?.links) {
            return null;
        }

        let current = sceneObject;
        while (current) {
            const explicitLinkName = current.userData?.reviewLinkName;
            if (explicitLinkName && this.currentModel.links.has(explicitLinkName)) {
                return this.currentModel.links.get(explicitLinkName);
            }

            if (current.name && this.currentModel.links.has(current.name)) {
                return this.currentModel.links.get(current.name);
            }

            current = current.parent;
        }

        for (const link of this.currentModel.links.values()) {
            let probe = sceneObject;
            while (probe) {
                if (probe === link.threeObject) {
                    return link;
                }
                probe = probe.parent;
            }
        }

        return null;
    }

    findJointBySceneObject(sceneObject) {
        if (!sceneObject || !this.currentModel?.joints) {
            return null;
        }

        let current = sceneObject;
        while (current) {
            if (current.name && this.currentModel.joints.has(current.name)) {
                return this.currentModel.joints.get(current.name);
            }
            current = current.parent;
        }

        return null;
    }

    selectReviewTargetFromSceneObject(sceneObject) {
        const joint = this.findJointBySceneObject(sceneObject);
        if (joint?.name) {
            const selected = this.selectReviewAnchor({
                kind: 'joint',
                targetName: joint.name
            }, {
                syncEditor: true,
                scrollDiagnostics: true
            });
            if (selected) {
                this.setReview3DSelectionEnabled(false);
            }
            return selected;
        }

        const link = this.findLinkBySceneObject(sceneObject);
        if (link?.name) {
            const selected = this.selectReviewAnchor({
                kind: 'link',
                targetName: link.name
            }, {
                syncEditor: true,
                scrollDiagnostics: true
            });
            if (selected) {
                this.setReview3DSelectionEnabled(false);
            }
            return selected;
        }

        return false;
    }

    cloneReviewAnchor(anchor) {
        if (!anchor) {
            return null;
        }

        if (anchor.kind === 'resource') {
            return {
                kind: 'resource',
                filePath: normalizePath(anchor.filePath || ''),
                fileName: anchor.fileName || '',
                extension: anchor.extension || ''
            };
        }

        if (anchor.kind === 'diagnostic') {
            return {
                kind: 'diagnostic',
                anchor: anchor.anchor ? { ...anchor.anchor } : null
            };
        }

        return {
            kind: anchor.kind,
            targetName: anchor.targetName
        };
    }

    cloneReviewComment(comment) {
        return {
            id: comment.id,
            body: comment.body,
            createdAt: comment.createdAt,
            anchor: this.cloneReviewAnchor(comment.anchor)
        };
    }

    setDirectReviewSelection(anchor) {
        this.reviewDirectSelection = this.cloneReviewAnchor(anchor);
        this.renderReviewPanel();
    }

    getReviewComments() {
        return this.reviewComments.map(comment => this.cloneReviewComment(comment));
    }

    setReviewComments(comments = []) {
        this.reviewComments = Array.isArray(comments)
            ? comments
                .map(comment => this.cloneReviewComment(comment))
                .filter(comment => comment && comment.id && comment.body && comment.anchor)
            : [];
        this.renderReviewPanel();
    }

    getCurrentReviewAnchor() {
        return this.captureSelectionState();
    }

    renderReviewPanel() {
        if (!this.reviewPanelView) {
            return;
        }

        this.reviewPanelView.setCurrentAnchor(this.getCurrentReviewAnchor());
        this.reviewPanelView.setComments(this.getReviewComments());
    }

    generateReviewCommentId() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }

        return `comment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    addReviewComment(body, anchor = this.getCurrentReviewAnchor()) {
        const normalizedBody = typeof body === 'string' ? body.trim() : '';
        if (!normalizedBody) {
            this.showSnapshotToast(window.i18n?.t('reviewCommentEmpty') || 'Enter a comment before adding it.', 'warning');
            return false;
        }

        const normalizedAnchor = this.cloneReviewAnchor(anchor);
        if (!normalizedAnchor) {
            this.showSnapshotToast(window.i18n?.t('reviewCommentNoTarget') || 'Select a link, joint, or diagnostic first.', 'warning');
            return false;
        }

        this.reviewComments.push({
            id: this.generateReviewCommentId(),
            body: normalizedBody,
            createdAt: new Date().toISOString(),
            anchor: normalizedAnchor
        });

        this.renderReviewPanel();
        this.showSnapshotToast(window.i18n?.t('reviewCommentAdded') || 'Review comment added.', 'success');
        return true;
    }

    updateReviewComment(commentId, body) {
        const normalizedBody = typeof body === 'string' ? body.trim() : '';
        if (!commentId || !normalizedBody) {
            this.showSnapshotToast(window.i18n?.t('reviewCommentEmpty') || 'Enter a comment before adding it.', 'warning');
            return false;
        }

        const targetComment = this.reviewComments.find(comment => comment.id === commentId);
        if (!targetComment) {
            this.showSnapshotToast(window.i18n?.t('reviewCommentFocusFailed') || 'Could not focus the target for this comment.', 'warning');
            return false;
        }

        targetComment.body = normalizedBody;
        this.renderReviewPanel();
        this.showSnapshotToast(window.i18n?.t('reviewCommentUpdated') || 'Review comment updated.', 'success');
        return true;
    }

    deleteReviewComment(commentId) {
        if (!commentId) {
            return false;
        }

        const originalLength = this.reviewComments.length;
        this.reviewComments = this.reviewComments.filter(comment => comment.id !== commentId);
        if (this.reviewComments.length === originalLength) {
            return false;
        }

        this.renderReviewPanel();
        this.showSnapshotToast(window.i18n?.t('reviewCommentDeleted') || 'Review comment deleted.', 'success');
        return true;
    }

    focusReviewAnchor(anchor) {
        const result = this.applySelectionSnapshot(anchor);
        if (!result.restored) {
            this.showSnapshotToast(result.message, 'warning');
            return false;
        }

        this.renderReviewPanel();
        return true;
    }

    focusReviewComment(comment) {
        if (!comment?.anchor) {
            return false;
        }

        return this.focusReviewAnchor(comment.anchor);
    }

    getCurrentModelMetadata() {
        const currentFile = this.fileHandler?.getCurrentModelFile();
        let filePath = currentFile?.name || '';

        if (currentFile && this.fileHandler?.getFileMap) {
            for (const [path, file] of this.fileHandler.getFileMap().entries()) {
                if (file === currentFile) {
                    filePath = path;
                    break;
                }
            }
        }

        return {
            filePath,
            fileName: currentFile?.name || '',
            fileType: this.currentModel?.userData?.fileType || ''
        };
    }

    captureCameraState() {
        if (!this.sceneManager) {
            return {
                mode: 'unavailable',
                reason: window.i18n?.t('snapshotNoCameraState') || 'No restorable camera state is available.'
            };
        }

        if (this.currentModel?.userData?.isUSDWASM) {
            return {
                mode: 'unavailable',
                reason: window.i18n?.t('snapshotUsdCameraUnsupported') || 'USD camera state cannot be restored yet.'
            };
        }

        const upSelect = document.getElementById('up-select');
        const { camera, controls } = this.sceneManager;
        return {
            mode: 'three',
            up: upSelect?.value || '+Z',
            position: [camera.position.x, camera.position.y, camera.position.z],
            target: [controls.target.x, controls.target.y, controls.target.z]
        };
    }

    captureJointState() {
        const values = {};
        if (!this.currentModel?.joints) {
            return { values };
        }

        this.currentModel.joints.forEach((joint, jointName) => {
            if (joint.type === 'fixed') {
                return;
            }

            if (Number.isFinite(joint.currentValue)) {
                values[jointName] = joint.currentValue;
            }
        });

        return { values };
    }

    captureSelectionState() {
        if (this.reviewDirectSelection) {
            return this.cloneReviewAnchor(this.reviewDirectSelection);
        }

        const selectedDiagnosticAnchor = this.diagnosticsView?.getSelectedDiagnosticAnchor();
        if (selectedDiagnosticAnchor) {
            return {
                kind: 'diagnostic',
                anchor: selectedDiagnosticAnchor
            };
        }

        const selectedTarget = this.modelGraphView?.getSelectedTarget();
        if (selectedTarget?.targetType && selectedTarget?.targetName) {
            return {
                kind: selectedTarget.targetType,
                targetName: selectedTarget.targetName
            };
        }

        const focusedTarget = this.diagnosticsView?.getSnapshotState().focusedTarget;
        if (focusedTarget?.targetType && focusedTarget?.targetName) {
            return {
                kind: focusedTarget.targetType,
                targetName: focusedTarget.targetName
            };
        }

        return null;
    }

    captureReviewSnapshot() {
        return createReviewSnapshot({
            model: this.getCurrentModelMetadata(),
            comments: this.getReviewComments(),
            context: {
                camera: this.captureCameraState(),
                selection: this.captureSelectionState(),
                jointState: this.captureJointState(),
                diagnostics: this.diagnosticsView?.getSnapshotState() || {
                    filters: {
                        level: 'all',
                        focusedOnly: false
                    },
                    focusedTarget: null
                }
            }
        });
    }

    buildReviewSnapshotFileName(snapshot) {
        const baseName = snapshot?.model?.fileName
            ? snapshot.model.fileName.replace(/\.[^.]+$/, '')
            : 'review';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `${baseName || 'review'}-snapshot-${timestamp}.json`;
    }

    downloadTextFile(content, fileName, mimeType = 'application/json') {
        const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    handleExportReviewSnapshot() {
        const snapshot = this.captureReviewSnapshot();
        const json = stringifyReviewSnapshot(snapshot);
        this.downloadTextFile(json, this.buildReviewSnapshotFileName(snapshot));
        this.showSnapshotToast(window.i18n?.t('snapshotExported') || 'Review snapshot exported.', 'success');
    }

    async handleImportReviewSnapshot(file) {
        try {
            const json = await file.text();
            const snapshot = parseReviewSnapshot(json);
            const report = this.applyReviewSnapshot(snapshot);
            this.showSnapshotRestoreReport(report);
        } catch (error) {
            this.showSnapshotRestoreReport({
                restored: [],
                notRestored: [
                    `${window.i18n?.t('snapshotImportFailed') || 'Snapshot import failed'}: ${error.message}`
                ],
                warnings: []
            });
        }
    }

    applyReviewSnapshot(snapshot) {
        const report = {
            restored: [],
            notRestored: [],
            warnings: []
        };

        const currentModel = this.getCurrentModelMetadata();
        if (snapshot.model?.filePath && currentModel.filePath && snapshot.model.filePath !== currentModel.filePath) {
            report.warnings.push(
                `${window.i18n?.t('snapshotModelMismatch') || 'Snapshot was created for a different file'}: ${snapshot.model.filePath}`
            );
        }

        const cameraResult = this.applyCameraSnapshot(snapshot.context.camera);
        if (cameraResult.restored) {
            report.restored.push(cameraResult.message);
        } else if (cameraResult.message) {
            report.notRestored.push(cameraResult.message);
        }

        const diagnosticsResult = this.applyDiagnosticsSnapshot(snapshot.context.diagnostics);
        if (diagnosticsResult.restored) {
            report.restored.push(diagnosticsResult.message);
        } else if (diagnosticsResult.message) {
            report.notRestored.push(diagnosticsResult.message);
        }

        const jointResult = this.applyJointSnapshot(snapshot.context.jointState);
        if (jointResult.restored) {
            report.restored.push(jointResult.message);
        } else if (jointResult.message) {
            report.notRestored.push(jointResult.message);
        }
        if (jointResult.warning) {
            report.warnings.push(jointResult.warning);
        }

        const commentsResult = this.applyReviewComments(snapshot.comments);
        if (commentsResult.restored) {
            report.restored.push(commentsResult.message);
        } else if (commentsResult.message) {
            report.notRestored.push(commentsResult.message);
        }

        const selectionResult = this.applySelectionSnapshot(snapshot.context.selection);
        if (selectionResult.restored) {
            report.restored.push(selectionResult.message);
        } else if (selectionResult.message) {
            report.notRestored.push(selectionResult.message);
        }

        return report;
    }

    applyCameraSnapshot(cameraState) {
        if (!cameraState) {
            return {
                restored: false,
                message: window.i18n?.t('snapshotCameraMissing') || 'Camera could not be restored: snapshot does not contain camera state.'
            };
        }

        if (cameraState.mode !== 'three') {
            return {
                restored: false,
                message: cameraState.reason || window.i18n?.t('snapshotCameraUnsupported') || 'Camera could not be restored in this view mode.'
            };
        }

        if (!this.sceneManager || this.currentModel?.userData?.isUSDWASM) {
            return {
                restored: false,
                message: window.i18n?.t('snapshotUsdCameraUnsupported') || 'USD camera state cannot be restored yet.'
            };
        }

        const upSelect = document.getElementById('up-select');
        if (upSelect) {
            upSelect.value = cameraState.up || '+Z';
        }

        this.sceneManager.setUp(cameraState.up || '+Z');
        this.sceneManager.camera.position.set(...cameraState.position);
        this.sceneManager.controls.target.set(...cameraState.target);
        this.sceneManager.controls.update();
        this.sceneManager.camera.updateProjectionMatrix();
        this.sceneManager.redraw();
        this.sceneManager.render();

        return {
            restored: true,
            message: window.i18n?.t('snapshotCameraRestored') || 'Camera restored.'
        };
    }

    applyDiagnosticsSnapshot(diagnosticsState) {
        if (!this.diagnosticsView) {
            return {
                restored: false,
                message: window.i18n?.t('snapshotDiagnosticsUnavailable') || 'Diagnostics filters could not be restored.'
            };
        }

        this.diagnosticsView.applySnapshotState(diagnosticsState || {});
        return {
            restored: true,
            message: window.i18n?.t('snapshotDiagnosticsRestored') || 'Diagnostics filters restored.'
        };
    }

    applyJointSnapshot(jointState) {
        const entries = Object.entries(jointState?.values || {});
        if (!entries.length) {
            return {
                restored: true,
                message: window.i18n?.t('snapshotJointStateEmpty') || 'No joint state was stored in the snapshot.'
            };
        }

        if (!this.currentModel?.joints || this.currentModel.userData?.isUSDWASM) {
            return {
                restored: false,
                message: window.i18n?.t('snapshotJointStateUnavailable') || 'Joint state could not be restored for the current model.'
            };
        }

        const restored = [];
        const missing = [];

        entries.forEach(([jointName, value]) => {
            const joint = this.currentModel.joints.get(jointName);
            if (!joint || joint.type === 'fixed') {
                missing.push(jointName);
                return;
            }

            ModelLoaderFactory.setJointAngle(this.currentModel, jointName, value, true);
            joint.currentValue = value;
            restored.push(jointName);

            if (this.sceneManager?.constraintManager) {
                this.sceneManager.constraintManager.applyConstraints(this.currentModel, joint);
            }
        });

        this.syncJointControlsFromModel();

        if (this.sceneManager) {
            this.sceneManager.updateEnvironment();
            this.sceneManager.redraw();
            this.sceneManager.render();
            if (this.sceneManager.onMeasurementUpdate) {
                this.sceneManager.onMeasurementUpdate();
            }
        }

        return {
            restored: restored.length > 0,
            message: restored.length > 0
                ? `${window.i18n?.t('snapshotJointStateRestored') || 'Joint state restored'}: ${restored.length}`
                : window.i18n?.t('snapshotJointStateUnavailable') || 'Joint state could not be restored for the current model.',
            warning: missing.length > 0
                ? `${window.i18n?.t('snapshotJointStateMissing') || 'Missing joints during restore'}: ${missing.join(', ')}`
                : ''
        };
    }

    syncJointControlsFromModel() {
        if (!this.currentModel?.joints) {
            return;
        }

        const useDegrees = document.querySelector('#unit-deg.active');
        document.querySelectorAll('.joint-slider').forEach(slider => {
            const jointName = slider.getAttribute('data-joint');
            const joint = jointName ? this.currentModel.joints.get(jointName) : null;
            if (!joint || !Number.isFinite(joint.currentValue)) {
                return;
            }

            slider.value = joint.currentValue;

            const valueInput = document.querySelector(`input[data-joint-input="${jointName}"]`);
            if (valueInput) {
                valueInput.value = useDegrees
                    ? (joint.currentValue * 180 / Math.PI).toFixed(1)
                    : joint.currentValue.toFixed(2);
            }
        });
    }

    applyReviewComments(comments = []) {
        this.setReviewComments(comments || []);

        return {
            restored: true,
            message: `${window.i18n?.t('reviewCommentsImported') || 'Review comments imported'}: ${this.reviewComments.length}`
        };
    }

    applySelectionSnapshot(selection) {
        this.clearReviewSelection({ clearDiagnosticsFocus: false });

        if (!selection) {
            return {
                restored: true,
                message: window.i18n?.t('snapshotSelectionCleared') || 'Selection cleared.'
            };
        }

        if (selection.kind === 'diagnostic') {
            const restored = this.diagnosticsView?.selectDiagnosticByAnchor(selection.anchor, { scroll: true });
            return restored
                ? {
                    restored: true,
                    message: window.i18n?.t('snapshotSelectionRestored') || 'Selection restored.'
                }
                : {
                    restored: false,
                    message: window.i18n?.t('snapshotDiagnosticSelectionMissing') || 'Diagnostic selection could not be found in the current diagnostics.'
                };
        }

        if (selection.kind === 'resource') {
            const restored = this.focusReviewResource(selection, { loadFile: true, scroll: true });
            return restored
                ? {
                    restored: true,
                    message: window.i18n?.t('snapshotSelectionRestored') || 'Selection restored.'
                }
                : {
                    restored: false,
                    message: `${window.i18n?.t('snapshotSelectionMissing') || 'Selection target could not be found'}: ${selection.filePath || selection.fileName || ''}`
                };
        }

        if (selection.kind === 'link' || selection.kind === 'joint') {
            const restored = this.modelGraphView?.selectTarget(selection.kind, selection.targetName, {
                syncEditor: false,
                scrollDiagnostics: true
            });

            return restored
                ? {
                    restored: true,
                    message: window.i18n?.t('snapshotSelectionRestored') || 'Selection restored.'
                }
                : {
                    restored: false,
                    message: `${window.i18n?.t('snapshotSelectionMissing') || 'Selection target could not be found'}: ${selection.targetName}`
                };
        }

        return {
            restored: false,
            message: window.i18n?.t('snapshotSelectionMissing') || 'Selection target could not be found.'
        };
    }

    showSnapshotToast(message, type = 'info') {
        let toast = document.getElementById('snapshot-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'snapshot-toast';
            toast.style.cssText = `
                position: fixed;
                top: 88px;
                right: 20px;
                max-width: 360px;
                padding: 12px 16px;
                border-radius: 12px;
                color: white;
                font-size: 13px;
                line-height: 1.5;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
                z-index: 120;
                backdrop-filter: blur(12px);
            `;
            document.body.appendChild(toast);
        }

        const colors = {
            success: 'rgba(74, 222, 128, 0.92)',
            error: 'rgba(255, 107, 107, 0.94)',
            warning: 'rgba(251, 191, 36, 0.94)',
            info: 'rgba(74, 158, 255, 0.94)'
        };

        toast.style.background = colors[type] || colors.info;
        toast.textContent = message;

        clearTimeout(this.snapshotToastTimer);
        this.snapshotToastTimer = setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    showSnapshotRestoreReport(report) {
        const existing = document.getElementById('snapshot-restore-report');
        if (existing) {
            existing.remove();
        }

        const panel = document.createElement('div');
        panel.id = 'snapshot-restore-report';
        panel.style.cssText = `
            position: fixed;
            top: 88px;
            right: 20px;
            width: min(420px, calc(100vw - 40px));
            max-height: min(70vh, 520px);
            overflow: auto;
            padding: 16px;
            border-radius: 16px;
            background: var(--glass-bg);
            color: var(--text-primary);
            border: 1px solid var(--glass-border);
            box-shadow: 0 18px 42px rgba(0, 0, 0, 0.22);
            backdrop-filter: blur(18px) saturate(150%);
            z-index: 121;
        `;

        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;';

        const title = document.createElement('div');
        title.textContent = window.i18n?.t('snapshotRestoreReportTitle') || 'Snapshot restore report';
        title.style.cssText = 'font-size:14px;font-weight:600;';
        titleRow.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
            border:none;
            border-radius:8px;
            width:24px;
            height:24px;
            cursor:pointer;
            background: rgba(255, 255, 255, 0.08);
            color: var(--text-secondary);
        `;
        closeBtn.addEventListener('click', () => panel.remove());
        titleRow.appendChild(closeBtn);
        panel.appendChild(titleRow);

        const createSection = (label, items, color) => {
            if (!items.length) {
                return null;
            }

            const section = document.createElement('div');
            section.style.cssText = 'margin-bottom:12px;';

            const heading = document.createElement('div');
            heading.textContent = label;
            heading.style.cssText = `font-size:12px;font-weight:600;color:${color};margin-bottom:6px;`;
            section.appendChild(heading);

            items.forEach(item => {
                const line = document.createElement('div');
                line.textContent = `- ${item}`;
                line.style.cssText = 'font-size:12px;line-height:1.5;margin-bottom:4px;white-space:pre-wrap;';
                section.appendChild(line);
            });

            return section;
        };

        const restoredSection = createSection(
            window.i18n?.t('snapshotRestored') || 'Restored',
            report.restored || [],
            '#4ade80'
        );
        const notRestoredSection = createSection(
            window.i18n?.t('snapshotNotRestored') || 'Could not restore',
            report.notRestored || [],
            '#ff9b9b'
        );
        const warningsSection = createSection(
            window.i18n?.t('snapshotWarnings') || 'Warnings',
            report.warnings || [],
            '#fbbf24'
        );

        if (restoredSection) panel.appendChild(restoredSection);
        if (notRestoredSection) panel.appendChild(notRestoredSection);
        if (warningsSection) panel.appendChild(warningsSection);

        if (!restoredSection && !notRestoredSection && !warningsSection) {
            const empty = document.createElement('div');
            empty.textContent = window.i18n?.t('snapshotNothingToReport') || 'Nothing to report.';
            empty.style.cssText = 'font-size:12px;line-height:1.5;';
            panel.appendChild(empty);
        }

        document.body.appendChild(panel);

        clearTimeout(this.snapshotReportTimer);
        this.snapshotReportTimer = setTimeout(() => {
            panel.remove();
        }, 12000);
    }

    /**
     * Update model info display
     */
    updateModelInfo(model, file) {
        const statusInfo = document.getElementById('status-info');
        if (!statusInfo || !model) return;

        let info = `<strong>${file.name}</strong><br>`;

        const fileType = file.name.split('.').pop().toLowerCase();
        info += `Type: ${fileType.toUpperCase()}<br>`;

        if (model.links) {
            info += `Links: ${model.links.size}<br>`;
        }

        if (model.joints) {
            const controllableJoints = Array.from(model.joints.values()).filter(j => j.type !== 'fixed').length;
            info += `Joints: ${model.joints.size} (${controllableJoints} controllable)<br>`;
        }

        // Show constraint info (parallel mechanism)
        if (model.constraints && model.constraints.size > 0) {
            info += `<span style="color: #00aaff; font-weight: bold;">Constraints: ${model.constraints.size} 🔗</span><br>`;

            // Count different constraint types
            const constraintTypes = {};
            model.constraints.forEach((constraint) => {
                constraintTypes[constraint.type] = (constraintTypes[constraint.type] || 0) + 1;
            });

            // Show constraint type details
            const typeLabels = {
                'connect': 'Connect',
                'weld': 'Weld',
                'joint': 'Joint Coupling',
                'distance': 'Distance'
            };

            const typeDetails = Object.entries(constraintTypes)
                .map(([type, count]) => `${typeLabels[type] || type}: ${count}`)
                .join(', ');

            info += `<span style="font-size: 11px; color: #888;">${typeDetails}</span><br>`;
        }

        if (model.rootLink) {
            info += `Root Link: ${model.rootLink}`;
        }

        statusInfo.innerHTML = info;
        statusInfo.className = 'success';
    }

    /**
     * Handle file click
     */
    handleFileClick(fileInfo) {
        const anchor = this.buildReviewResourceAnchor(fileInfo);
        if (!anchor) {
            return;
        }

        this.selectReviewAnchor(anchor, {
            loadFile: true,
            scroll: false
        });
    }

    /**
     * Create USD viewer container
     */
    createUSDViewerContainer() {
        // Create USD viewer container in canvas container
        const canvasContainer = document.getElementById('canvas-container');
        if (!canvasContainer) {
            return;
        }

        const usdContainer = document.createElement('div');
        usdContainer.id = 'usd-viewer-container';
        usdContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            display: none;
            z-index: 1;
            pointer-events: none;
        `;
        canvasContainer.appendChild(usdContainer);
    }

    /**
     * Get or create USD viewer manager (lazy loading)
     */
    async getUSDViewerManager() {
        if (!this.usdViewerManager) {
            const container = document.getElementById('usd-viewer-container');
            if (!container) {
                throw new Error('USD viewer container not found');
            }

            this.usdViewerManager = new USDViewerManager(container);
            this.fileHandler.setUSDViewerManager(this.usdViewerManager);

            // Listen for loading progress
            this.usdViewerManager.on('USD_LOADING_START', (event) => {
                const message = event.data?.message || 'Loading USD...';
                const statusInfo = document.getElementById('status-info');
                if (statusInfo) {
                    statusInfo.textContent = message;
                    statusInfo.className = 'info';
                }
            });

            this.usdViewerManager.on('USD_LOADED', () => {
                const statusInfo = document.getElementById('status-info');
                if (statusInfo) {
                    statusInfo.textContent = 'USD file loaded successfully';
                    statusInfo.className = 'success';
                }
            });

            this.usdViewerManager.on('USD_ERROR', (event) => {
                const error = event.data?.error || 'Load failed';
                const statusInfo = document.getElementById('status-info');
                if (statusInfo) {
                    statusInfo.textContent = `Load failed: ${error}`;
                    statusInfo.className = 'error';
                }
            });
        }

        return this.usdViewerManager;
    }

    /**
     * Handle theme change
     */
    handleThemeChanged(theme) {
        if (this.codeEditorManager) {
            this.codeEditorManager.updateTheme(theme);
        }
        if (this.currentModel && this.modelGraphView) {
            this.modelGraphView.drawModelGraph(this.currentModel);
        }
    }

    /**
     * Handle angle unit change
     */
    handleAngleUnitChanged(unit) {
        this.angleUnit = unit;
        if (this.jointControlsUI) {
            this.jointControlsUI.setAngleUnit(unit);
        }
    }

    /**
     * Handle reset joints button
     */
    handleResetJoints() {
        if (this.currentModel && this.jointControlsUI) {
            this.jointControlsUI.resetAllJoints(this.currentModel);
        }
    }

    /**
     * Handle ignore limits toggle
     */
    handleIgnoreLimitsChanged(ignore) {
        if (this.jointControlsUI && this.currentModel) {
            this.jointControlsUI.updateAllSliderLimits(this.currentModel, ignore);
        }
    }

    /**
     * Handle language change
     */
    handleLanguageChanged(lang) {
        i18n.setLanguage(lang);

        // Update code editor save status text
        if (this.codeEditorManager) {
            this.codeEditorManager.updateEditorSaveStatus();
        }

        // Update joint controls panel (if model exists)
        if (this.currentModel && this.jointControlsUI) {
            this.jointControlsUI.setupJointControls(this.currentModel);
        }

        // Redraw model graph (if current model exists)
        if (this.currentModel && this.modelGraphView) {
            this.modelGraphView.drawModelGraph(this.currentModel);
        }

        // Update file tree view (preserve expanded state)
        if (this.fileTreeView && this.fileHandler) {
            this.fileTreeView.updateFileTree(
                this.fileHandler.getAvailableModels(),
                this.fileHandler.getFileMap(),
                true
            );
        }

        // Update simulation button text
        const simulateBtn = document.getElementById('mujoco-simulate-btn-bar');
        if (simulateBtn) {
            const span = simulateBtn.querySelector('span');
            if (span) {
                const isActive = simulateBtn.classList.contains('active');
                const key = isActive ? 'mujocoPause' : 'mujocoSimulate';
                span.textContent = i18n.t(key);
                span.setAttribute('data-i18n', key);
            }
        }

        if (this.diagnosticsView) {
            this.diagnosticsView.render(this.currentModel, this.fileHandler?.getCurrentModelFile());
        }

        this.renderReviewPanel();
    }

    /**
     * Set axes button state
     */
    setAxesButtonState(show) {
        const axesBtn = document.getElementById('toggle-axes-btn');
        if (!axesBtn) return;

        axesBtn.setAttribute('data-checked', show.toString());
        if (show) {
            axesBtn.classList.add('active');
            if (this.sceneManager) {
                this.sceneManager.axesManager.showAllAxes();
            }
        } else {
            axesBtn.classList.remove('active');
            if (this.sceneManager) {
                this.sceneManager.axesManager.hideAllAxes();
            }
        }
    }

    /**
     * Detect file type
     */
    detectFileType(fileName) {
        const ext = fileName.toLowerCase().split('.').pop();
        const typeMap = {
            'urdf': 'urdf',
            'xacro': 'urdf',
            'mjcf': 'mjcf',
            'xml': 'mjcf',
            'dae': 'mesh',
            'stl': 'mesh',
            'obj': 'mesh',
            'collada': 'mesh',
            'gltf': 'mesh',
            'glb': 'mesh',
            'usd': 'usd',
            'usda': 'usd',
            'usdc': 'usd',
            'usdz': 'usd'
        };
        return typeMap[ext] || 'urdf';
    }

    /**
     * Handle MuJoCo reset
     */
    handleMujocoReset() {
        if (this.mujocoSimulationManager) {
            // Only reset simulation state, don't change run/pause state
            this.mujocoSimulationManager.reset();
        }
    }

    /**
     * Handle MuJoCo simulation toggle
     */
    async handleMujocoToggleSimulate() {
        // If simulation not loaded, load first
        if (!this.mujocoSimulationManager.hasScene() && this.currentMJCFFile && this.currentMJCFModel) {
            try {
                const xmlContent = await this.currentMJCFFile.text();

                // Load MuJoCo physics engine (pass original model for material info)
                await this.mujocoSimulationManager.loadScene(
                    xmlContent,
                    this.currentMJCFFile.name,
                    this.fileHandler.getFileMap(),
                    this.currentMJCFModel  // Pass original model (for material info)
                );

                // Hide original model
                if (this.currentModel && this.currentModel.threeObject) {
                    this.currentModel.threeObject.visible = false;
                }

                // Start simulation immediately
                this.mujocoSimulationManager.startSimulation();
                return true;
            } catch (error) {
                console.error('MuJoCo scene loading failed:', error);
                // Error details are already logged to console, no need for alert popup
                return false;
            }
        }

        // Toggle simulation state
        if (this.mujocoSimulationManager) {
            const isSimulating = this.mujocoSimulationManager.toggleSimulation();

            // Toggle original model visibility
            if (this.currentModel && this.currentModel.threeObject) {
                this.currentModel.threeObject.visible = !isSimulating;
            }

            return isSimulating;
        }
        return false;
    }

    /**
     * Animation loop
     */
    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.sceneManager) {
            this.sceneManager.update();

            // Update MuJoCo simulation
            if (this.mujocoSimulationManager && this.mujocoSimulationManager.hasScene()) {
                this.mujocoSimulationManager.update(performance.now());
            }

            this.sceneManager.render();
        }
    }
}

// Create and start application
const app = new App();
app.init();

// Expose to global (for debugging)
window.app = app;
window.app.listDiagnosticsFixtures = () => DIAGNOSTICS_FIXTURES.map(fixture => ({ id: fixture.id, title: fixture.title }));
window.app.loadDiagnosticsFixture = (id) => loadDiagnosticsFixture(window.app, id);
window.app.runDiagnosticsFixture = (id, settleMs) => runDiagnosticsFixture(window.app, id, settleMs);
window.app.runAllDiagnosticsFixtures = (settleMs) => runAllDiagnosticsFixtures(window.app, settleMs);