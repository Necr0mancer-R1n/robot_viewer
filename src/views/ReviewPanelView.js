import { getDiagnosticAnchorKey } from '../review/ReviewSnapshot.mjs';

export class ReviewPanelView {
    constructor() {
        this.comments = [];
        this.currentAnchor = null;
        this.activeCommentId = null;
        this.editingCommentId = null;
        this.onAddComment = null;
        this.onSelectComment = null;
        this.onUpdateComment = null;
        this.onDeleteComment = null;
        this.onToggle3DSelection = null;
        this.is3DSelectionEnabled = false;

        this.listEl = null;
        this.targetEl = null;
        this.textareaEl = null;
        this.addBtnEl = null;
        this.cancelBtnEl = null;
        this.countEl = null;
        this.select3DBtnEl = null;
    }

    init() {
        this.listEl = document.getElementById('review-comments-list');
        this.targetEl = document.getElementById('review-current-target');
        this.textareaEl = document.getElementById('review-comment-input');
        this.addBtnEl = document.getElementById('add-review-comment-btn');
        this.cancelBtnEl = document.getElementById('cancel-review-edit-btn');
        this.countEl = document.getElementById('review-comment-count');
        this.select3DBtnEl = document.getElementById('toggle-review-3d-selection-btn');

        if (this.textareaEl) {
            this.textareaEl.addEventListener('input', () => {
                this.updateComposerState();
            });
        }

        if (this.addBtnEl) {
            this.addBtnEl.addEventListener('click', () => {
                this.submitComposer();
            });
        }

        if (this.cancelBtnEl) {
            this.cancelBtnEl.addEventListener('click', () => {
                this.cancelEditing();
            });
        }

        if (this.select3DBtnEl) {
            this.select3DBtnEl.addEventListener('click', () => {
                this.onToggle3DSelection?.();
            });
        }

        this.render();
    }

    setCurrentAnchor(anchor) {
        this.currentAnchor = this.cloneAnchor(anchor);
        this.syncActiveCommentToCurrentAnchor();
        this.render3DSelectionButton();
        this.renderCurrentTarget();
        this.renderComments();
        this.updateComposerState();
    }

    setComments(comments = []) {
        this.comments = Array.isArray(comments)
            ? comments.map(comment => this.cloneComment(comment)).filter(Boolean)
            : [];

        if (this.editingCommentId && !this.getCommentById(this.editingCommentId)) {
            this.editingCommentId = null;
            if (this.textareaEl) {
                this.textareaEl.value = '';
            }
        }

        this.syncActiveCommentToCurrentAnchor();
        this.render3DSelectionButton();
        this.renderCurrentTarget();
        this.renderComments();
        this.updateComposerState();
    }

    set3DSelectionEnabled(enabled) {
        this.is3DSelectionEnabled = Boolean(enabled);
        this.render3DSelectionButton();
    }

    render() {
        this.render3DSelectionButton();
        this.renderCurrentTarget();
        this.renderComments();
        this.updateComposerState();
    }

    render3DSelectionButton() {
        if (!this.select3DBtnEl) {
            return;
        }

        this.select3DBtnEl.classList.toggle('active', this.is3DSelectionEnabled);
        this.select3DBtnEl.textContent = this.is3DSelectionEnabled
            ? (window.i18n?.t('reviewStopSelectingIn3D') || 'Stop 3D Picking')
            : (window.i18n?.t('reviewSelectIn3D') || 'Pick In 3D');
    }

    renderCurrentTarget() {
        if (!this.targetEl) {
            return;
        }

        const displayAnchor = this.getDisplayAnchor();
        if (!displayAnchor) {
            this.targetEl.textContent = window.i18n?.t('reviewNoTargetSelected') || 'Select a link, joint, or diagnostic to attach a comment.';
            this.targetEl.classList.add('empty');
            this.targetEl.classList.remove('active');
            return;
        }

        this.targetEl.classList.remove('empty');
        this.targetEl.classList.add('active');
        const targetText = this.describeAnchor(displayAnchor);
        if (this.editingCommentId) {
            this.targetEl.textContent = `${window.i18n?.t('reviewEditingTarget') || 'Editing'}: ${targetText}`;
        } else {
            this.targetEl.textContent = targetText;
        }
    }

