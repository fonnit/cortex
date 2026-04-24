"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractContent = extractContent;
const promises_1 = require("fs/promises");
const path_1 = __importDefault(require("path"));
// Size limits per ING-04
const LIMITS = {
    pdf: 5 * 1024 * 1024, // 5 MB
    image: 10 * 1024 * 1024, // 10 MB
    default: 1 * 1024 * 1024, // 1 MB
};
const INSTALLER_EXTS = new Set(['.dmg', '.pkg', '.exe', '.msi', '.deb', '.rpm', '.appimage']);
const INSTALLER_MIMES = new Set([
    'application/x-apple-diskimage',
    'application/vnd.apple.installer+xml',
    'application/x-msi',
    'application/x-msdownload',
]);
function guessMimeType(filePath) {
    const ext = path_1.default.extname(filePath).toLowerCase();
    const mimeMap = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.heic': 'image/heic',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.csv': 'text/csv',
        '.json': 'application/json',
        '.dmg': 'application/x-apple-diskimage',
        '.pkg': 'application/vnd.apple.installer+xml',
        '.exe': 'application/x-msdownload',
        '.zip': 'application/zip',
    };
    return mimeMap[ext] ?? 'application/octet-stream';
}
async function extractContent(filePath) {
    const s = await (0, promises_1.stat)(filePath);
    const sizeBytes = s.size;
    const mimeType = guessMimeType(filePath);
    const ext = path_1.default.extname(filePath).toLowerCase();
    // Installer check: always metadata-only
    if (INSTALLER_EXTS.has(ext) || INSTALLER_MIMES.has(mimeType)) {
        return { content: null, mimeType, sizeBytes, metadataOnly: true, reason: 'installer' };
    }
    // PDF: content-read only if <= 5 MB
    if (mimeType === 'application/pdf') {
        if (sizeBytes > LIMITS.pdf) {
            return { content: null, mimeType, sizeBytes, metadataOnly: true, reason: 'pdf_too_large' };
        }
        try {
            // Using dynamic import so absence of pdf-parse doesn't crash the module
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore — pdf-parse is optional; fallback to null if not installed
            const pdfParse = await Promise.resolve().then(() => __importStar(require('pdf-parse'))).then((m) => m.default).catch(() => null);
            if (pdfParse) {
                const buf = await (0, promises_1.readFile)(filePath);
                const parsed = await pdfParse(buf);
                return { content: parsed.text ?? null, mimeType, sizeBytes, metadataOnly: false };
            }
        }
        catch {
            // Fall through to metadata-only if pdf-parse fails
        }
        return { content: null, mimeType, sizeBytes, metadataOnly: true, reason: 'pdf_parse_unavailable' };
    }
    // Images: content-read only if <= 10 MB (content = base64 for multimodal Claude)
    if (mimeType.startsWith('image/')) {
        if (sizeBytes > LIMITS.image) {
            return { content: null, mimeType, sizeBytes, metadataOnly: true, reason: 'image_too_large' };
        }
        const buf = await (0, promises_1.readFile)(filePath);
        return { content: buf.toString('base64'), mimeType, sizeBytes, metadataOnly: false };
    }
    // Default: text content-read if <= 1 MB
    if (sizeBytes > LIMITS.default) {
        return { content: null, mimeType, sizeBytes, metadataOnly: true, reason: 'default_too_large' };
    }
    try {
        const text = await (0, promises_1.readFile)(filePath, 'utf-8');
        return { content: text, mimeType, sizeBytes, metadataOnly: false };
    }
    catch {
        return { content: null, mimeType, sizeBytes, metadataOnly: true, reason: 'read_error' };
    }
}
