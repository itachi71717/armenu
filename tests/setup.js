// Set fake env vars before any module under test loads. Prevents _db.js from
// throwing "Neither DATABASE_URL nor Supabase env vars set" at import time.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
process.env.ADMIN_SECRET ||= 'test-admin-secret';
process.env.STAFF_SECRET ||= 'test-staff-secret';
