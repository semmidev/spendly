-- +goose Up
ALTER TABLE sender_registry ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Lainnya';

INSERT INTO sender_registry (domain, label, category, is_seed, enabled) VALUES

-- Banks
('bca.co.id',          'BCA',               'Banks', true, true),
('klikbca.com',        'BCA',               'Banks', true, true),
('bankmandiri.co.id',  'Mandiri',           'Banks', true, true),
('bni.co.id',          'BNI',               'Banks', true, true),
('bri.co.id',          'BRI',               'Banks', true, true),
('cimbniaga.co.id',    'CIMB Niaga',        'Banks', true, true),
('permatabank.com',    'PermataBank',        'Banks', true, true),
('btn.co.id',          'BTN',               'Banks', true, true),
('danamon.co.id',      'Danamon',           'Banks', true, true),
('ocbc.id',             'OCBC',              'Banks', true, true),
('bankmega.com',       'Bank Mega',         'Banks', true, true),
('maybank.co.id',      'Maybank',           'Banks', true, true),
('uob.co.id',          'UOB',               'Banks', true, true),
('hsbc.co.id',         'HSBC',              'Banks', true, true),

-- Digital Banks
('blubybcadigital.id', 'blu',               'Digital Banks', true, true),
('jago.com',           'Jago',              'Digital Banks', true, true),
('jenius.com',         'Jenius',            'Digital Banks', true, true),
('blu.id',             'blu',               'Digital Banks', true, true),
('seabank.co.id',      'SeaBank',           'Digital Banks', true, true),
('bankneo.co.id',      'Bank Neo Commerce', 'Digital Banks', true, true),
('bankraya.co.id',     'Bank Raya',          'Digital Banks', true, true),
('superbank.id',       'Superbank',          'Digital Banks', true, true),

-- E-Wallet
('gopay.co.id',        'GoPay',             'E-Wallet', true, true),
('gojek.com',          'GoJek',             'E-Wallet', true, true),
('go-jek.com',         'GoJek',             'E-Wallet', true, true),
('ovo.id',             'OVO',               'E-Wallet', true, true),
('dana.id',             'DANA',              'E-Wallet', true, true),
('linkaja.id',         'LinkAja',           'E-Wallet', true, true),
('shopeepay.co.id',    'ShopeePay',         'E-Wallet', true, true),

-- Payment / Fintech
('flip.id',             'Flip',              'Payment / Fintech', true, true),
('xendit.co',          'Xendit',            'Payment / Fintech', true, true),
('midtrans.com',       'Midtrans',          'Payment / Fintech', true, true),
('doku.com',            'DOKU',              'Payment / Fintech', true, true),

-- Marketplace
('shopee.co.id',       'Shopee',            'Marketplace', true, true),
('tokopedia.com',      'Tokopedia',         'Marketplace', true, true),
('lazada.co.id',       'Lazada',            'Marketplace', true, true),
('blibli.com',         'Blibli',            'Marketplace', true, true),
('bukalapak.com',      'Bukalapak',         'Marketplace', true, true),

-- Travel
('traveloka.com',      'Traveloka',         'Travel', true, true),
('tiket.com',           'Tiket.com',          'Travel', true, true),
('grab.com',            'Grab',              'Travel', true, true)

ON CONFLICT (domain) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  is_seed = EXCLUDED.is_seed,
  enabled = EXCLUDED.enabled;

-- +goose Down
DELETE FROM sender_registry WHERE domain IN (
    'bca.co.id', 'klikbca.com', 'bankmandiri.co.id', 'bni.co.id', 'bri.co.id',
    'cimbniaga.co.id', 'permatabank.com', 'btn.co.id', 'danamon.co.id', 'ocbc.id',
    'bankmega.com', 'maybank.co.id', 'uob.co.id', 'hsbc.co.id', 'blubybcadigital.id',
    'jago.com', 'jenius.com', 'blu.id', 'seabank.co.id', 'bankneo.co.id',
    'bankraya.co.id', 'superbank.id', 'gopay.co.id', 'gojek.com', 'go-jek.com',
    'ovo.id', 'dana.id', 'linkaja.id', 'shopeepay.co.id', 'flip.id',
    'xendit.co', 'midtrans.com', 'doku.com', 'shopee.co.id', 'tokopedia.com',
    'lazada.co.id', 'blibli.com', 'bukalapak.com', 'traveloka.com', 'tiket.com',
    'grab.com'
);
ALTER TABLE sender_registry DROP COLUMN IF EXISTS category;
