import { getDiagnostics, getRuntimeDiagnostics, summarizeDiagnostics, computeHealthState } from '../utils/DiagnosticsUtils.js';
import { createDiagnosticAnchor, diagnosticsMatchAnchor, getDiagnosticAnchorKey } from '../review/ReviewSnapshot.mjs';

export class DiagnosticsView {
    constructor(sceneManager, codeEditorManager = null) {
        this.sceneManager = sceneManager;
        this.codeEditorManager = codeEditorManager;
        this.currentModel = null;
        this.currentFile = null;
        this.focusedTarget = null;
        this.selectedDiagnosticAnchor = null;
        this.onSelectionChanged = null;
        this.currentHealth = 'healthy';
        this.filters = {
            level: 'all',
            focusedOnly: false
        };
    }

    setCodeEditorManager(manager) {
        this.codeEditorManager = manager;
    }

    getAllDiagnostics(model = this.currentModel) {
        return {
            modelDiagnostics: model ? getDiagnostics(model) : [],
            runtimeDiagnostics: getRuntimeDiagnostics()
        };
    }

    getSnapshotState() {
        return {
            filters: {
                ...this.filters
            },
            focusedTarget: this.focusedTarget ? { ...this.focusedTarget } : null
        };
    }

    applySnapshotState(state = {}) {
        const filters = state.filters || {};
        const validLevels = new Set(['all', 'error', 'warning', 'info']);

        this.filters = {
            level: validLevels.has(filters.level) ? filters.level : 'all',
            focusedOnly: Boolean(filters.focusedOnly)
        };

        const focusedTarget = state.focusedTarget;
        this.focusedTarget = focusedTarget?.targetType && focusedTarget?.targetName
            ? {
                targetType: focusedTarget.targetType,
                targetName: focusedTarget.targetName
            }
            : null;

        this.render(this.currentModel, this.currentFile);

        if (this.focusedTarget) {
            this.focusTarget(this.focusedTarget.targetType, this.focusedTarget.targetName, false, false);
        }

        this.onSelectionChanged?.();
    }

    getSelectedDiagnosticAnchor() {
        return this.selectedDiagnosticAnchor ? { ...this.selectedDiagnosticAnchor } : null;
    }

    clearSelectedDiagnostic() {
        this.selectedDiagnosticAnchor = null;
        this.syncSelectedDiagnostic(false);
        this.onSelectionChanged?.();
    }

