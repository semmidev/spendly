-- Kategori sempat terduplikasi (insert tiap login). Bereskan + cegah.
-- +goose Up
-- 1. Tentukan kategori kanonik per (user_id, name) dan tabel duplikatnya.
CREATE TEMP TABLE cat_dup ON COMMIT DROP AS
SELECT c.id AS dup_id, k.keep_id
FROM categories c
JOIN (
  SELECT DISTINCT ON (user_id, name) id AS keep_id, user_id, name
  FROM categories
  WHERE user_id IS NOT NULL
  ORDER BY user_id, name, id
) k ON k.user_id = c.user_id AND k.name = c.name
WHERE c.id <> k.keep_id;

-- 2. Pindahkan semua referensi ke kategori kanonik.
UPDATE transactions t SET category_id = d.keep_id FROM cat_dup d WHERE t.category_id = d.dup_id;
UPDATE rules r SET category_id = d.keep_id FROM cat_dup d WHERE r.category_id = d.dup_id;
UPDATE recurring_rules rr SET category_id = d.keep_id FROM cat_dup d WHERE rr.category_id = d.dup_id;
UPDATE merchants m SET default_category_id = d.keep_id FROM cat_dup d WHERE m.default_category_id = d.dup_id;

-- 3. Hapus duplikat, lalu paksa unik.
DELETE FROM categories c USING cat_dup d WHERE c.id = d.dup_id;
CREATE UNIQUE INDEX IF NOT EXISTS categories_user_name_uniq ON categories (user_id, name);
