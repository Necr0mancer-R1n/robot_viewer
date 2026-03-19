import { clearRuntimeDiagnostics, computeHealthState, getDiagnostics, getRuntimeDiagnostics } from '../utils/DiagnosticsUtils.js';

export const DIAGNOSTICS_FIXTURES = [
    {
        id: 'valid-urdf',
        title: 'Valid URDF',
        entry: 'robot.urdf',
        files: ['robot.urdf'],
        expected: {
            health: 'healthy',
            required: []
        }
    },
    {
        id: 'missing-single-texture',
        title: 'Missing Single Texture',
        entry: 'robot.urdf',
        files: ['robot.urdf', 'meshes/base.stl'],
        expected: {
            health: 'degraded',
            required: [
                { code: 'resource/missing', level: 'warning' }
            ]
        }
    },
    {
        id: 'missing-single-visual-mesh',
        title: 'Missing Single Visual Mesh',
        entry: 'robot.urdf',
        files: ['robot.urdf'],
        expected: {
            health: 'broken',
            required: [
                { code: 'resource/missing', level: 'error' }
            ]
        }
    },
    {
        id: 'missing-meshes-folder',
        title: 'Missing Meshes Folder',
        entry: 'robot.urdf',
        files: ['robot.urdf'],
        expected: {
            health: 'broken',
            required: [
                { code: 'resource/missing-summary', level: 'error' }
            ]
        }
    },
    {
        id: 'invalid-joint-limits',
        title: 'Invalid Joint Limits',
        entry: 'robot.urdf',
        files: ['robot.urdf'],
        expected: {
            health: 'broken',
            required: [
                { code: 'joint/invalid-limits', level: 'error' }
            ]
        }
    },
    {
        id: 'missing-xacro-include',
        title: 'Missing Xacro Include',
        entry: 'robot.xacro',
        files: ['robot.xacro'],
        expected: {
            health: 'broken',
            required: [
                { code: 'xacro/include-missing', level: 'error' },
                { code: 'model/load-failed', level: 'error' }
            ]
        }
    },
    {
        id: 'package-path-unresolved',
        title: 'Package Path Unresolved',
        entry: 'robot.urdf',
        files: ['robot.urdf'],
        expected: {
            health: 'broken',
            required: [
                { code: 'resource/missing', level: 'error' }
            ]
        }
    },
    {
        id: 'xacro-source-map-missing-mesh',
        title: 'Xacro Source Map Missing Mesh',
        entry: 'robot.xacro',
        files: ['robot.xacro', 'includes/common.xacro'],
        expected: {
            health: 'broken',
            required: [
                {
                    code: 'resource/missing',
                    level: 'error',
                    filePath: 'includes/common.xacro',
                    macro: 'build_link',
                    argsIncludes: ['mesh_variant']
                }
            ]
        }
    }
];

function getFixtureById(id) {
    const fixture = DIAGNOSTICS_FIXTURES.find(item => item.id === id);
    if (!fixture) {
        throw new Error(`Unknown diagnostics fixture: ${id}`);
    }
    return fixture;
}

function getFileType(path) {
    const ext = path.toLowerCase().split('.').pop();
    if (['urdf', 'xacro', 'xml', 'usd', 'usda', 'usdc', 'usdz'].includes(ext)) {
        return 'model';
    }

    if (['dae', 'stl', 'obj', 'collada', 'png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'].includes(ext)) {
        return 'mesh';
    }

    return 'file';
}

async function loadFixtureFile(id, relativePath) {
    const url = `/diagnostics-fixtures/${id}/${relativePath}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load diagnostics fixture file: ${url}`);
    }

    const blob = await response.blob();
    const fileName = relativePath.split('/').pop();
    const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
    return { path: relativePath, file };
}

function buildLoadableFiles(files) {
    return files
        .filter(item => getFileType(item.path) === 'model')
        .map(item => {
            const ext = item.path.toLowerCase().split('.').pop();
            return {
                file: item.file,
                name: item.file.name,
                type: ext === 'xacro' ? 'xacro' : ext === 'urdf' ? 'urdf' : 'mjcf',
                path: item.path,
                category: 'model',
                ext
            };
        });
}

function resetAppState(app) {
    if (!app) return;

    clearRuntimeDiagnostics();

    if (app.currentModel && app.sceneManager) {
        app.sceneManager.removeModel(app.currentModel);
    }

    app.currentModel = null;
    app.currentMJCFFile = null;
    app.currentMJCFModel = null;

    if (app.fileHandler) {
        app.fileHandler.fileMap.clear();
        app.fileHandler.availableModels = [];
    }

    app.fileTreeView?.updateFileTree([], new Map());
    app.jointControlsUI?.setupJointControls(null);
    app.modelGraphView?.drawModelGraph(null);
    app.codeEditorManager?.clearEditor();
    app.diagnosticsView?.render(null, null);
}

function matchesExpectedDiagnostic(actual, expected) {
    if (actual.code !== expected.code) return false;
    if (expected.level && actual.level !== expected.level) return false;

    if (expected.filePath) {
        const actualFilePath = actual.filePath || '';
        if (!(actualFilePath === expected.filePath || actualFilePath.endsWith(expected.filePath))) {
            return false;
        }
    }

    if (expected.macro && actual.metadata?.macro !== expected.macro) {
        return false;
    }

    if (expected.argsIncludes?.length) {
        const actualArgs = actual.metadata?.args || [];
        if (!expected.argsIncludes.every(arg => actualArgs.includes(arg))) {
            return false;
        }
    }

    return true;
}

export async function loadDiagnosticsFixture(app, id) {
    const fixture = getFixtureById(id);
    resetAppState(app);

    const files = await Promise.all(fixture.files.map(path => loadFixtureFile(id, path)));
    files.forEach(item => {
        app.fileHandler.fileMap.set(item.path, item.file);
    });

    const loadableFiles = buildLoadableFiles(files);
    app.fileHandler.availableModels = loadableFiles;
    app.fileHandler.onFilesLoaded?.(loadableFiles);

    const entryFile = files.find(item => item.path === fixture.entry)?.file;
    if (!entryFile) {
        throw new Error(`Fixture entry file not found: ${fixture.entry}`);
    }

    await app.fileHandler.loadFile(entryFile);
    return fixture;
}

export async function runDiagnosticsFixture(app, id, settleMs = 1800) {
    const fixture = await loadDiagnosticsFixture(app, id);
    await new Promise(resolve => setTimeout(resolve, settleMs));

    const modelDiagnostics = app.currentModel ? getDiagnostics(app.currentModel) : [];
    const runtimeDiagnostics = getRuntimeDiagnostics();
    const combinedDiagnostics = [...modelDiagnostics, ...runtimeDiagnostics];
    const health = computeHealthState(modelDiagnostics.length > 0 ? modelDiagnostics : runtimeDiagnostics);

    const missingExpectations = fixture.expected.required.filter(expected => {
        return !combinedDiagnostics.some(actual => matchesExpectedDiagnostic(actual, expected));
    });

    return {
        fixture: fixture.id,
        health,
        passed: health === fixture.expected.health && missingExpectations.length === 0,
        diagnostics: combinedDiagnostics,
        missingExpectations
    };
}

export async function runAllDiagnosticsFixtures(app, settleMs = 1800) {
    const results = [];
    for (const fixture of DIAGNOSTICS_FIXTURES) {
        const result = await runDiagnosticsFixture(app, fixture.id, settleMs);
        results.push(result);
    }
    return results;
}
