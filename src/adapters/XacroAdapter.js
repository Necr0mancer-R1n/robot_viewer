/**
 * Xacro Adapter
 *
 * Parses ROS Xacro files and converts them to URDF format using xacro-parser.
 *
 * Supported Features:
 * - Property definitions and substitutions (xacro:property)
 * - Macro definitions with parameters (xacro:macro)
 * - Conditional blocks (xacro:if, xacro:unless)
 * - File inclusions (xacro:include) with package:// and relative paths
 * - Python-style boolean constants (True/False)
 * - Arithmetic expressions and property evaluation
 *
 * Compatibility:
 * - ROS Jade and later (inOrder=true, requirePrefix=true, localProperties=true)
 * - Automatically injects True/False constants for compatibility with ROS xacro files
 *
 * Usage:
 * - Upload all related xacro files (main file and included files)
 * - The adapter automatically resolves file inclusions from the uploaded file map
 * - Mesh files are resolved using package:// paths or relative paths
 */
import { XacroParser } from 'xacro-parser';
import { URDFAdapter } from './URDFAdapter.js';
import { addDiagnostic, addDiagnostics, addRuntimeDiagnostic, createDiagnostic, createMissingResourceDiagnostic, extractURDFResourceReferences, getSuggestedResourceCandidates, matchResourceReference, upsertResourceSummaryDiagnostic } from '../utils/DiagnosticsUtils.js';
import { annotateXacroContent, applyXacroSourceMapToModel, extractXacroSourceMap, findXacroIncludeSourceInfo, stripXacroTraceAttributes } from '../utils/XacroTraceUtils.js';

