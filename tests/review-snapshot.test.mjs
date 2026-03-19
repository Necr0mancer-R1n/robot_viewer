import test from 'node:test';
import assert from 'node:assert/strict';

import {
    REVIEW_SNAPSHOT_KIND,
    REVIEW_SNAPSHOT_VERSION,
    createDiagnosticAnchor,
    createReviewSnapshot,
    diagnosticsMatchAnchor,
    parseReviewSnapshot,
    stringifyReviewSnapshot
} from '../src/review/ReviewSnapshot.mjs';

test('diagnostic anchor matches across transient ids', () => {
    const diagnostic = {
        id: 'diag-1',
        code: 'joint/invalid-limits',
        source: 'urdf',
        level: 'error',
        targetType: 'joint',
        targetName: 'elbow_joint',
        filePath: 'robot.urdf',
        message: 'Joint "elbow_joint" has lower limit greater than upper limit.',
        metadata: {
            lineNumber: 42,
            searchText: '<joint name="elbow_joint"'
        }
    };

    const anchor = createDiagnosticAnchor(diagnostic);
    assert.ok(anchor);

    const sameDiagnosticWithNewRuntimeId = {
        ...diagnostic,
        id: 'diag-99'
    };

    assert.equal(diagnosticsMatchAnchor(sameDiagnosticWithNewRuntimeId, anchor), true);
});

test('snapshot parsing normalizes review context', () => {
    const parsed = parseReviewSnapshot(JSON.stringify({
        model: {
            filePath: 'robots/demo.urdf',
            fileName: 'demo.urdf',
            fileType: 'urdf'
        },
        context: {
            camera: {
                mode: 'three',
                up: '+Y',
                position: [1, 2, 3],
                target: [0, 0, 0]
            },
            selection: {
                kind: 'joint',
                targetName: 'wrist_joint'
            },
            jointState: {
                values: {
                    wrist_joint: 1.57,
                    invalid_joint: 'ignore-me'
                }
            },
            diagnostics: {
                filters: {
                    level: 'warning',
                    focusedOnly: 1
                },
                focusedTarget: {
                    targetType: 'joint',
                    targetName: 'wrist_joint'
                }
            }
        }
    }));

    assert.equal(parsed.kind, REVIEW_SNAPSHOT_KIND);
    assert.equal(parsed.version, REVIEW_SNAPSHOT_VERSION);
    assert.deepEqual(parsed.context.camera, {
        mode: 'three',
        up: '+Y',
        position: [1, 2, 3],
        target: [0, 0, 0]
    });
    assert.deepEqual(parsed.context.selection, {
        kind: 'joint',
        targetName: 'wrist_joint'
    });
    assert.deepEqual(parsed.context.jointState, {
        values: {
            wrist_joint: 1.57
        }
    });
    assert.deepEqual(parsed.context.diagnostics, {
        filters: {
            level: 'warning',
            focusedOnly: true
        },
        focusedTarget: {
            targetType: 'joint',
            targetName: 'wrist_joint'
        }
    });
    assert.deepEqual(parsed.comments, []);
});

test('snapshot parsing normalizes resource review anchors', () => {
    const parsed = parseReviewSnapshot(JSON.stringify({
        comments: [
            {
                id: 'comment-resource-1',
                body: 'Review this mesh asset.',
                createdAt: '2026-03-18T13:39:00.000Z',
                anchor: {
                    kind: 'resource',
                    filePath: '/robots/demo/meshes/base.GLB',
                    fileName: 'base.GLB',
                    extension: 'GLB'
                }
            }
        ],
        context: {
            selection: {
                kind: 'resource',
                filePath: '/robots/demo/meshes/base.GLB',
                fileName: 'base.GLB',
                extension: 'GLB'
            }
        }
    }));

    assert.deepEqual(parsed.comments[0].anchor, {
        kind: 'resource',
        filePath: '/robots/demo/meshes/base.GLB',
        fileName: 'base.GLB',
        extension: 'glb'
    });
    assert.deepEqual(parsed.context.selection, {
        kind: 'resource',
        filePath: '/robots/demo/meshes/base.GLB',
        fileName: 'base.GLB',
        extension: 'glb'
    });
});

test('snapshot round-trip keeps diagnostic selection anchors and comments', () => {
    const snapshot = createReviewSnapshot({
        model: {
            filePath: 'robots/demo.urdf',
            fileName: 'demo.urdf',
            fileType: 'urdf'
        },
        comments: [
            {
                id: 'comment-1',
                body: 'Check the missing mesh before sharing this review.',
                createdAt: '2026-03-18T13:37:45.270Z',
                anchor: {
                    kind: 'diagnostic',
                    anchor: {
                        code: 'resource/missing',
                        source: 'urdf',
                        level: 'error',
                        targetType: 'link',
                        targetName: 'base_link',
                        filePath: 'robots/demo.urdf',
                        lineNumber: 18,
                        searchText: 'filename="meshes/base.stl"',
                        path: 'meshes/base.stl',
                        message: 'Missing visual mesh for link "base_link": meshes/base.stl'
                    }
                }
            },
            {
                id: 'comment-2',
                body: 'Joint pose looks acceptable here.',
                createdAt: '2026-03-18T13:38:00.000Z',
                anchor: {
                    kind: 'joint',
                    targetName: 'shoulder_joint'
                }
            },
            {
                id: 'comment-3',
                body: 'Confirm this part file is the final delivery asset.',
                createdAt: '2026-03-18T13:38:30.000Z',
                anchor: {
                    kind: 'resource',
                    filePath: 'robots/demo/meshes/base.glb',
                    fileName: 'base.glb',
                    extension: 'glb'
                }
            }
        ],
        context: {
            camera: {
                mode: 'three',
                up: '+Z',
                position: [2, 3, 4],
                target: [0.1, 0.2, 0.3]
            },
            selection: {
                kind: 'diagnostic',
                anchor: {
                    code: 'resource/missing',
                    source: 'urdf',
                    level: 'error',
                    targetType: 'link',
                    targetName: 'base_link',
                    filePath: 'robots/demo.urdf',
                    lineNumber: 18,
                    searchText: 'filename="meshes/base.stl"',
                    path: 'meshes/base.stl',
                    message: 'Missing visual mesh for link "base_link": meshes/base.stl'
                }
            },
            jointState: {
                values: {
                    shoulder_joint: 0.5
                }
            },
            diagnostics: {
                filters: {
                    level: 'error',
                    focusedOnly: false
                },
                focusedTarget: {
                    targetType: 'link',
                    targetName: 'base_link'
                }
            }
        }
    });

    const reparsed = parseReviewSnapshot(stringifyReviewSnapshot(snapshot));
    assert.equal(reparsed.comments.length, 3);
    assert.deepEqual(reparsed.comments, snapshot.comments);
    assert.deepEqual(reparsed.context.selection, snapshot.context.selection);
    assert.deepEqual(reparsed.context.jointState, snapshot.context.jointState);
    assert.deepEqual(reparsed.context.diagnostics, snapshot.context.diagnostics);
});
