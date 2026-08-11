-- Migration number: 0005
-- The compost heap. A heap is a poem that many users write together. Each user
-- adds one scrap of text, and sees only the scrap above their own. When the
-- heap is full, or when it goes cold, the site seals it and all users read it.

CREATE TABLE compost_heaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  -- NULL while the heap still takes scraps.
  sealed_at INTEGER,
  -- 'full' or 'cold'. NULL while the heap is open.
  reason TEXT
);

CREATE TABLE compost_scraps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  heap_id INTEGER NOT NULL REFERENCES compost_heaps(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- The id gives the order of the scraps in a heap.
CREATE INDEX idx_scraps_heap ON compost_scraps(heap_id, id);
CREATE INDEX idx_heaps_open ON compost_heaps(sealed_at);