    syncSelectedDiagnostic(scroll = false) {
        const selectedKey = getDiagnosticAnchorKey(this.selectedDiagnosticAnchor);
        let found = false;

        const items = document.querySelectorAll('#diagnostics-panel-content .diagnostic-item');
        items.forEach(item => {
            const matches = Boolean(selectedKey) && item.dataset.anchorKey === selectedKey;
            item.classList.toggle('selected', matches);
            if (matches) {
                found = true;
                if (scroll) {
                    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        });

        return found;
    }

    findDiagnosticByAnchor(anchor) {
        const { modelDiagnostics, runtimeDiagnostics } = this.getAllDiagnostics();
        const diagnostics = [...modelDiagnostics, ...runtimeDiagnostics];
        return diagnostics.find(diagnostic => diagnosticsMatchAnchor(diagnostic, anchor)) || null;
    }

    selectDiagnosticByAnchor(anchor, options = {}) {
        const diagnostic = this.findDiagnosticByAnchor(anchor);
        if (!diagnostic) {
            return false;
        }

        this.selectedDiagnosticAnchor = createDiagnosticAnchor(diagnostic);
        this.handleDiagnosticClick(diagnostic, options);
        return true;
    }

    render(model = this.currentModel, file = this.currentFile) {
        this.currentModel = model || null;
        this.currentFile = file || null;

        const container = document.getElementById('diagnostics-panel-content');
        if (!container) return;

        container.innerHTML = '';

        const { modelDiagnostics, runtimeDiagnostics } = this.getAllDiagnostics(model);
        const statusDiagnostics = modelDiagnostics.length > 0 ? modelDiagnostics : runtimeDiagnostics;
        const summary = summarizeDiagnostics(statusDiagnostics);

        this.currentHealth = computeHealthState(statusDiagnostics);
        this.updateHealthBanner([...modelDiagnostics, ...runtimeDiagnostics]);
        this.updateHealthStatus(model, statusDiagnostics);
        this.updateDiagnosticsButton(this.currentHealth);

        const filteredModelDiagnostics = this.getFilteredDiagnostics(modelDiagnostics);
        const filteredRuntimeDiagnostics = this.getFilteredDiagnostics(runtimeDiagnostics);

        container.appendChild(this.createSummary(summary));
        container.appendChild(this.createFiltersBar());
        container.appendChild(this.createSection(
            window.i18n?.t('modelDiagnostics') || 'Model Diagnostics',
            filteredModelDiagnostics,
            window.i18n?.t('noDiagnostics') || 'No diagnostics'
        ));
        container.appendChild(this.createSection(
            window.i18n?.t('runtimeDiagnostics') || 'Runtime Diagnostics',
            filteredRuntimeDiagnostics,
            window.i18n?.t('noRuntimeDiagnostics') || 'No runtime diagnostics'
        ));

        if (this.focusedTarget) {
            this.focusTarget(this.focusedTarget.targetType, this.focusedTarget.targetName, false, false);
        }

        this.syncSelectedDiagnostic(false);
        this.onSelectionChanged?.();
    }

    updateHealthBanner(diagnostics = []) {
        let banner = document.getElementById('diagnostics-banner');
        const bannerDiagnostics = diagnostics.filter(d => d?.channel === 'banner');

        if (!bannerDiagnostics.length) {
            if (banner) {
                banner.style.display = 'none';
                banner.innerHTML = '';
            }
            return;
        }

        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'diagnostics-banner';
            const canvasContainer = document.getElementById('canvas-container');
            if (canvasContainer) {
                canvasContainer.appendChild(banner);
            } else {
                return;
            }
        }

        const worstLevel = bannerDiagnostics.some(d => d.level === 'fatal') ? 'fatal'
            : bannerDiagnostics.some(d => d.level === 'error') ? 'error'
            : 'warning';

        banner.className = `diagnostics-banner ${worstLevel}`;
        banner.style.display = 'flex';
        banner.innerHTML = '';

        const icon = document.createElement('span');
        icon.className = 'diagnostics-banner-icon';
        icon.textContent = worstLevel === 'fatal' ? '⛔' : '⚠';
        banner.appendChild(icon);

        const textContainer = document.createElement('div');
        textContainer.className = 'diagnostics-banner-text';

        const topMsg = bannerDiagnostics[0];
        const primary = document.createElement('span');
        primary.className = 'diagnostics-banner-primary';
        primary.textContent = topMsg.message;
        textContainer.appendChild(primary);

        if (bannerDiagnostics.length > 1) {
            const secondary = document.createElement('span');
            secondary.className = 'diagnostics-banner-secondary';
            secondary.textContent = `+${bannerDiagnostics.length - 1} more`;
            textContainer.appendChild(secondary);
        }

        banner.appendChild(textContainer);

        const openBtn = document.createElement('button');
        openBtn.className = 'diagnostics-banner-btn';
        openBtn.textContent = window.i18n?.t('diagnostics') || 'Diagnostics';
        openBtn.addEventListener('click', () => {
            const panel = document.getElementById('floating-diagnostics-panel');
            const toggleBtn = document.getElementById('toggle-diagnostics-panel');
            if (panel) {
                panel.style.display = 'flex';
                if (toggleBtn) toggleBtn.classList.add('active');
            }
        });
        banner.appendChild(openBtn);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'diagnostics-banner-close';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => {
            banner.style.display = 'none';
        });
        banner.appendChild(closeBtn);
    }

    updateDiagnosticsButton(health) {
        const btn = document.getElementById('toggle-diagnostics-panel');
        if (!btn) return;

        btn.classList.remove('health-healthy', 'health-degraded', 'health-broken', 'health-unloadable');
        if (health !== 'healthy') {
            btn.classList.add(`health-${health}`);
        }
        btn.title = `${window.i18n?.t('health') || 'Health'}: ${this.getHealthLabel(health)}`;
    }

    updateHealthStatus(model, diagnostics = []) {
        let status = document.getElementById('model-health-status');

        if (!model && diagnostics.length === 0) {
            if (status) {
                status.style.display = 'none';
                status.innerHTML = '';
            }
            return;
        }

        if (!status) {
            status = document.createElement('div');
            status.id = 'model-health-status';
            const canvasContainer = document.getElementById('canvas-container');
            if (canvasContainer) {
                canvasContainer.appendChild(status);
            } else {
                return;
            }
        }

        const summary = summarizeDiagnostics(diagnostics);
        status.className = `model-health-status ${this.currentHealth}`;
        status.style.display = 'flex';
        status.innerHTML = '';

        const icon = document.createElement('span');
        icon.className = 'model-health-status-icon';
        icon.textContent = this.getHealthIcon(this.currentHealth);
        status.appendChild(icon);

        const text = document.createElement('div');
        text.className = 'model-health-status-text';

        const primary = document.createElement('span');
        primary.className = 'model-health-status-primary';
        primary.textContent = `${window.i18n?.t('health') || 'Health'}: ${this.getHealthLabel(this.currentHealth)}`;
        text.appendChild(primary);

        const secondary = document.createElement('span');
        secondary.className = 'model-health-status-secondary';
        secondary.textContent = `${summary.error} error, ${summary.warning} warning`;
        text.appendChild(secondary);

        status.appendChild(text);
    }

