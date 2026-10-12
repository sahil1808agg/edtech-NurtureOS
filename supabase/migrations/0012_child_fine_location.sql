-- Replaces the typed city/pincode guess with a precise point picked from a
-- Google Places autocomplete, so find_nearby_resources can bias by location
-- instead of appending a text string to the search query. city/pincode stay
-- for rows written before this (dispatch.ts falls back to them).

alter table children
  add column address  text,
  add column lat       double precision,
  add column lng       double precision,
  add column place_id  text;
