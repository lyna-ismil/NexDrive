// Secure upload middleware — delegates to shared/upload.js
const path = require('path');
const upload = require('../../shared/upload')(path.join(__dirname, '../uploads'));

module.exports = upload;
