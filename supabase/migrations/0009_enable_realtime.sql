-- 0008_chat.sql created messages/conversations with RLS, but never added
-- them to the supabase_realtime publication — so Supabase Realtime has
-- nothing to broadcast from them, and ChatThread.tsx's postgres_changes
-- subscription (correct on the client side) never receives an event. The
-- DB writes themselves were always correct; this is purely what makes them
-- visible live.

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table conversations;
