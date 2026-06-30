import fs from 'fs';
import path from 'path';
import { db } from './src/config/db';

async function migrate() {
  const schemaPath = path.join(__dirname, 'src', 'config', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  
  try {
    await db.query(schema);
    console.log('Schema applied successfully');
  } catch (err) {
    console.error('Error applying schema:', err);
  } finally {
    await db.end();
  }
}

migrate();
