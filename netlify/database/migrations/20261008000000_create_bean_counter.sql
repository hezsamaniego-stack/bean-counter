CREATE TABLE supplier (
  supplier_id  SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  contact_name TEXT,
  email        TEXT,
  phone        TEXT
);

CREATE TABLE bean (
  bean_id          SERIAL PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  origin_country   TEXT,
  roast_level      TEXT CHECK (roast_level IN ('Light','Medium','Dark')),
  stock_kg         NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (stock_kg >= 0),
  reorder_level_kg NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (reorder_level_kg >= 0)
);

CREATE TABLE customer (
  customer_id SERIAL PRIMARY KEY,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT UNIQUE,
  phone       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bean_order (
  bean_order_id SERIAL PRIMARY KEY,
  supplier_id   INTEGER NOT NULL REFERENCES supplier(supplier_id) ON DELETE RESTRICT,
  order_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  status        TEXT NOT NULL DEFAULT 'Ordered' CHECK (status IN ('Ordered','Received','Cancelled')),
  notes         TEXT
);

CREATE TABLE bean_order_item (
  bean_order_item_id SERIAL PRIMARY KEY,
  bean_order_id      INTEGER NOT NULL REFERENCES bean_order(bean_order_id) ON DELETE CASCADE,
  bean_id            INTEGER NOT NULL REFERENCES bean(bean_id) ON DELETE RESTRICT,
  quantity_kg        NUMERIC(8,2) NOT NULL CHECK (quantity_kg > 0),
  price_per_kg       NUMERIC(8,2) NOT NULL CHECK (price_per_kg >= 0),
  UNIQUE (bean_order_id, bean_id)
);

-- Sample (fake) data so the demo is not empty
INSERT INTO supplier (name, contact_name, email, phone) VALUES
  ('Northern Roast Imports', 'Sam Rivera', 'sam@example.com', '403-555-0101'),
  ('Andes Green Coffee Co.', 'Priya Nair', 'priya@example.com', '403-555-0102');
INSERT INTO bean (name, origin_country, roast_level, stock_kg, reorder_level_kg) VALUES
  ('Colombian Supremo', 'Colombia', 'Medium', 18.5, 10),
  ('Ethiopian Yirgacheffe', 'Ethiopia', 'Light', 6, 8),
  ('Sumatra Mandheling', 'Indonesia', 'Dark', 12, 5);
INSERT INTO customer (first_name, last_name, email, phone) VALUES
  ('Alex', 'Morgan', 'alex.morgan@example.com', '403-555-0111'),
  ('Jordan', 'Lee', 'jordan.lee@example.com', '403-555-0112');
INSERT INTO bean_order (supplier_id, order_date, expected_date, status, notes) VALUES
  (1, CURRENT_DATE, CURRENT_DATE + 7, 'Ordered', 'Weekly restock');
INSERT INTO bean_order_item (bean_order_id, bean_id, quantity_kg, price_per_kg) VALUES
  (1, 2, 10, 14.50),
  (1, 1, 15, 11.25);
