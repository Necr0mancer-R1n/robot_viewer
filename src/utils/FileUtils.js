/**
 * File operation utility functions
 */

/**
 * Read file content as text
 */
export function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

/**
 * Get File object from file system entry
 */
export function getFileFromEntry(entry) {
    return new Promise((resolve, reject) => {
        entry.file(resolve, reject);
    });
}

/**
 * Recursively read directory
 */
export async function readDirectory(dirEntry, fileMap) {
    const files = [];

    return new Promise((resolve, reject) => {
        const reader = dirEntry.createReader();

        function readEntries() {
            reader.readEntries(async (entries) => {
                if (entries.length === 0) {
                    resolve(files);
                    return;
                }

                for (const entry of entries) {
                    if (entry.isFile) {
                        const file = await getFileFromEntry(entry);
                        const path = entry.fullPath || entry.name;
                        fileMap.set(path, file);
                        files.push(file);
                    } else if (entry.isDirectory) {
                        const subFiles = await readDirectory(entry, fileMap);
                        files.push(...subFiles);
                    }
                }

                readEntries();
            }, reject);
        }

        readEntries();
    });
}

/**
 * Get file type from extension
 */
export function getFileTypeFromExtension(ext) {
    const typeMap = {
        'urdf': 'urdf',
        'xacro': 'xacro',
        'mjcf': 'mjcf',
        'xml': 'mjcf',
        'usd': 'usd',
        'usda': 'usd',
        'usdc': 'usd',
        'usdz': 'usd'
    };
    return typeMap[ext] || 'unknown';
}

/**
 * Get file display type
 */
export function getFileDisplayType(ext, fileName) {
    const modelExts = ['urdf', 'xacro', 'mjcf', 'xml', 'usd', 'usda', 'usdc', 'usdz'];
    const meshExts = ['dae', 'stl', 'obj', 'collada', 'gltf', 'glb'];

    if (modelExts.includes(ext)) {
        return 'model';
    } else if (meshExts.includes(ext)) {
        return 'mesh';
    }
    return 'file';
}

/**
 * Normalize path
 */
export function normalizePath(path) {
    if (!path) return '';
    return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

