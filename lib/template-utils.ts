/**
 * Template file name mapping utility
 * Maps old template filenames (with spaces) to new filenames (without spaces)
 */

const TEMPLATE_NAME_MAP: Record<string, string> = {
    'XHR TEMPLATE.pdf': 'XHRTEMP.pdf',
    'CERT TEMPLATE.pdf': 'CertTEMP.pdf',
    'XHR TEMPLATE': 'XHRTEMP.pdf',
    'CERT TEMPLATE': 'CertTEMP.pdf',
};

/**
 * Normalizes template filename from old format to new format
 * @param filename - The template filename (may have spaces)
 * @returns The normalized filename without spaces
 */
export function normalizeTemplateFilename(filename: string): string {
    // Check if it's in our mapping
    if (TEMPLATE_NAME_MAP[filename]) {
        return TEMPLATE_NAME_MAP[filename];
    }
    
    // If it already doesn't have spaces or is already normalized, return as-is
    if (!filename.includes(' ') && filename.endsWith('.pdf')) {
        return filename;
    }
    
    // Otherwise, remove spaces and ensure .pdf extension
    let normalized = filename.replace(/\s+/g, '');
    if (!normalized.endsWith('.pdf')) {
        normalized += '.pdf';
    }
    
    return normalized;
}

/**
 * Gets the full path to a template file
 * @param templateName - The template name (with or without spaces)
 * @returns The path to the template file
 */
export function getTemplatePath(templateName: string): string {
    const normalized = normalizeTemplateFilename(templateName);
    return `/templates/${normalized}`;
}
