-- Security advisor 0011: pin search_path on the two trigger functions that
-- were created without one. Neither references a table, so '' is safe.
alter function app.touch_updated_at() set search_path = '';
alter function app.price_books_immutable() set search_path = '';
