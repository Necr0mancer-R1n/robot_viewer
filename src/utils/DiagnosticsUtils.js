import { readXacroTraceInfo } from './XacroTraceUtils.js';

let diagnosticId = 0;
const runtimeDiagnostics = [];

function uniqueValues(values = []) {
    return Array.from(new Set(values.filter(Boolean)));
}

function countLineNumber(content, index) {
    if (!content || index < 0) {
        return null;
    }

    return content.slice(0, index).split('\n').length;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findAttributePosition(content, attribute, value, startIndex = 0) {
    if (!content || !attribute || !value) {
        return { index: -1, searchText: '' };
    }

    const patterns = [
        `${attribute}="${value}"`,
        `${attribute}='${value}'`
    ];

    for (const pattern of patterns) {
        const index = content.indexOf(pattern, startIndex);
        if (index !== -1) {
            return { index, searchText: pattern };
        }
    }

    return { index: -1, searchText: value };
}

function findNamedElementPosition(content, tagName, name) {
    if (!content || !tagName || !name) {
        return { lineNumber: null, searchText: '' };
    }

    const pattern = new RegExp(`<${tagName}\\b[^>]*name=["']${escapeRegExp(name)}["']`, 'i');
    const match = pattern.exec(content);
    if (!match) {
        return { lineNumber: null, searchText: `${tagName} name="${name}"` };
    }

    return {
        lineNumber: countLineNumber(content, match.index),
        searchText: match[0]
    };
}

function normalizeResourcePath(path) {
    if (!path || typeof path !== 'string') {
        return '';
    }

    let normalized = path.trim().replace(/\\/g, '/');
    normalized = normalized.replace(/^https?:\/\/[^\/]+\//, '');
    normalized = normalized.replace(/^package:\/\//, '');
    normalized = normalized.replace(/^\/+/, '');
    normalized = normalized.replace(/^\.\//, '');

    const parts = [];
    normalized.split('/').forEach(part => {
        if (!part || part === '.') return;
        if (part === '..') {
            parts.pop();
            return;
        }
        parts.push(part);
    });

    return parts.join('/');
}

export function getResourcePathVariants(path) {
    const normalized = normalizeResourcePath(path);
    if (!normalized) {
        return [];
    }

    const variants = [normalized];
    const parts = normalized.split('/');

    if (parts.length > 1) {
        variants.push(parts.slice(1).join('/'));
        variants.push(parts[parts.length - 1]);
    }

    return uniqueValues(variants);
}

export function extractURDFResourceReferences(xmlContent) {
    if (!xmlContent || typeof xmlContent !== 'string') {
        return [];
    }

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            return [];
        }

        const references = [];
        let searchFrom = 0;
        const links = doc.querySelectorAll('link');

        links.forEach(linkEl => {
            const linkName = linkEl.getAttribute('name') || '';

            linkEl.querySelectorAll('visual mesh[filename], collision mesh[filename]').forEach(meshEl => {
                const rawPath = meshEl.getAttribute('filename');
                const parent = meshEl.closest('visual, collision');
                const role = parent?.tagName?.toLowerCase() || 'visual';
                const match = findAttributePosition(xmlContent, 'filename', rawPath, searchFrom);
                const sourceInfo =
                    readXacroTraceInfo(meshEl, match.searchText || rawPath) ||
                    readXacroTraceInfo(parent, match.searchText || rawPath) ||
                    readXacroTraceInfo(linkEl, match.searchText || rawPath);
                if (match.index !== -1) {
                    searchFrom = match.index + match.searchText.length;
                }

                references.push({
                    path: rawPath,
                    variants: getResourcePathVariants(rawPath),
                    targetType: 'link',
                    targetName: linkName,
                    metadata: {
                        role,
                        filePath: sourceInfo?.filePath || '',
                        macro: sourceInfo?.macro || '',
                        args: sourceInfo?.args || [],
                        lineNumber: sourceInfo?.lineNumber || countLineNumber(xmlContent, match.index),
                        searchText: sourceInfo?.searchText || match.searchText || rawPath
                    }
                });
            });

            linkEl.querySelectorAll('texture[filename]').forEach(textureEl => {
                const rawPath = textureEl.getAttribute('filename');
                const match = findAttributePosition(xmlContent, 'filename', rawPath, searchFrom);
                const sourceInfo =
                    readXacroTraceInfo(textureEl, match.searchText || rawPath) ||
                    readXacroTraceInfo(linkEl, match.searchText || rawPath);
                if (match.index !== -1) {
                    searchFrom = match.index + match.searchText.length;
                }

                references.push({
                    path: rawPath,
                    variants: getResourcePathVariants(rawPath),
                    targetType: 'link',
                    targetName: linkName,
                    metadata: {
                        role: 'texture',
                        filePath: sourceInfo?.filePath || '',
                        macro: sourceInfo?.macro || '',
                        args: sourceInfo?.args || [],
                        lineNumber: sourceInfo?.lineNumber || countLineNumber(xmlContent, match.index),
                        searchText: sourceInfo?.searchText || match.searchText || rawPath
                    }
                });
            });
        });

        return references;
    } catch (error) {
        return [];
    }
}

export function matchResourceReference(path, references = []) {
    const pathVariants = getResourcePathVariants(path);
    if (!pathVariants.length) {
        return null;
    }

    return references.find(reference => {
        if (!reference?.variants?.length) {
            return false;
        }

        return reference.variants.some(variant => pathVariants.includes(variant));
    }) || null;
}

export function getSuggestedResourceCandidates(path, fileMap, existingCandidates = [], limit = 5) {
    const variants = getResourcePathVariants(path);
    const normalizedCandidates = [...existingCandidates];

    if (!fileMap || typeof fileMap.entries !== 'function') {
        return uniqueValues(normalizedCandidates).slice(0, limit);
    }

    const scored = [];
    for (const [key] of fileMap.entries()) {
        const normalizedKey = normalizeResourcePath(key);
        const fileName = normalizedKey.split('/').pop();

        let score = 0;
        variants.forEach(variant => {
            if (normalizedKey === variant) score = Math.max(score, 100);
            else if (normalizedKey.endsWith(`/${variant}`)) score = Math.max(score, 90);
            else if (normalizedKey.endsWith(variant)) score = Math.max(score, 80);
            else if (fileName && variant.endsWith(fileName)) score = Math.max(score, 60);
            else if (fileName && variant.includes(fileName)) score = Math.max(score, 40);
        });

        if (score > 0) {
            scored.push({ key, score });
        }
    }

    scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    scored.slice(0, limit).forEach(item => normalizedCandidates.push(item.key));

    return uniqueValues(normalizedCandidates).slice(0, limit);
}

function getResourceSeverity(role) {
    if (role === 'texture') {
        return 'warning';
    }

    if (role === 'collision') {
        return 'warning';
    }

    return 'error';
}

function getResourceSummaryPrefix(path) {
    const normalized = normalizeResourcePath(path);
    if (!normalized) {
        return '';
    }

    const parts = normalized.split('/');
    const preferred = parts.find(part => {
        const lower = part.toLowerCase();
        return lower === 'assets' || lower === 'meshes' || lower === 'mesh' || lower === 'textures';
    });

    return preferred || parts[0] || '';
}

function getResourceBaseDirectory(filePath) {
    const normalized = normalizeResourcePath(filePath);
    if (!normalized.includes('/')) {
        return normalized || '.';
    }
    return normalized.substring(0, normalized.lastIndexOf('/')) || '.';
}

function getResourceCause(path, filePath, candidates = []) {
    if (!path || typeof path !== 'string') {
        return 'Resource path is empty or invalid.';
    }

    if (path.startsWith('package://')) {
        if (candidates.length > 0) {
            return 'Package path could not be resolved exactly. Similar uploaded files were found.';
        }
        return 'Package path could not be resolved from uploaded files.';
    }

    if (path.startsWith('./') || path.startsWith('../') || path.includes('../')) {
        return `Relative path was resolved against "${getResourceBaseDirectory(filePath)}", but no exact uploaded file matched.`;
    }

    if (candidates.length > 0) {
        return 'No exact uploaded file matched this resource path. Similar uploaded files were found.';
    }

    return 'No uploaded file matched this resource path.';
}

export function createMissingResourceDiagnostic({
    source = '',
    filePath = '',
    path = '',
    candidates = [],
    reference = null
} = {}) {
    const role = reference?.metadata?.role || 'resource';
    const targetName = reference?.targetName || '';
    const roleLabel = role === 'collision' ? 'collision mesh' : role === 'texture' ? 'texture' : 'visual mesh';
    const sourceFilePath = reference?.metadata?.filePath || filePath;
    const macro = reference?.metadata?.macro || '';
    const args = reference?.metadata?.args || [];
    const cause = getResourceCause(path, sourceFilePath, candidates);
    const details = [];

    if (reference) {
        details.push(`Referenced by ${roleLabel} of link "${targetName}".`);
    }
    if (macro) {
        details.push(`Macro: ${macro}.`);
    }
    if (args.length > 0) {
        details.push(`Args: ${args.join(', ')}.`);
    }
    details.push(`Cause: ${cause}`);

    return createDiagnostic({
        level: getResourceSeverity(role),
        code: 'resource/missing',
        source,
        message: targetName
            ? `Missing ${roleLabel} for link "${targetName}": ${path}`
            : `Resource not found: ${path}`,
        details: details.join(' '),
        filePath: sourceFilePath,
        targetType: reference?.targetType || '',
        targetName,
        path,
        candidates,
        metadata: {
            ...(reference?.metadata || {}),
            cause,
            macro,
            args,
            lineNumber: reference?.metadata?.lineNumber || null,
            searchText: reference?.metadata?.searchText || path
        }
    });
}

export function upsertResourceSummaryDiagnostic(model) {
    if (!model) {
        return null;
    }

    const diagnostics = getDiagnostics(model);

    for (let i = diagnostics.length - 1; i >= 0; i--) {
        if (diagnostics[i]?.code === 'resource/missing-summary') {
            diagnostics.splice(i, 1);
        }
    }

    const resourceDiagnostics = diagnostics.filter(diagnostic => diagnostic?.code === 'resource/missing');
    if (!resourceDiagnostics.length) {
        return null;
    }

    const affectedLinks = new Set();
    const prefixCounts = new Map();
    let visualMissing = 0;
    let collisionMissing = 0;
    let textureMissing = 0;

    resourceDiagnostics.forEach(diagnostic => {
        if (diagnostic.targetName) {
            affectedLinks.add(diagnostic.targetName);
        }

        const role = diagnostic.metadata?.role || 'resource';
        if (role === 'texture') textureMissing += 1;
        else if (role === 'collision') collisionMissing += 1;
        else visualMissing += 1;

        const prefix = getResourceSummaryPrefix(diagnostic.path || diagnostic.filePath);
        if (prefix) {
            prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
        }
    });

    let dominantPrefix = '';
    let dominantPrefixCount = 0;
    prefixCounts.forEach((count, prefix) => {
        if (count > dominantPrefixCount) {
            dominantPrefix = prefix;
            dominantPrefixCount = count;
        }
    });

    const shouldPromote =
        resourceDiagnostics.length >= 3 ||
        affectedLinks.size >= 2 ||
        dominantPrefixCount >= 3;

    if (!shouldPromote) {
        return null;
    }

    const parts = [];
    if (visualMissing > 0) parts.push(`${visualMissing} visual mesh`);
    if (collisionMissing > 0) parts.push(`${collisionMissing} collision mesh`);
    if (textureMissing > 0) parts.push(`${textureMissing} texture`);

    const details = [];
    if (parts.length > 0) {
        details.push(`Missing: ${parts.join(', ')}.`);
    }
    if (dominantPrefix && dominantPrefixCount >= 3) {
        details.push(`Most missing files are under "${dominantPrefix}".`);
    }

    const summary = createDiagnostic({
        level: 'error',
        code: 'resource/missing-summary',
        source: model.userData?.fileType || model.threeObject?.userData?.type || 'model',
        message: affectedLinks.size > 0
            ? `Model is missing ${resourceDiagnostics.length} resources across ${affectedLinks.size} links. Visualization is incomplete.`
            : `Model is missing ${resourceDiagnostics.length} resources. Visualization is incomplete.`,
        details: details.join(' '),
        filePath: model.userData?.filePath || ''
    });

    diagnostics.unshift(summary);
    return summary;
}

function nextDiagnosticId() {
    diagnosticId += 1;
    return `diag-${diagnosticId}`;
}

function ensureUserData(target) {
    if (!target) return {};
    if (!target.userData) {
        target.userData = {};
    }
    return target.userData;
}

export function getChannel(level, code) {
    if (level === 'fatal') {
        return 'banner';
    }

    if (level === 'error' && code === 'resource/missing-summary') {
        return 'banner';
    }

    if (level === 'error' && (
        code === 'model/no-links' ||
        code === 'model/root-link-missing' ||
        code === 'model/load-failed'
    )) {
        return 'banner';
    }

    return 'panel';
}

export function computeHealthState(diagnostics = []) {
    let hasError = false;
    let hasWarning = false;
    let hasFatal = false;

    diagnostics.forEach(diagnostic => {
        if (diagnostic?.level === 'fatal') hasFatal = true;
        else if (diagnostic?.level === 'error') hasError = true;
        else if (diagnostic?.level === 'warning') hasWarning = true;
    });

    if (hasFatal) return 'unloadable';
    if (hasError) return 'broken';
    if (hasWarning) return 'degraded';
    return 'healthy';
}

export function createDiagnostic({
    level = 'info',
    code = '',
    source = '',
    message = '',
    details = '',
    filePath = '',
    targetType = '',
    targetName = '',
    path = '',
    candidates = [],
    metadata = {}
} = {}) {
    const channel = getChannel(level, code);
    return {
        id: nextDiagnosticId(),
        level,
        channel,
        code,
        source,
        message,
        details,
        filePath,
        targetType,
        targetName,
        path,
        candidates: Array.isArray(candidates) ? candidates : [],
        metadata
    };
}

export function getDiagnostics(target) {
    const userData = ensureUserData(target);
    if (!Array.isArray(userData.diagnostics)) {
        userData.diagnostics = [];
    }
    return userData.diagnostics;
}

export function addDiagnostic(target, diagnostic) {
    if (!target || !diagnostic) return null;
    const diagnostics = getDiagnostics(target);
    diagnostics.push(diagnostic);
    return diagnostic;
}

export function addDiagnostics(target, diagnostics = []) {
    if (!target || !Array.isArray(diagnostics) || diagnostics.length === 0) {
        return [];
    }

    const targetDiagnostics = getDiagnostics(target);
    diagnostics.forEach(diagnostic => {
        if (diagnostic) {
            targetDiagnostics.push(diagnostic);
        }
    });

    return targetDiagnostics;
}

export function clearDiagnostics(target) {
    if (!target) return;
    const userData = ensureUserData(target);
    userData.diagnostics = [];
}

export function summarizeDiagnostics(diagnostics = []) {
    return diagnostics.reduce((summary, diagnostic) => {
        const level = diagnostic?.level || 'info';
        summary.total += 1;
        summary[level] = (summary[level] || 0) + 1;
        return summary;
    }, {
        total: 0,
        error: 0,
        warning: 0,
        info: 0
    });
}

export function indexDiagnosticsByTarget(model) {
    const index = {
        link: new Map(),
        joint: new Map()
    };

    const diagnostics = getDiagnostics(model);
    diagnostics.forEach(diagnostic => {
        if (!diagnostic?.targetType || !diagnostic?.targetName) {
            return;
        }

        const targetMap = index[diagnostic.targetType];
        if (!targetMap) {
            return;
        }

        if (!targetMap.has(diagnostic.targetName)) {
            targetMap.set(diagnostic.targetName, []);
        }

        targetMap.get(diagnostic.targetName).push(diagnostic);
    });

    return index;
}

export function validateModelDiagnostics(model, context = {}) {
    if (!model) {
        return [];
    }

    const diagnostics = [];
    const source = context.source || '';
    const filePath = context.filePath || '';
    const content = context.content || '';
    const isRobotModel = ['urdf', 'xacro', 'mjcf'].includes(source);
    const getSourceInfo = (targetType, targetName, tagName) => {
        const collection = targetType === 'link' ? model.links : model.joints;
        const target = collection?.get(targetName);
        const mappedSourceInfo = target?.userData?.sourceInfo || null;

        if (mappedSourceInfo) {
            return {
                filePath: mappedSourceInfo.filePath || filePath,
                lineNumber: mappedSourceInfo.lineNumber || null,
                searchText: mappedSourceInfo.searchText || `<${tagName} name="${targetName}"`,
                macro: mappedSourceInfo.macro || '',
                args: mappedSourceInfo.args || []
            };
        }

        const position = findNamedElementPosition(content, tagName, targetName);
        return {
            filePath,
            lineNumber: position.lineNumber,
            searchText: position.searchText,
            macro: '',
            args: []
        };
    };
    const getSourceDetails = (sourceInfo) => {
        const details = [];
        if (sourceInfo.macro) {
            details.push(`Macro: ${sourceInfo.macro}.`);
        }
        if (sourceInfo.args?.length > 0) {
            details.push(`Args: ${sourceInfo.args.join(', ')}.`);
        }
        return details.join(' ');
    };

    if (isRobotModel && (!model.links || model.links.size === 0)) {
        diagnostics.push(createDiagnostic({
            level: 'error',
            code: 'model/no-links',
            source,
            message: 'No links were generated for this model.',
            filePath
        }));
    }

    if (isRobotModel && (!model.rootLink || !model.links?.has(model.rootLink))) {
        diagnostics.push(createDiagnostic({
            level: 'error',
            code: 'model/root-link-missing',
            source,
            message: 'Root link could not be determined.',
            filePath
        }));
    }

    if (model.links) {
        model.links.forEach((link, linkName) => {
            if (link?.inertial) {
                const mass = link.inertial.mass;
                if (Number.isFinite(mass) && mass <= 0) {
                    const sourceInfo = getSourceInfo('link', linkName, 'link');
                    diagnostics.push(createDiagnostic({
                        level: 'warning',
                        code: 'link/invalid-mass',
                        source,
                        targetType: 'link',
                        targetName: linkName,
                        message: `Link "${linkName}" has a non-positive mass.`,
                        filePath: sourceInfo.filePath,
                        details: getSourceDetails(sourceInfo),
                        metadata: {
                            lineNumber: sourceInfo.lineNumber,
                            searchText: sourceInfo.searchText,
                            macro: sourceInfo.macro,
                            args: sourceInfo.args
                        }
                    }));
                }
            }
        });
    }

    if (model.joints) {
        model.joints.forEach((joint, jointName) => {
            if (!joint.parent || !model.links?.has(joint.parent)) {
                const sourceInfo = getSourceInfo('joint', jointName, 'joint');
                diagnostics.push(createDiagnostic({
                    level: 'error',
                    code: 'joint/missing-parent',
                    source,
                    targetType: 'joint',
                    targetName: jointName,
                    message: `Joint "${jointName}" is missing a valid parent link.`,
                    filePath: sourceInfo.filePath,
                    details: getSourceDetails(sourceInfo),
                    metadata: {
                        lineNumber: sourceInfo.lineNumber,
                        searchText: sourceInfo.searchText,
                        macro: sourceInfo.macro,
                        args: sourceInfo.args
                    }
                }));
            }

            if (!joint.child || !model.links?.has(joint.child)) {
                const sourceInfo = getSourceInfo('joint', jointName, 'joint');
                diagnostics.push(createDiagnostic({
                    level: 'error',
                    code: 'joint/missing-child',
                    source,
                    targetType: 'joint',
                    targetName: jointName,
                    message: `Joint "${jointName}" is missing a valid child link.`,
                    filePath: sourceInfo.filePath,
                    details: getSourceDetails(sourceInfo),
                    metadata: {
                        lineNumber: sourceInfo.lineNumber,
                        searchText: sourceInfo.searchText,
                        macro: sourceInfo.macro,
                        args: sourceInfo.args
                    }
                }));
            }

            if (joint.limits && Number.isFinite(joint.limits.lower) && Number.isFinite(joint.limits.upper)) {
                if (joint.limits.lower > joint.limits.upper) {
                    const sourceInfo = getSourceInfo('joint', jointName, 'joint');
                    diagnostics.push(createDiagnostic({
                        level: 'error',
                        code: 'joint/invalid-limits',
                        source,
                        targetType: 'joint',
                        targetName: jointName,
                        message: `Joint "${jointName}" has lower limit greater than upper limit.`,
                        filePath: sourceInfo.filePath,
                        details: getSourceDetails(sourceInfo),
                        metadata: {
                            lineNumber: sourceInfo.lineNumber,
                            searchText: sourceInfo.searchText,
                            macro: sourceInfo.macro,
                            args: sourceInfo.args
                        }
                    }));
                }
            }
        });
    }

    return diagnostics;
}

export function addRuntimeDiagnostic(diagnostic) {
    if (!diagnostic) return null;

    const runtimeDiagnostic = {
        ...diagnostic,
        id: diagnostic.id || nextDiagnosticId()
    };

    runtimeDiagnostics.unshift(runtimeDiagnostic);

    if (runtimeDiagnostics.length > 100) {
        runtimeDiagnostics.length = 100;
    }

    return runtimeDiagnostic;
}

export function getRuntimeDiagnostics() {
    return [...runtimeDiagnostics];
}

export function clearRuntimeDiagnostics() {
    runtimeDiagnostics.length = 0;
}
