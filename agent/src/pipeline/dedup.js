"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeHash = computeHash;
exports.computeHashFromBuffer = computeHashFromBuffer;
exports.isDuplicate = isDuplicate;
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const db_js_1 = require("../db.js");
async function computeHash(filePath) {
    const buf = await (0, promises_1.readFile)(filePath);
    return (0, crypto_1.createHash)('sha256').update(buf).digest('hex');
}
async function computeHashFromBuffer(buf) {
    return (0, crypto_1.createHash)('sha256').update(buf).digest('hex');
}
async function isDuplicate(contentHash) {
    const rows = await (0, db_js_1.sql) `
    SELECT id FROM "Item" WHERE content_hash = ${contentHash} LIMIT 1
  `;
    return rows.length > 0;
}
