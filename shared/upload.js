/**
 * Cloudinary-based file upload middleware factory.
 * Usage: const upload = require('../shared/upload')(__dirname + '/uploads');
 *
 * The folder path argument is parsed to extract the service name
 * (e.g., 'cars', 'users', 'reclamations') and used as a Cloudinary sub-folder.
 *
 * Uploaded files are stored on Cloudinary and `req.file.path` contains
 * the absolute HTTPS URL — no local disk storage needed.
 */
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];

/**
 * @param {string} folderName - Absolute path passed by the microservices (e.g., '/app/car/uploads')
 * @returns {multer.Multer} configured multer instance backed by Cloudinary
 */
module.exports = (folderName) => {
  // Extract just the folder name (e.g., 'cars', 'users', 'reclamations')
  // from the absolute path passed by the microservices
  const folder = folderName.split(/[/\\]/).filter(Boolean).slice(-2, -1)[0] || 'nexdrive_general';

  const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: `nexdrive/${folder}`,
      allowed_formats: ALLOWED_FORMATS,
      // Transformation ensures images are optimized for mobile/web
      transformation: [{ width: 1000, crop: 'limit' }, { quality: 'auto' }]
    },
  });

  return multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5 MB
  });
};