export class XacroAdapter {
    /**
     * Parse xacro content and convert to unified model
     * @param {string} xacroContent - Xacro file content
     * @param {string} fileName - Xacro file name (for working path)
     * @param {Map} fileMap - File map (path -> File object)
     * @param {File} file - Original file object (optional)
     * @returns {Promise<UnifiedRobotModel>}
     */
    static async parse(xacroContent, fileName, fileMap = null, file = null) {
        try {
            // Create xacro parser
            const parser = new XacroParser();
            const sourceFiles = new Map();
            sourceFiles.set(fileName, xacroContent);

            // Configure parser for ROS Jade and later (default settings)
            parser.inOrder = true;
            parser.requirePrefix = true;
            parser.localProperties = true;

            // Set working path (directory where xacro file is located)
            const workingPath = fileName.includes('/')
                ? fileName.substring(0, fileName.lastIndexOf('/') + 1)
                : '';
            parser.workingPath = workingPath;

            // Inject Python-style boolean constants as xacro properties
            // Some xacro files use True/False (capitalized) in conditions
            xacroContent = annotateXacroContent(xacroContent, fileName);
            xacroContent = this.injectBooleanConstants(xacroContent);

            // Extract and set xacro arguments with their default values
            // Also add common ROS arguments that might be used without definition
            const xacroArgs = this.extractXacroArguments(xacroContent);

            // Add common ROS arguments with sensible defaults if not already defined
            if (!xacroArgs.hasOwnProperty('DEBUG')) {
                xacroArgs.DEBUG = 'false';
            }
            if (!xacroArgs.hasOwnProperty('SELF_COLLIDE')) {
                xacroArgs.SELF_COLLIDE = 'false';
            }

            parser.arguments = xacroArgs;

            // If fileMap provided, setup custom file loader
            if (fileMap) {
                parser.getFileContents = async (path) => {
                    return await this.loadFileFromMap(path, fileMap, workingPath, sourceFiles);
                };
            }

            // Parse xacro to URDF XML
            const urdfXML = await parser.parse(xacroContent);

            // Convert XMLDocument to string
            const serializer = new XMLSerializer();
            let urdfString = serializer.serializeToString(urdfXML);

            // Clean up the XML string - remove empty xmlns attributes that might cause issues
            urdfString = urdfString.replace(/\sxmlns=""/g, '');

            // Re-parse the URDF string with DOMParser to create a clean XMLDocument
            // This removes any xacro-specific nodes that urdf-loader might not handle
            const domParser = new DOMParser();
            const cleanUrdfXML = domParser.parseFromString(urdfString, 'text/xml');

            // Check for parsing errors
            const parseError = cleanUrdfXML.querySelector('parsererror');
            if (parseError) {
                console.error('[XacroAdapter] XML parsing error:', parseError.textContent);
                throw new Error('Generated URDF has invalid XML: ' + parseError.textContent);
            }

            // Remove problematic elements that urdf-loader might not handle well
            // Remove gazebo elements (plugins, sensors, etc.)
            const gazeboElements = cleanUrdfXML.querySelectorAll('gazebo');
            gazeboElements.forEach(el => el.parentNode?.removeChild(el));

            // Remove transmission elements (these are for Gazebo/ROS control)
            const transmissionElements = cleanUrdfXML.querySelectorAll('transmission');
            transmissionElements.forEach(el => el.parentNode?.removeChild(el));

            // Remove visual/collision elements with empty geometry tags
            this.removeEmptyGeometry(cleanUrdfXML);

            // Clean up empty text nodes and comments that might cause issues
            this.cleanXMLNodes(cleanUrdfXML.documentElement);

            const tracedUrdfString = serializer.serializeToString(cleanUrdfXML);
            const xacroSourceMap = extractXacroSourceMap(tracedUrdfString);
            const finalUrdfString = stripXacroTraceAttributes(tracedUrdfString);

            // Now use existing URDF loading infrastructure
            // Import URDFLoader dynamically
            const urdfModule = await import('urdf-loader');
            const URDFLoader = urdfModule.URDFLoader || urdfModule.default || urdfModule;

            return new Promise((resolve, reject) => {
                const loader = new URDFLoader();
                const resourceDiagnostics = [];
                const missingResourceKeys = new Set();
                const resourceReferences = extractURDFResourceReferences(tracedUrdfString);
                let currentModel = null;
                let refreshScheduled = false;
                loader.parseCollision = true;

                const refreshDiagnosticsUI = () => {
                    if (refreshScheduled) {
                        return;
                    }

                    refreshScheduled = true;
                    requestAnimationFrame(() => {
                        refreshScheduled = false;

                        if (typeof window === 'undefined' || !window.app || window.app.currentModel !== currentModel) {
                            return;
                        }

                        window.app.diagnosticsView?.render(currentModel, window.app.fileHandler?.getCurrentModelFile());
                        window.app.modelGraphView?.drawModelGraph(currentModel);
                        window.app.jointControlsUI?.setupJointControls(currentModel);
                    });
                };

                // Extract directory where URDF file is located
                const urdfDir = workingPath;
                const buildMissingResourceDiagnostic = (path, candidates = []) => {
                    const reference = matchResourceReference(path, resourceReferences);
                    const suggestedCandidates = getSuggestedResourceCandidates(path, fileMap, candidates);

                    return createMissingResourceDiagnostic({
                        source: 'xacro',
                        filePath: fileName,
                        path,
                        candidates: suggestedCandidates,
                        reference
                    });
                };

                const reportMissingResource = (path, candidates = []) => {
                    if (!path) return;

                    const key = `${path}|${candidates.join('|')}`;
                    if (missingResourceKeys.has(key)) {
                        return;
                    }

                    missingResourceKeys.add(key);
                    const diagnostic = buildMissingResourceDiagnostic(path, candidates);

                    if (currentModel) {
                        addDiagnostic(currentModel, diagnostic);
                        upsertResourceSummaryDiagnostic(currentModel);
                        refreshDiagnosticsUI();
                    } else {
                        resourceDiagnostics.push(diagnostic);
                    }
                };

                // If file map provided, setup resource loader (same as URDF loading)
                if (fileMap) {
                    // Parse URDF content, find all used package names
                    const packages = this.extractPackagesFromURDF(finalUrdfString);

                    // Build package map
                    const packageMap = {};
                    packages.forEach(pkg => {
                        packageMap[pkg] = pkg;
                    });
                    packageMap[''] = '';

                    loader.packages = packageMap;

                    // Set URL Modifier (same as URDF loading)
                    const urlModifier = (url) => {
                        // Handle blob URLs
                        if (url.startsWith('blob:')) {
                            const blobMatch = url.match(/^blob:https?:\/\/[^\/]+\/(.+)$/);
                            if (blobMatch && blobMatch[1]) {
                                const fileName = blobMatch[1];
                                if (/\.(jpg|jpeg|png|gif|bmp|tga|tiff|webp|dae|stl|obj|gltf|glb)$/i.test(fileName)) {
                                    url = fileName;
                                } else {
                                    return url;
                                }
                            } else {
                                return url;
                            }
                        }

                        const isTextureFile = /\.(jpg|jpeg|png|gif|bmp|tga|tiff|webp)$/i.test(url);
                        const isMeshFile = /\.(dae|stl|obj|gltf|glb)$/i.test(url);

                        let meshPath = url;

                        // Remove http:// or https:// prefix
                        if (meshPath.startsWith('http://') || meshPath.startsWith('https://')) {
                            try {
                                const urlObj = new URL(meshPath);
                                meshPath = urlObj.pathname;
                                if (meshPath.startsWith('/')) {
                                    meshPath = meshPath.substring(1);
                                }
                            } catch (e) {
                                // Invalid URL, use as-is
                            }
                        }

                        // Remove package:// prefix
                        if (meshPath.startsWith('package://')) {
                            meshPath = meshPath.replace(/^package:\/\//, '');
                            const parts = meshPath.split('/');
                            if (parts.length > 1) {
                                meshPath = parts.slice(1).join('/');
                            }
                        }

                        // Remove leading ./
                        meshPath = meshPath.replace(/^\.\//, '');

                        // Handle relative paths
                        let normalizedPath = meshPath;
                        if (meshPath.includes('../')) {
                            const parts = meshPath.split('/');
                            const resolvedParts = [];
                            for (const part of parts) {
                                if (part === '..') {
                                    resolvedParts.pop();
                                } else if (part !== '.' && part !== '') {
                                    resolvedParts.push(part);
                                }
                            }
                            normalizedPath = resolvedParts.join('/');
                        }

                        // Build full path
                        const fullPath = urdfDir + normalizedPath;
                        const altPath = urdfDir + meshPath;

                        // Find file in fileMap
                        let matchedFile = fileMap.get(fullPath);

                        if (!matchedFile && altPath !== fullPath) {
                            matchedFile = fileMap.get(altPath);
                        }

                        if (!matchedFile) {
                            matchedFile = fileMap.get(normalizedPath);
                        }

                        if (!matchedFile) {
                            matchedFile = fileMap.get(meshPath);
                        }

                        if (!matchedFile) {
                            const targetFileName = normalizedPath.split('/').pop() || meshPath.split('/').pop();
                            const candidates = [];
                            for (const [key, file] of fileMap.entries()) {
                                const keyFileName = key.split('/').pop();
                                if (keyFileName === targetFileName) {
                                    matchedFile = file;
                                    break;
                                }
                                if (targetFileName && candidates.length < 5 && keyFileName?.includes(targetFileName)) {
                                    candidates.push(key);
                                }
                            }

                            if (!matchedFile && (isTextureFile || isMeshFile)) {
                                reportMissingResource(url, candidates);
                            }
                        }

                        if (matchedFile) {
                            const bloburl = URL.createObjectURL(matchedFile);
                            return bloburl;
                        }

                        if (isTextureFile || isMeshFile) {
                            reportMissingResource(url);
                        }

                        return url;
                    };

                    loader.manager.setURLModifier(urlModifier);

                    // Custom loadMeshCb (same as URDF loading)
                    const originalLoadMeshCb = loader.loadMeshCb || loader.defaultMeshLoader.bind(loader);
                    loader.loadMeshCb = (path, manager, done) => {
                        this.findFileInMapByPath(path, fileMap, urdfDir).then(file => {
                            if (file) {
                                const ext = (file.name || path).toLowerCase().split('.').pop();
                                this.loadMeshFileAsync(file, ext, manager).then(meshObject => {
                                    if (meshObject) {
                                        done(meshObject, null);
                                    } else {
                                        done(null, new Error(`Failed to load mesh file: ${path}`));
                                    }
                                }).catch(err => {
                                    console.error(`Failed to load mesh: ${path}`, err);
                                    done(null, err);
                                });
                            } else {
                                reportMissingResource(path);
                                originalLoadMeshCb(path, manager, done);
                            }
                        }).catch(error => {
                            console.error(`Failed to find file: ${path}`, error);
                            originalLoadMeshCb(path, manager, done);
                        });
                    };
                }

                // Create temporary URL for URDF content
                const blob = new Blob([finalUrdfString], { type: 'text/xml' });
                const url = URL.createObjectURL(blob);

                loader.load(url, (robot) => {
                    URL.revokeObjectURL(url);

                    // Convert to unified model using URDFAdapter
                    try {
                        const model = URDFAdapter.convert(robot, finalUrdfString);
                        applyXacroSourceMapToModel(model, xacroSourceMap);
                        model.userData.sourceFiles = sourceFiles;
                        currentModel = model;
                        addDiagnostics(model, resourceDiagnostics);
                        model.userData.generatedURDF = finalUrdfString;
                        model.userData.sourceXacro = fileName;
                        resolve(model);
                    } catch (error) {
                        console.error('[XacroAdapter] URDF conversion error:', error);
                        reject(new Error('URDF conversion failed: ' + error.message));
                    }
                }, undefined, (error) => {
                    URL.revokeObjectURL(url);
                    console.error('[XacroAdapter] URDF loading error:', error);
                    reject(new Error('URDF loading failed: ' + (error.message || error)));
                });
            });
        } catch (error) {
            console.error('[XacroAdapter] Xacro parsing error:', error);
            throw new Error('Xacro parsing failed: ' + error.message);
        }
    }

    /**
     * Load file from fileMap for xacro includes
     * @param {string} path - File path
     * @param {Map} fileMap - File map
     * @param {string} workingPath - Working directory
     * @returns {Promise<string>}
     */
    static async loadFileFromMap(path, fileMap, workingPath, sourceFiles = new Map()) {
        // Clean path - remove leading slash if present
        let cleanPath = path;
        if (cleanPath.startsWith('/')) {
            cleanPath = cleanPath.substring(1);
        }

        // Remove leading ./
        cleanPath = cleanPath.replace(/^\.\//, '');

        // Try different path combinations
        const possiblePaths = [
            cleanPath,
            workingPath + cleanPath,
            path,
            workingPath + path.replace(/^\/+/, ''),
            // Also try without the first directory component
            cleanPath.includes('/') ? cleanPath.substring(cleanPath.indexOf('/') + 1) : cleanPath,
        ];

        // Try each path
        for (const tryPath of possiblePaths) {
            const file = fileMap.get(tryPath);
            if (file) {
                const content = await file.text();
                sourceFiles.set(tryPath, content);
                return this.injectBooleanConstants(annotateXacroContent(content, tryPath));
            }
        }

        // Try filename only match
        const fileName = cleanPath.split('/').pop();
        for (const [key, file] of fileMap.entries()) {
            const keyFileName = key.split('/').pop();
            if (keyFileName === fileName) {
                const content = await file.text();
                sourceFiles.set(key, content);
                return this.injectBooleanConstants(annotateXacroContent(content, key));
            }
        }

        console.error('[XacroAdapter] Cannot find included file:', path);
        const includeSource = findXacroIncludeSourceInfo(path, sourceFiles);
        addRuntimeDiagnostic(createDiagnostic({
            level: 'error',
            code: 'xacro/include-missing',
            source: 'xacro',
            message: `Cannot find included file: ${path}`,
            filePath: includeSource?.filePath || workingPath,
            metadata: {
                lineNumber: includeSource?.lineNumber || null,
                searchText: includeSource?.searchText || path
            }
        }));
        throw new Error(`Cannot find included file: ${path}`);
    }

    /**
     * Remove visual/collision elements with empty geometry tags
     * xacro-parser may not fully expand conditional geometry (xacro:if)
     * We'll just remove these empty visual elements rather than try to fix them
     * @param {XMLDocument} xmlDoc - XML document to clean
     */
    static removeEmptyGeometry(xmlDoc) {
        // Find all geometry elements
        const geometryElements = xmlDoc.querySelectorAll('geometry');

        geometryElements.forEach(geom => {
            // Check if geometry is empty (no child elements)
            if (!geom.children || geom.children.length === 0) {
                // Find the parent visual or collision element
                let parent = geom.parentNode;
                if (parent) {
                    const grandParent = parent.parentNode;
                    if (grandParent) {
                        if (parent.nodeName === 'visual' || parent.nodeName === 'collision') {
                            // Remove empty visual/collision elements
                            grandParent.removeChild(parent);
                        }
                    }
                }
            }
        });
    }

    /**
     * Recursively clean XML nodes - remove empty text nodes and comments
     * @param {Element} element - Element to clean
     */
    static cleanXMLNodes(element) {
        if (!element || !element.childNodes) return;

        const nodesToRemove = [];

        // Collect nodes to remove
        for (let i = 0; i < element.childNodes.length; i++) {
            const node = element.childNodes[i];

            // Remove comments
            if (node.nodeType === Node.COMMENT_NODE) {
                nodesToRemove.push(node);
            }
            // Remove empty or whitespace-only text nodes
            else if (node.nodeType === Node.TEXT_NODE) {
                if (!node.nodeValue || node.nodeValue.trim() === '') {
                    nodesToRemove.push(node);
                }
            }
            // Recursively clean element nodes
            else if (node.nodeType === Node.ELEMENT_NODE) {
                this.cleanXMLNodes(node);
            }
        }

        // Remove collected nodes
        nodesToRemove.forEach(node => {
            element.removeChild(node);
        });
    }

    /**
     * Extract package names from URDF content
     * @param {string} urdfContent - URDF content
     * @returns {Set<string>}
     */
    static extractPackagesFromURDF(urdfContent) {
        const packages = new Set();
        const packageRegex = /package:\/\/([^\/]+)/g;
        let match;
        while ((match = packageRegex.exec(urdfContent)) !== null) {
            packages.add(match[1]);
        }
        return packages;
    }

    /**
     * Find file in fileMap by path
     * @param {string} path - File path
     * @param {Map} fileMap - File map
     * @param {string} urdfDir - URDF directory
     * @returns {Promise<File|null>}
     */
    static async findFileInMapByPath(path, fileMap, urdfDir) {
        let meshPath = path;

        // Remove blob: prefix
        meshPath = meshPath.replace(/^blob:[^\/]+\//, '');

        // Remove package:// prefix
        if (meshPath.startsWith('package://')) {
            meshPath = meshPath.replace(/^package:\/\//, '');
            const parts = meshPath.split('/');
            if (parts.length > 1) {
                meshPath = parts.slice(1).join('/');
            }
        }

        // Remove leading ./
        meshPath = meshPath.replace(/^\.\//, '');

        // Build full path
        const fullPath = urdfDir + meshPath;

        // Try full path
        let file = fileMap.get(fullPath);
        if (file) return file;

        // Try path without directory
        file = fileMap.get(meshPath);
        if (file) return file;

        // Try filename match
        const targetFileName = meshPath.split('/').pop();
        for (const [key, f] of fileMap.entries()) {
            const keyFileName = key.split('/').pop();
            if (keyFileName === targetFileName) {
                return f;
            }
        }

        return null;
    }

    /**
     * Load mesh file asynchronously
     * @param {File} file - File object
     * @param {string} ext - File extension
     * @param {THREE.LoadingManager} manager - Loading manager
     * @returns {Promise<THREE.Object3D>}
     */
    static async loadMeshFileAsync(file, ext, manager) {
        const THREE = await import('three');
        const blobUrl = URL.createObjectURL(file);

        try {
            let meshObject = null;

            switch (ext) {
                case 'stl': {
                    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
                    const stlLoader = new STLLoader(manager);
                    const stlGeometry = await new Promise((resolve, reject) => {
                        stlLoader.load(blobUrl, resolve, undefined, reject);
                    });
                    const stlMaterial = new THREE.MeshPhongMaterial();
                    meshObject = new THREE.Mesh(stlGeometry, stlMaterial);
                    break;
                }

                case 'dae': {
                    const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
                    const colladaLoader = new ColladaLoader(manager);
                    const colladaModel = await new Promise((resolve, reject) => {
                        colladaLoader.load(blobUrl, resolve, undefined, reject);
                    });
                    meshObject = colladaModel.scene;

                    // Remove lights
                    if (meshObject && meshObject.traverse) {
                        const lightsToRemove = [];
                        meshObject.traverse(child => {
                            if (child.isLight) {
                                lightsToRemove.push(child);
                            }
                        });
                        lightsToRemove.forEach(light => {
                            if (light.parent) {
                                light.parent.remove(light);
                            }
                        });
                    }
                    break;
                }

                case 'obj': {
                    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
                    const objLoader = new OBJLoader(manager);
                    meshObject = await new Promise((resolve, reject) => {
                        objLoader.load(blobUrl, resolve, undefined, reject);
                    });
                    break;
                }

                case 'gltf':
                case 'glb': {
                    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
                    const gltfLoader = new GLTFLoader(manager);
                    const gltfModel = await new Promise((resolve, reject) => {
                        gltfLoader.load(blobUrl, resolve, undefined, reject);
                    });
                    meshObject = gltfModel.scene;
                    break;
                }

                default:
                    console.warn(`Unsupported file format: ${ext}`);
                    URL.revokeObjectURL(blobUrl);
                    return null;
            }

            URL.revokeObjectURL(blobUrl);
            return meshObject;
        } catch (error) {
            URL.revokeObjectURL(blobUrl);
            console.error(`Failed to load mesh file: ${file.name}`, error);
            throw error;
        }
    }

    /**
     * Inject Python-style boolean constants (True/False) into xacro content
     * Some xacro files use capitalized True/False in conditional expressions
     * The parameters are passed as strings ("True", "False") but compared to constants
     * We define the constants to match the string values for comparison to work
     * @param {string} xacroContent - Original xacro content
     * @returns {string} - Modified xacro content with boolean constants defined
     */
    static injectBooleanConstants(xacroContent) {
        // Find the robot tag opening
        const robotTagMatch = xacroContent.match(/(<robot[^>]*>)/);
        if (!robotTagMatch) {
            return xacroContent;
        }

        // Define True/False as string properties for comparison
        // When mirror_dae="True" is passed, it becomes the string "True"
        // We want ${mirror_dae == True} to work, so True must also be "True"
        const booleanProperties = `
    <!-- Injected by XacroAdapter: Python-style boolean constants -->
    <xacro:property name="True" value="True"/>
    <xacro:property name="False" value="False"/>
`;

        const insertPosition = robotTagMatch.index + robotTagMatch[0].length;
        return xacroContent.substring(0, insertPosition) +
               booleanProperties +
               xacroContent.substring(insertPosition);
    }

    /**
     * Extract xacro arguments and their default values from xacro content
     * Xacro files can define arguments using <xacro:arg name="..." default="..."/>
     * These need to be provided to the parser via parser.arguments
     * @param {string} xacroContent - Xacro file content
     * @returns {Object} - Object with argument names as keys and default values
     */
    static extractXacroArguments(xacroContent) {
        const args = {};

        // Match <xacro:arg name="NAME" default="VALUE"/>
        // Also match <arg name="NAME" default="VALUE"/> (without xacro: prefix)
        const argPattern = /<(?:xacro:)?arg\s+name=["']([^"']+)["'](?:\s+default=["']([^"']*)["'])?/g;

        let match;
        while ((match = argPattern.exec(xacroContent)) !== null) {
            const argName = match[1];
            const defaultValue = match[2] || 'false'; // Default to 'false' if no default specified
            args[argName] = defaultValue;
        }

        return args;
    }
}


