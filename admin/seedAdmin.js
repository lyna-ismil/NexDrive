const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

mongoose.connect('mongodb://localhost:27017/nexdrive_admin')
  .then(async () => {
    const db = mongoose.connection.db;
    const adminCollection = db.collection('admins');
    
    // Create or update a test admin
    const passwordHash = await bcrypt.hash('Admin123!', 10);
    const admin = await adminCollection.findOneAndUpdate(
      { email: 'superadmin@nexdrive.com' },
      { 
        $set: { 
          name: 'Super Admin',
          password: passwordHash,
          role: 'SUPER_ADMIN',
          status: 'ACTIVE'
        } 
      },
      { upsert: true, returnDocument: 'after' }
    );
    
    console.log('Admin account ready');
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
