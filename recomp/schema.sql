-- Every row carries a real timestamp. There is no "new day" command.
-- `day` is the Asia/Singapore calendar date the row belongs to.

CREATE TABLE IF NOT EXISTS meals (
  id          INTEGER PRIMARY KEY,
  day         TEXT NOT NULL,
  at          TEXT NOT NULL,                  -- ISO-8601 local time
  label       TEXT NOT NULL,
  kcal        REAL NOT NULL,                  -- point estimate (gross, never net)
  kcal_lo     REAL NOT NULL,
  kcal_hi     REAL NOT NULL,
  protein_g   REAL NOT NULL,
  source      TEXT NOT NULL,                  -- quick | shake | manual | backfill
  share_frac  REAL NOT NULL DEFAULT 1.0,      -- fraction of the dish that was yours
  venue       TEXT,
  detail      TEXT,                           -- json: shake params, quick id, raw text
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meals_day ON meals(day);

CREATE TABLE IF NOT EXISTS workouts (
  id          INTEGER PRIMARY KEY,
  day         TEXT NOT NULL,
  at          TEXT NOT NULL,
  kind        TEXT NOT NULL,                  -- revl_move | revl_sweat | run_vest | run | lift | other
  detail      TEXT,                           -- "white scale", "3km 10kg vest", "3RM back squat 100kg"
  source      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workouts_day ON workouts(day);

-- Body measurements. Renpho rows are deduped on ext_id.
CREATE TABLE IF NOT EXISTS body (
  id          INTEGER PRIMARY KEY,
  day         TEXT NOT NULL,
  at          TEXT NOT NULL,
  weight_kg   REAL NOT NULL,
  bodyfat_pct REAL,
  muscle_kg   REAL,
  water_pct   REAL,
  source      TEXT NOT NULL,                  -- renpho | manual | backfill
  ext_id      TEXT UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_body_day ON body(day);

-- Weekly output of the adaptive expenditure engine. Never hand-edited.
CREATE TABLE IF NOT EXISTS expenditure (
  as_of        TEXT PRIMARY KEY,              -- day the estimate was computed for
  window_days  INTEGER NOT NULL,
  days_with_intake INTEGER NOT NULL,
  intake_avg   REAL,
  trend_start  REAL,
  trend_end    REAL,
  tdee         REAL,
  tdee_lo      REAL,
  tdee_hi      REAL,
  target       REAL,                          -- tdee minus configured deficit
  confidence   TEXT NOT NULL,                 -- none | low | medium | good
  note         TEXT,
  computed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings(key,value) VALUES
  ('protein_floor_g',     '150'),
  ('protein_ceiling_g',   '160'),
  ('weight_lo_kg',        '70'),
  ('weight_hi_kg',        '75'),
  ('provisional_kcal',    '2350'),   -- used until the engine has enough data
  ('recomp_deficit_kcal', '250'),
  ('creatine_start',      '2026-08-22'),
  ('creatine_settle_days','28'),
  ('whey_protein_frac',   '0.78'),   -- g protein per g powder; set from your tub's label
  ('whey_kcal_per_g',     '3.9'),
  ('tz',                  'Asia/Singapore');

-- Milks, wheys and other ingredients you actually buy. Values per 100 ml or per gram.
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,                  -- milk | whey
  label       TEXT NOT NULL,
  per         TEXT NOT NULL,                  -- '100ml' | 'g'
  kcal        REAL NOT NULL,
  protein_g   REAL NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO products(kind,label,per,kcal,protein_g,is_default)
  SELECT 'milk','Meiji full cream','100ml',64,3.2,1 WHERE NOT EXISTS (SELECT 1 FROM products WHERE kind='milk');
INSERT INTO products(kind,label,per,kcal,protein_g)
  SELECT 'milk','Meiji low fat','100ml',47,3.4 WHERE NOT EXISTS (SELECT 1 FROM products WHERE label='Meiji low fat');
INSERT INTO products(kind,label,per,kcal,protein_g)
  SELECT 'milk','Marigold HL','100ml',51,3.6 WHERE NOT EXISTS (SELECT 1 FROM products WHERE label='Marigold HL');
INSERT INTO products(kind,label,per,kcal,protein_g)
  SELECT 'milk','Water','100ml',0,0 WHERE NOT EXISTS (SELECT 1 FROM products WHERE label='Water');
INSERT INTO products(kind,label,per,kcal,protein_g,is_default)
  SELECT 'whey','Whey (set from your tub)','g',3.9,0.78,1 WHERE NOT EXISTS (SELECT 1 FROM products WHERE kind='whey');

-- Photo / text estimates from the model, kept in full so they can be
-- re-checked and, later, calibrated against the weight trend.
CREATE TABLE IF NOT EXISTS estimates (
  id          INTEGER PRIMARY KEY,
  day         TEXT NOT NULL,
  at          TEXT NOT NULL,
  text        TEXT,
  photos      TEXT,                           -- json list of relative paths under data/photos
  share_frac  REAL NOT NULL DEFAULT 1.0,
  parent_id   INTEGER,                        -- the estimate this one refines
  model       TEXT NOT NULL,
  result      TEXT NOT NULL,                  -- json, the structured output
  usage       TEXT,                           -- json, tokens
  meal_id     INTEGER,                        -- set when added to the log
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings(key,value) VALUES
  ('estimate_model', 'claude-opus-5'),
  ('estimate_effort', 'high'),
  ('estimate_web_search', '1');
