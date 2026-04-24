"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sql = void 0;
const serverless_1 = require("@neondatabase/serverless");
if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
}
exports.sql = (0, serverless_1.neon)(process.env.DATABASE_URL);