    focusTarget(targetType, targetName, scroll = true, refresh = true) {
        this.focusedTarget = targetType && targetName ? { targetType, targetName } : null;

        if (refresh && this.filters.focusedOnly) {
            this.render(this.currentModel, this.currentFile);
            return;
        }

        const items = document.querySelectorAll('#diagnostics-panel-content .diagnostic-item');
        items.forEach(item => {
            const matches = item.dataset.targetType === targetType && item.dataset.targetName === targetName;
            item.classList.toggle('focused', matches);
            if (matches && scroll) {
                item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });

        this.onSelectionChanged?.();
    }

    createSummary(summary) {
        const summaryEl = document.createElement('div');
        summaryEl.className = 'diagnostics-summary';

        const health = document.createElement('div');
        health.className = `diagnostics-health-chip ${this.currentHealth}`;
        health.textContent = `${window.i18n?.t('health') || 'Health'}: ${this.getHealthLabel(this.currentHealth)}`;
        summaryEl.appendChild(health);

        const chips = [
            { key: 'error', value: summary.error },
            { key: 'warning', value: summary.warning },
            { key: 'info', value: summary.info }
        ];

        chips.forEach(chip => {
            const chipEl = document.createElement('div');
            chipEl.className = `diagnostics-chip ${chip.key}`;
            chipEl.textContent = `${chip.key}: ${chip.value}`;
            summaryEl.appendChild(chipEl);
        });

        return summaryEl;
    }

    createFiltersBar() {
        const bar = document.createElement('div');
        bar.className = 'diagnostics-filters';

        const levels = ['all', 'error', 'warning', 'info'];
        levels.forEach(level => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `diagnostics-filter-btn ${this.filters.level === level ? 'active' : ''}`;
            btn.textContent = window.i18n?.t(level) || level;
            btn.addEventListener('click', () => {
                this.filters.level = level;
                this.render(this.currentModel, this.currentFile);
            });
            bar.appendChild(btn);
        });

        const focusBtn = document.createElement('button');
        focusBtn.type = 'button';
        focusBtn.className = `diagnostics-filter-btn ${this.filters.focusedOnly ? 'active' : ''}`;
        focusBtn.textContent = window.i18n?.t('focused') || 'Focused';
        if (!this.focusedTarget) {
            focusBtn.disabled = true;
        }
        focusBtn.addEventListener('click', () => {
            if (!this.focusedTarget) {
                return;
            }

            this.filters.focusedOnly = !this.filters.focusedOnly;
            this.render(this.currentModel, this.currentFile);
        });
        bar.appendChild(focusBtn);

        return bar;
    }

    getFilteredDiagnostics(diagnostics = []) {
        let filtered = diagnostics;

        if (this.filters.level !== 'all') {
            filtered = filtered.filter(diagnostic => diagnostic?.level === this.filters.level);
        }

        if (this.filters.focusedOnly && this.focusedTarget) {
            filtered = filtered.filter(diagnostic =>
                diagnostic?.targetType === this.focusedTarget.targetType &&
                diagnostic?.targetName === this.focusedTarget.targetName
            );
        }

        return filtered;
    }

    getHealthLabel(health) {
        const keyMap = {
            healthy: 'healthHealthy',
            degraded: 'healthDegraded',
            broken: 'healthBroken',
            unloadable: 'healthUnloadable'
        };
        return window.i18n?.t(keyMap[health] || 'healthHealthy') || health;
    }

    getHealthIcon(health) {
        if (health === 'healthy') return '✓';
        if (health === 'degraded') return '⚠';
        if (health === 'broken') return '⛔';
        if (health === 'unloadable') return '✕';
        return '•';
    }

    showFloatingPanel(panelId, toggleBtnId) {
        const panel = document.getElementById(panelId);
        if (panel) {
            panel.style.display = 'flex';
        }

        const toggleBtn = document.getElementById(toggleBtnId);
        if (toggleBtn) {
            toggleBtn.classList.add('active');
        }
    }

    createSection(title, diagnostics, emptyText) {
        const section = document.createElement('div');
        section.className = 'diagnostics-section';

        const header = document.createElement('div');
        header.className = 'diagnostics-section-title';
        header.textContent = `${title} (${diagnostics.length})`;
        section.appendChild(header);

        const list = document.createElement('div');
        list.className = 'diagnostics-list';

        if (!diagnostics.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = emptyText;
            list.appendChild(empty);
            section.appendChild(list);
            return section;
        }

        diagnostics.forEach(diagnostic => {
            list.appendChild(this.createDiagnosticItem(diagnostic));
        });

        section.appendChild(list);
        return section;
    }

