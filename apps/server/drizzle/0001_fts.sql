CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  item_id UNINDEXED, title, note, transcript, ocr, answer, tags, entities,
  tokenize = 'porter unicode61'
);
