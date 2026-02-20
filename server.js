
require('dotenv').config(); // Load environment variables

const { spawn } = require('child_process');
const path = require('path');

// Start the API Gateway (Main Entry Point)
console.log("🚀 Starting API Gateway...");

const gatewayProcess = spawn('node', [path.join(__dirname, 'gateway', 'app.js')], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
});

gatewayProcess.on('exit', (code) => {
    console.error(`❌ API Gateway exited with code ${code}. Restarting...`);
    setTimeout(() => spawn('node', [path.join(__dirname, 'gateway', 'app.js')], { cwd: __dirname, stdio: 'inherit', shell: true }), 3000);
});
