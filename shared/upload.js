/**
 * Secure file upload middleware factory.
 * Usage: const upload = require('../shared/upload')(__dirname + '/uploads');
 *
 * Enforces:
 * - Max file size: 5 MB
 * - Allowed MIME types: image/jpeg, image/png, image/webp, application/pdf
 * - Random filenames (crypto.randomUUID) to prevent path traversal
 */
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf'
]);

/**
 * @param {string} uploadDir - Absolute path to the uploads directory
 * @returns {multer.Multer} configured multer instance
 */
module.exports = (uploadDir) => {
  // Ensure upload directory exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    }
  });

  const fileFilter = (_req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type '${file.mimetype}' is not allowed. Accepted: JPEG, PNG, WebP, PDF`), false);
    }
  };

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_FILE_SIZE }
  });
};