    renderComments() {
        if (!this.listEl) {
            return;
        }

        this.listEl.innerHTML = '';

        if (this.countEl) {
            this.countEl.textContent = `${this.comments.length}`;
        }

        if (!this.comments.length) {
            const empty = document.createElement('div');
            empty.className = 'review-comments-empty';
            empty.textContent = window.i18n?.t('reviewNoComments') || 'No review comments yet.';
            this.listEl.appendChild(empty);
            return;
        }

        this.comments.forEach(comment => {
            const item = document.createElement('div');
            item.className = 'review-comment-item';
            if (comment.id === this.activeCommentId) {
                item.classList.add('active');
            }
            if (comment.id === this.editingCommentId) {
                item.classList.add('editing');
            }

            const header = document.createElement('div');
            header.className = 'review-comment-header';

            const target = document.createElement('div');
            target.className = 'review-comment-target';
            target.textContent = this.describeAnchor(comment.anchor);
            header.appendChild(target);

            const timestamp = document.createElement('div');
            timestamp.className = 'review-comment-time';
            timestamp.textContent = this.formatTimestamp(comment.createdAt);
            header.appendChild(timestamp);

            const toolbar = document.createElement('div');
            toolbar.className = 'review-comment-toolbar';

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'review-comment-action-btn';
            editBtn.textContent = window.i18n?.t('reviewEditComment') || 'Edit';
            editBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.startEditingComment(comment);
            });
            toolbar.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'review-comment-action-btn delete';
            deleteBtn.textContent = window.i18n?.t('reviewDeleteComment') || 'Delete';
            deleteBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                const deleted = this.onDeleteComment?.(comment);
                if (deleted !== false && this.editingCommentId === comment.id) {
                    this.cancelEditing(false);
                }
            });
            toolbar.appendChild(deleteBtn);

            const body = document.createElement('div');
            body.className = 'review-comment-body';
            body.textContent = comment.body;

            item.appendChild(header);
            item.appendChild(toolbar);
            item.appendChild(body);
            item.addEventListener('click', () => {
                this.activeCommentId = comment.id;
                this.renderComments();
                this.onSelectComment?.(comment);
            });

            this.listEl.appendChild(item);
        });
    }

    updateComposerState() {
        if (!this.addBtnEl) {
            return;
        }

        const hasBody = Boolean(this.textareaEl?.value?.trim());
        const canSubmit = this.editingCommentId ? hasBody : Boolean(this.currentAnchor) && hasBody;
        this.addBtnEl.disabled = !canSubmit;
        this.addBtnEl.textContent = this.editingCommentId
            ? (window.i18n?.t('reviewSaveComment') || 'Save')
            : (window.i18n?.t('reviewAddComment') || 'Add Comment');

        if (this.cancelBtnEl) {
            this.cancelBtnEl.hidden = !this.editingCommentId;
        }
    }

    formatTimestamp(value) {
        const date = value ? new Date(value) : null;
        if (!date || Number.isNaN(date.getTime())) {
            return '';
        }

        try {
            return date.toLocaleString();
        } catch {
            return value;
        }
    }

    describeAnchor(anchor) {
        if (!anchor) {
            return window.i18n?.t('reviewNoTargetSelected') || 'No target selected';
        }

        if (anchor.kind === 'link') {
            return `${window.i18n?.t('reviewTargetLink') || 'Link'}: ${anchor.targetName}`;
        }

        if (anchor.kind === 'joint') {
            return `${window.i18n?.t('reviewTargetJoint') || 'Joint'}: ${anchor.targetName}`;
        }

        if (anchor.kind === 'resource') {
            const label = anchor.filePath || anchor.fileName || 'resource';
            return `${window.i18n?.t('reviewTargetResource') || 'File'}: ${label}`;
        }

        if (anchor.kind === 'diagnostic') {
            const diagnosticAnchor = anchor.anchor || {};
            const targetName = diagnosticAnchor.targetName || diagnosticAnchor.code || 'diagnostic';
            return `${window.i18n?.t('reviewTargetDiagnostic') || 'Diagnostic'}: ${targetName}`;
        }

        return window.i18n?.t('reviewNoTargetSelected') || 'No target selected';
    }

    submitComposer() {
        const body = this.textareaEl?.value?.trim() || '';
        if (!body) {
            this.updateComposerState();
            return;
        }

        if (this.editingCommentId) {
            const updated = this.onUpdateComment?.(this.editingCommentId, body);
            if (updated !== false) {
                this.cancelEditing(false);
            }
            return;
        }

        if (!this.currentAnchor) {
            this.updateComposerState();
            return;
        }

        const added = this.onAddComment?.(body, this.currentAnchor);
        if (added !== false && this.textareaEl) {
            this.textareaEl.value = '';
        }
        this.updateComposerState();
    }

    startEditingComment(comment) {
        if (!comment) {
            return;
        }

        this.editingCommentId = comment.id;
        this.activeCommentId = comment.id;
        if (this.textareaEl) {
            this.textareaEl.value = comment.body || '';
            this.textareaEl.focus();
            const end = this.textareaEl.value.length;
            this.textareaEl.setSelectionRange(end, end);
        }

        this.renderCurrentTarget();
        this.renderComments();
        this.updateComposerState();
        this.onSelectComment?.(comment);
    }

    cancelEditing(syncSelection = true) {
        this.editingCommentId = null;
        if (this.textareaEl) {
            this.textareaEl.value = '';
        }

        if (syncSelection) {
            this.syncActiveCommentToCurrentAnchor();
        }

        this.renderCurrentTarget();
        this.renderComments();
        this.updateComposerState();
    }

    getDisplayAnchor() {
        if (this.editingCommentId) {
            return this.getCommentById(this.editingCommentId)?.anchor || this.currentAnchor;
        }

        return this.currentAnchor;
    }

    getCommentById(commentId) {
        if (!commentId) {
            return null;
        }

        return this.comments.find(comment => comment.id === commentId) || null;
    }

    syncActiveCommentToCurrentAnchor() {
        if (this.editingCommentId) {
            this.activeCommentId = this.editingCommentId;
            return;
        }

        if (!this.currentAnchor) {
            this.activeCommentId = null;
            return;
        }

        const activeComment = this.getCommentById(this.activeCommentId);
        if (activeComment && this.anchorsEqual(activeComment.anchor, this.currentAnchor)) {
            return;
        }

        const matchedComment = this.comments.find(comment => this.anchorsEqual(comment.anchor, this.currentAnchor));
        this.activeCommentId = matchedComment?.id || null;
    }

    anchorsEqual(anchorA, anchorB) {
        if (!anchorA || !anchorB || anchorA.kind !== anchorB.kind) {
            return false;
        }

        if (anchorA.kind === 'diagnostic') {
            return getDiagnosticAnchorKey(anchorA.anchor) === getDiagnosticAnchorKey(anchorB.anchor);
        }

        if (anchorA.kind === 'resource') {
            const resourceKeyA = `${anchorA.filePath || ''}::${anchorA.fileName || ''}`;
            const resourceKeyB = `${anchorB.filePath || ''}::${anchorB.fileName || ''}`;
            return resourceKeyA === resourceKeyB;
        }

        return anchorA.targetName === anchorB.targetName;
    }

    cloneComment(comment) {
        if (!comment) {
            return null;
        }

        return {
            id: comment.id,
            body: comment.body,
            createdAt: comment.createdAt,
            anchor: this.cloneAnchor(comment.anchor)
        };
    }

    cloneAnchor(anchor) {
        if (!anchor) {
            return null;
        }

        if (anchor.kind === 'diagnostic') {
            return {
                kind: 'diagnostic',
                anchor: anchor.anchor ? { ...anchor.anchor } : null
            };
        }

        if (anchor.kind === 'resource') {
            return {
                kind: 'resource',
                filePath: anchor.filePath || '',
                fileName: anchor.fileName || '',
                extension: anchor.extension || ''
            };
        }

        return {
            kind: anchor.kind,
            targetName: anchor.targetName
        };
    }
}
