export const REVIEW_SNAPSHOT_KIND = 'robot-viewer.review-snapshot';
export const REVIEW_SNAPSHOT_VERSION = 1;

const DIAGNOSTIC_LEVELS = new Set(['all', 'error', 'warning', 'info']);
const TARGET_TYPES = new Set(['link', 'joint']);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value) {
    return typeof value === 'string' ? value : '';
}

function normalizeNumber(value) {
    return Number.isFinite(value) ? value : null;
}

function normalizeVector(value) {
    if (!Array.isArray(value) || value.length !== 3) {
        return null;
    }

    const normalized = value.map(item => normalizeNumber(item));
    return normalized.every(item => item !== null) ? normalized : null;
}

function cloneTarget(target) {
    if (!isPlainObject(target)) {
        return null;
    }

    const targetType = asString(target.targetType);
    const targetName = asString(target.targetName);
    if (!TARGET_TYPES.has(targetType) || !targetName) {
        return null;
    }

    return {
        targetType,
        targetName
    };
}

function normalizeCamera(camera) {
    if (!isPlainObject(camera)) {
        return null;
    }

    const mode = asString(camera.mode) || 'three';
    if (mode !== 'three') {
        const reason = asString(camera.reason);
        return {
            mode,
            reason
        };
    }

    const position = normalizeVector(camera.position);
    const target = normalizeVector(camera.target);
    if (!position || !target) {
        return null;
    }

    return {
        mode: 'three',
        position,
        target,
        up: asString(camera.up) || '+Z'
    };
}

function normalizeJointState(jointState) {
    const values = {};
    if (isPlainObject(jointState?.values)) {
        Object.entries(jointState.values).forEach(([jointName, jointValue]) => {
            const normalizedName = asString(jointName);
            const normalizedValue = normalizeNumber(jointValue);
            if (normalizedName && normalizedValue !== null) {
                values[normalizedName] = normalizedValue;
            }
        });
    }

    return {
        values
    };
}

function normalizeDiagnosticsState(diagnostics) {
    const filters = isPlainObject(diagnostics?.filters) ? diagnostics.filters : {};
    const level = DIAGNOSTIC_LEVELS.has(filters.level) ? filters.level : 'all';

    return {
        filters: {
            level,
            focusedOnly: Boolean(filters.focusedOnly)
        },
        focusedTarget: cloneTarget(diagnostics?.focusedTarget)
    };
}

function normalizeCommentBody(body) {
    const normalized = asString(body).trim();
    return normalized || '';
}

export function createDiagnosticAnchor(diagnostic = {}) {
    const metadata = isPlainObject(diagnostic.metadata) ? diagnostic.metadata : {};
    const lineNumber = normalizeNumber(metadata.lineNumber);

    const anchor = {
        code: asString(diagnostic.code),
        source: asString(diagnostic.source),
        level: asString(diagnostic.level),
        targetType: asString(diagnostic.targetType),
        targetName: asString(diagnostic.targetName),
        filePath: asString(diagnostic.filePath),
        lineNumber,
        searchText: asString(metadata.searchText),
        path: asString(diagnostic.path),
        message: asString(diagnostic.message)
    };

    const hasMeaningfulContent = Object.values(anchor).some(value => value !== '' && value !== null);
    return hasMeaningfulContent ? anchor : null;
}

export function normalizeDiagnosticAnchor(anchor) {
    if (!isPlainObject(anchor)) {
        return null;
    }

    return createDiagnosticAnchor({
        code: anchor.code,
        source: anchor.source,
        level: anchor.level,
        targetType: anchor.targetType,
        targetName: anchor.targetName,
        filePath: anchor.filePath,
        path: anchor.path,
        message: anchor.message,
        metadata: {
            lineNumber: anchor.lineNumber,
            searchText: anchor.searchText
        }
    });
}

