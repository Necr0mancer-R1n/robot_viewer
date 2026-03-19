function countLineNumber(content, index) {
    if (!content || index < 0) {
        return null;
    }

    return content.slice(0, index).split('\n').length;
}

function uniqueValues(values = []) {
    return Array.from(new Set(values.filter(Boolean)));
}

function extractArgNames(text) {
    if (!text || typeof text !== 'string') {
        return [];
    }

    const args = [];
    const regex = /\$\(\s*arg\s+([^)]+)\)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        args.push(match[1].trim());
    }
    return uniqueValues(args);
}

function readAttr(element, attrName) {
    if (!element || !element.getAttribute) {
        return '';
    }

    return element.getAttribute(attrName) || '';
}

function traverseElements(element, callback, context = {}) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return;
    }

    const nextContext = callback(element, context) || context;
    const children = Array.from(element.children || []);
    children.forEach(child => traverseElements(child, callback, nextContext));
}

export function annotateXacroContent(content, filePath) {
    if (!content || typeof content !== 'string') {
        return content;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError || !doc.documentElement) {
        return content;
    }

    const lowerContent = content.toLowerCase();
    let searchFrom = 0;

    traverseElements(doc.documentElement, (element, context) => {
        const tagToken = `<${element.tagName.toLowerCase()}`;
        const index = lowerContent.indexOf(tagToken, searchFrom);
        if (index !== -1) {
            searchFrom = index + tagToken.length;
            element.setAttribute('data-xacro-source-line', String(countLineNumber(content, index) || ''));
        }

        element.setAttribute('data-xacro-source-file', filePath);

        const macroName = context.macroName || '';
        if (macroName) {
            element.setAttribute('data-xacro-source-macro', macroName);
        }

        const nameAttr = element.getAttribute('name');
        if (nameAttr) {
            element.setAttribute('data-xacro-source-search', `<${element.tagName} name="${nameAttr}"`);
        }

        const argNames = uniqueValues(
            Array.from(element.attributes || [])
                .flatMap(attr => extractArgNames(attr.value))
        );

        if (argNames.length > 0) {
            element.setAttribute('data-xacro-source-args', argNames.join(','));
        }

        const tagName = element.tagName.toLowerCase();
        if (tagName === 'xacro:macro') {
            return {
                ...context,
                macroName: (element.getAttribute('name') || '').replace(/^xacro:/, '')
            };
        }

        return context;
    }, {});

    return new XMLSerializer().serializeToString(doc);
}

export function readXacroTraceInfo(element, fallbackSearchText = '') {
    if (!element) {
        return null;
    }

    const filePath = readAttr(element, 'data-xacro-source-file');
    const lineNumber = parseInt(readAttr(element, 'data-xacro-source-line')) || null;
    const macro = readAttr(element, 'data-xacro-source-macro');
    const args = readAttr(element, 'data-xacro-source-args')
        .split(',')
        .map(arg => arg.trim())
        .filter(Boolean);
    const searchText = readAttr(element, 'data-xacro-source-search') || fallbackSearchText;

    if (!filePath && !lineNumber && !macro && args.length === 0 && !searchText) {
        return null;
    }

    return {
        filePath,
        lineNumber,
        macro,
        args,
        searchText
    };
}

export function extractXacroSourceMap(xmlContent) {
    if (!xmlContent || typeof xmlContent !== 'string') {
        return { links: {}, joints: {} };
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlContent, 'text/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        return { links: {}, joints: {} };
    }

    const sourceMap = {
        links: {},
        joints: {}
    };

    doc.querySelectorAll('link[name]').forEach(linkEl => {
        const name = linkEl.getAttribute('name');
        const sourceInfo = readXacroTraceInfo(linkEl, `<link name="${name}"`);
        if (name && sourceInfo) {
            sourceMap.links[name] = sourceInfo;
        }
    });

    doc.querySelectorAll('joint[name]').forEach(jointEl => {
        const name = jointEl.getAttribute('name');
        const sourceInfo = readXacroTraceInfo(jointEl, `<joint name="${name}"`);
        if (name && sourceInfo) {
            sourceMap.joints[name] = sourceInfo;
        }
    });

    return sourceMap;
}

export function stripXacroTraceAttributes(xmlContent) {
    if (!xmlContent || typeof xmlContent !== 'string') {
        return xmlContent;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlContent, 'text/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError || !doc.documentElement) {
        return xmlContent;
    }

    traverseElements(doc.documentElement, element => {
        Array.from(element.attributes || []).forEach(attr => {
            if (attr.name.startsWith('data-xacro-source-')) {
                element.removeAttribute(attr.name);
            }
        });
    }, {});

    return new XMLSerializer().serializeToString(doc);
}

export function applyXacroSourceMapToModel(model, sourceMap) {
    if (!model || !sourceMap) {
        return;
    }

    model.userData.sourceMap = sourceMap;

    if (model.links) {
        model.links.forEach((link, linkName) => {
            const sourceInfo = sourceMap.links?.[linkName];
            if (sourceInfo) {
                if (!link.userData) {
                    link.userData = {};
                }
                link.userData.sourceInfo = sourceInfo;
            }
        });
    }

    if (model.joints) {
        model.joints.forEach((joint, jointName) => {
            const sourceInfo = sourceMap.joints?.[jointName];
            if (sourceInfo) {
                if (!joint.userData) {
                    joint.userData = {};
                }
                joint.userData.sourceInfo = sourceInfo;
            }
        });
    }
}

export function findXacroIncludeSourceInfo(path, sourceFiles = new Map()) {
    if (!path) {
        return null;
    }

    for (const [filePath, content] of sourceFiles.entries()) {
        if (!content || typeof content !== 'string') {
            continue;
        }

        const patterns = [
            `filename="${path}"`,
            `filename='${path}'`
        ];

        for (const pattern of patterns) {
            const index = content.indexOf(pattern);
            if (index !== -1) {
                return {
                    filePath,
                    lineNumber: countLineNumber(content, index),
                    searchText: pattern
                };
            }
        }
    }

    return null;
}
