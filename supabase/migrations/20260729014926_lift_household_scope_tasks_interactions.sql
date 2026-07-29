-- Story 3.14: bound the ACCESS EXCLUSIVE wait these two DROP TRIGGERs take —
-- abort and roll back rather than queue behind a long-running transaction on
-- either table. Session-level (not LOCAL), so it is valid whether or not the
-- CLI wraps this file in an explicit transaction, and reset at the end so it
-- cannot leak into a later migration on the same connection.
set lock_timeout = '3s';

drop trigger if exists "validate_interactions_household_scope" on "public"."interactions";

drop trigger if exists "validate_tasks_household_scope" on "public"."tasks";

set lock_timeout = default;
