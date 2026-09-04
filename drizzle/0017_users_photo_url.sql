-- 0017: users.photo_url — profile photo for the header avatar menu
--
-- The header shows the signed-in user's photo (initials fallback when empty).
-- Stored as a data-URL (same 2MB convention as employees/HR photos) so no
-- object storage is required. Idempotent: guarded with IF NOT EXISTS.

-- users.photo_url
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url text;
