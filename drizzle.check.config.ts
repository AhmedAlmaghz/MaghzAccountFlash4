import { config } from 'dotenv';
config({ path: ['.env.local', '.env'] });
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/core/database/schema/index.ts',
  out: './.drizzle-drift-check',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'MaghzAccountF35',
    user: process.env.DB_USER || 'maghz',
    password: process.env.DB_PASSWORD || 'Zaamla2026',
    ssl: false,
  },
});
