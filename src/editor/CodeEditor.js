/**
 * CodeMirror 6 code editor wrapper
 */
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { xml } from '@codemirror/lang-xml';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { githubLight, githubDark } from '@uiw/codemirror-theme-github';
import { dracula } from '@uiw/codemirror-theme-dracula';

export class CodeEditor {
    constructor(parentElement, theme = 'vscode-dark') {
        this.parentElement = parentElement;
        this.view = null;
        this.onChangeCallback = null;
        this.currentTheme = theme;

        this.setupEditor();
    }

    /**
     * Get theme configuration
     */
    getThemeExtension() {
        // Auto-select based on page theme
        const pageTheme = document.documentElement.getAttribute('data-theme') || 'dark';

        if (pageTheme === 'light') {
            return githubLight;
        } else {
            // Dark theme - use VS Code Dark (more professional and clear)
            return vscodeDark;
        }
    }

    setupEditor() {
        // Clear container
        this.parentElement.innerHTML = '';

        // Create CodeMirror editor
        const startState = EditorState.create({
            doc: '',
            extensions: [
                basicSetup,
                xml(),
                this.getThemeExtension(), // Use theme
                EditorView.theme({
                    "&": {
                        height: "100%",
                        fontSize: "13px",
                        backgroundColor: "transparent !important",
                    },
                    ".cm-content": {
                        backgroundColor: "transparent !important",
                    },
                    ".cm-gutters": {
                        backgroundColor: "rgba(255, 255, 255, 0.02) !important",
                        border: "none !important",
                    },
                    ".cm-activeLineGutter": {
                        backgroundColor: "rgba(255, 255, 255, 0.05) !important",
                    },
                    ".cm-activeLine": {
                        backgroundColor: "rgba(255, 255, 255, 0.03) !important",
                    },
                    ".cm-scroller": {
                        overflow: "auto",
                        fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
                        backgroundColor: "transparent !important",
                    },
                    // Custom scrollbar style - consistent with joint control panel
                    ".cm-scroller::-webkit-scrollbar": {
                        width: "10px",
                        height: "10px",
                    },
                    ".cm-scroller::-webkit-scrollbar-track": {
                        background: "transparent",
                    },
                    ".cm-scroller::-webkit-scrollbar-thumb": {
                        background: "rgba(128, 128, 128, 0.3)",
                        borderRadius: "6px",
                        border: "2px solid transparent",
                        backgroundClip: "padding-box",
                    },
                    ".cm-scroller::-webkit-scrollbar-thumb:hover": {
                        background: "rgba(128, 128, 128, 0.5)",
                        backgroundClip: "padding-box",
                    },
                    ".cm-scroller::-webkit-scrollbar-corner": {
                        background: "transparent",
                    },
                }),
                // Don't enable word wrap, allow horizontal scrolling
                EditorView.updateListener.of((update) => {
                    if (update.docChanged && this.onChangeCallback) {
                        this.onChangeCallback(this.getValue());
                    }
                }),
            ],
        });

        this.view = new EditorView({
            state: startState,
            parent: this.parentElement,
        });
    }

    /**
     * Set editor content
     * @param {string} content - Content
     */
    setValue(content) {
        if (!this.view) return;

        const transaction = this.view.state.update({
            changes: {
                from: 0,
                to: this.view.state.doc.length,
                insert: content || '',
            },
        });

        this.view.dispatch(transaction);
    }

    /**
     * Get editor content
     * @returns {string}
     */
    getValue() {
        if (!this.view) return '';
        return this.view.state.doc.toString();
    }

    /**
     * Set content change callback
     * @param {Function} callback - Callback function
     */
    onChange(callback) {
        this.onChangeCallback = callback;
    }

    /**
     * Focus editor
     */
    focus() {
        if (this.view) {
            this.view.focus();
        }
    }

    /**
     * Destroy editor
     */
    destroy() {
        if (this.view) {
            this.view.destroy();
            this.view = null;
        }
    }

    /**
     * Update theme (dark/light)
     * @param {string} theme - 'dark' or 'light'
     */
    updateTheme(theme) {
        if (!this.view) return;

        // Reconfigure editor to apply new theme
        const currentContent = this.getValue();
        const cursorPos = this.view.state.selection.main.head;

        // Destroy old editor
        this.view.destroy();

        // Create new editor (will apply new theme)
        this.setupEditor();

        // Restore content and cursor position
        this.setValue(currentContent);
        this.view.dispatch({
            selection: { anchor: cursorPos, head: cursorPos }
        });
    }

    /**
     * Scroll to specified line
     * @param {number} lineNumber - Line number (starting from 1)
     * @param {boolean} highlight - Whether to highlight the line
     */
    scrollToLine(lineNumber, highlight = true) {
        if (!this.view || lineNumber < 1) return;

        try {
            const doc = this.view.state.doc;
            const totalLines = doc.lines;

            // Ensure line number is within valid range
            const targetLine = Math.min(Math.max(1, lineNumber), totalLines);

            // Get line start position
            const line = doc.line(targetLine);
            const pos = line.from;

            // Scroll to line
            this.view.dispatch({
                selection: { anchor: pos, head: line.to },
                scrollIntoView: true
            });

            // Focus editor
            this.view.focus();
        } catch (error) {
            console.error('Failed to scroll to line:', error);
        }
    }

    /**
     * Search and scroll to first occurrence based on text content
     * @param {string} searchText - Text to search for
     * @param {boolean} caseSensitive - Whether to be case sensitive
     */
    searchAndScroll(searchText, caseSensitive = true) {
        if (!this.view || !searchText) return false;

        try {
            const content = this.getValue();
            const searchContent = caseSensitive ? content : content.toLowerCase();
            const searchQuery = caseSensitive ? searchText : searchText.toLowerCase();

            const index = searchContent.indexOf(searchQuery);

            if (index === -1) {
                return false;
            }

            // Select matching text
            this.view.dispatch({
                selection: { anchor: index, head: index + searchText.length },
                scrollIntoView: true
            });

            // Focus editor
            this.view.focus();

            return true;
        } catch (error) {
            console.error('Failed to search and scroll:', error);
            return false;
        }
    }

    scrollToLineOrSearch(lineNumber, searchText) {
        if (!this.view) return false;

        if (lineNumber && Number.isFinite(lineNumber)) {
            this.scrollToLine(lineNumber, true);
            return true;
        }

        if (searchText) {
            return this.searchAndScroll(searchText, true);
        }

        return false;
    }
}