export function getDiagnosticAnchorKey(anchor) {
    const normalized = normalizeDiagnosticAnchor(anchor);
    if (!normalized) {
        return '';
    }

    return JSON.stringify([
        normalized.code,
        normalized.source,
        normalized.level,
        normalized.targetType,
        normalized.targetName,
        normalized.filePath,
        normalized.lineNumber,
        normalized.searchText,
        normalized.path,
        normalized.message
    ]);
}

export function diagnosticsMatchAnchor(diagnostic, anchor) {
    const diagnosticAnchor = createDiagnosticAnchor(diagnostic);
    if (!diagnosticAnchor) {
        return false;
    }

    return getDiagnosticAnchorKey(diagnosticAnchor) === getDiagnosticAnchorKey(anchor);
}

function normalizeSelection(selection) {
    if (!isPlainObject(selection)) {
        return null;
    }

    const kind = asString(selection.kind);
    if (kind === 'link' || kind === 'joint') {
        const targetName = asString(selection.targetName);
        if (!targetName) {
            return null;
        }

        return {
            kind,
            targetName
        };
    }

    if (kind === 'resource') {
        const filePath = asString(selection.filePath);
        const fileName = asString(selection.fileName);
        if (!filePath && !fileName) {
            return null;
        }

        return {
            kind,
            filePath,
            fileName,
            extension: asString(selection.extension).toLowerCase()
        };
    }

    if (kind === 'diagnostic') {
        const anchor = normalizeDiagnosticAnchor(selection.anchor);
        if (!anchor) {
            return null;
        }

        return {
            kind,
            anchor
        };
    }

    return null;
}

function normalizeReviewComment(comment) {
    if (!isPlainObject(comment)) {
        return null;
    }

    const id = asString(comment.id);
    const body = normalizeCommentBody(comment.body);
    const createdAt = asString(comment.createdAt) || new Date().toISOString();
    const anchor = normalizeSelection(comment.anchor);

    if (!id || !body || !anchor) {
        return null;
    }

    return {
        id,
        body,
        createdAt,
        anchor
    };
}

function normalizeReviewComments(comments) {
    if (!Array.isArray(comments)) {
        return [];
    }

    return comments
        .map(comment => normalizeReviewComment(comment))
        .filter(Boolean);
}

function normalizeModel(model) {
    if (!isPlainObject(model)) {
        return null;
    }

    const filePath = asString(model.filePath);
    const fileName = asString(model.fileName);
    const fileType = asString(model.fileType);

    if (!filePath && !fileName && !fileType) {
        return null;
    }

    return {
        filePath,
        fileName,
        fileType
    };
}

export function normalizeReviewSnapshot(snapshot = {}) {
    const context = isPlainObject(snapshot.context) ? snapshot.context : {};
    const createdAt = asString(snapshot.createdAt) || new Date().toISOString();

    return {
        kind: REVIEW_SNAPSHOT_KIND,
        version: REVIEW_SNAPSHOT_VERSION,
        createdAt,
        model: normalizeModel(snapshot.model),
        comments: normalizeReviewComments(snapshot.comments),
        context: {
            camera: normalizeCamera(context.camera),
            selection: normalizeSelection(context.selection),
            jointState: normalizeJointState(context.jointState),
            diagnostics: normalizeDiagnosticsState(context.diagnostics)
        }
    };
}

export function createReviewSnapshot({
    createdAt = new Date().toISOString(),
    model = null,
    comments = [],
    context = {}
} = {}) {
    return normalizeReviewSnapshot({
        kind: REVIEW_SNAPSHOT_KIND,
        version: REVIEW_SNAPSHOT_VERSION,
        createdAt,
        model,
        comments,
        context
    });
}

export function stringifyReviewSnapshot(snapshot) {
    return JSON.stringify(normalizeReviewSnapshot(snapshot), null, 2);
}

export function parseReviewSnapshot(jsonText) {
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    } catch (error) {
        throw new Error(`Invalid snapshot JSON: ${error.message}`);
    }

    if (!isPlainObject(parsed)) {
        throw new Error('Snapshot JSON must be an object.');
    }

    return normalizeReviewSnapshot(parsed);
}