    createDiagnosticItem(diagnostic) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `diagnostic-item ${diagnostic.level || 'info'}`;
        item.dataset.targetType = diagnostic.targetType || '';
        item.dataset.targetName = diagnostic.targetName || '';
        const anchor = createDiagnosticAnchor(diagnostic);
        item.dataset.anchorKey = getDiagnosticAnchorKey(anchor);
        if (anchor && diagnosticsMatchAnchor(diagnostic, this.selectedDiagnosticAnchor)) {
            item.classList.add('selected');
        }

        const header = document.createElement('div');
        header.className = 'diagnostic-item-header';

        const level = document.createElement('span');
        level.className = `diagnostic-level ${diagnostic.level || 'info'}`;
        level.textContent = diagnostic.level || 'info';
        header.appendChild(level);

        if (diagnostic.targetName) {
            const target = document.createElement('span');
            target.className = 'diagnostic-target';
            target.textContent = diagnostic.targetName;
            header.appendChild(target);
        }

        const message = document.createElement('div');
        message.className = 'diagnostic-message';
        message.textContent = diagnostic.message || '';

        item.appendChild(header);
        item.appendChild(message);

        if (diagnostic.path || diagnostic.filePath) {
            const meta = document.createElement('div');
            meta.className = 'diagnostic-meta';
            const lineNumber = diagnostic.metadata?.lineNumber;
            const pathText = diagnostic.path || diagnostic.filePath;
            meta.textContent = lineNumber ? `${pathText} (line ${lineNumber})` : pathText;
            item.appendChild(meta);
        }

        if (diagnostic.details) {
            const details = document.createElement('div');
            details.className = 'diagnostic-meta';
            details.textContent = diagnostic.details;
            item.appendChild(details);
        }

        if (diagnostic.candidates?.length) {
            const candidates = document.createElement('div');
            candidates.className = 'diagnostic-meta';
            candidates.textContent = `candidates: ${diagnostic.candidates.join(', ')}`;
            item.appendChild(candidates);
        }

        item.addEventListener('click', () => {
            this.handleDiagnosticClick(diagnostic);
        });

        return item;
    }

    handleDiagnosticClick(diagnostic, options = {}) {
        const { scroll = true, preserveSelection = false } = options;

        if (!preserveSelection) {
            this.selectedDiagnosticAnchor = createDiagnosticAnchor(diagnostic);
        }

        this.showFloatingPanel('floating-diagnostics-panel', 'toggle-diagnostics-panel');

        if (diagnostic.targetType && diagnostic.targetName) {
            this.focusTarget(diagnostic.targetType, diagnostic.targetName, scroll);
        }

        this.syncSelectedDiagnostic(scroll);

        if (!this.currentModel) {
            this.onSelectionChanged?.();
            return;
        }

        if (diagnostic.targetType === 'link') {
            const link = this.currentModel.links?.get(diagnostic.targetName);
            if (link && this.sceneManager) {
                this.sceneManager.highlightManager.clearHighlight();
                this.sceneManager.highlightManager.highlightLink(link, this.currentModel);
            }

             window.app?.modelGraphView?.selectTarget('link', diagnostic.targetName, {
                syncScene: false,
                syncDiagnostics: false,
                syncEditor: false,
                clearMeasurement: true
            });
            this.showFloatingPanel('floating-model-tree', 'toggle-model-tree');

            if (link && this.codeEditorManager) {
                this.codeEditorManager.scrollToDiagnostic(diagnostic) || this.codeEditorManager.scrollToLink(diagnostic.targetName);
            }
        }

        if (diagnostic.targetType === 'joint') {
            const joint = this.currentModel.joints?.get(diagnostic.targetName);
            if (joint && this.sceneManager) {
                this.sceneManager.axesManager.showOnlyJointAxis(joint);
                this.sceneManager.redraw();
            }

            window.app?.modelGraphView?.selectTarget('joint', diagnostic.targetName, {
                syncScene: false,
                syncDiagnostics: false,
                syncEditor: false,
                clearMeasurement: true
            });
            this.showFloatingPanel('floating-model-tree', 'toggle-model-tree');

            if (joint && this.codeEditorManager) {
                this.codeEditorManager.scrollToDiagnostic(diagnostic) || this.codeEditorManager.scrollToJoint(diagnostic.targetName);
            }
        }

        if (!diagnostic.targetType && this.codeEditorManager) {
            this.codeEditorManager.scrollToDiagnostic(diagnostic);
        }

        this.onSelectionChanged?.();
    }
}
