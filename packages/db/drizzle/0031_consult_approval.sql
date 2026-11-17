-- RFC §10.18: offering consulting needs the verified badge first, then an admin's approval.
alter table users add column if not exists consult_requested_at timestamptz;
--> statement-breakpoint
alter table users add column if not exists consult_approved_at timestamptz;
--> statement-breakpoint
alter table users add column if not exists consult_approved_by uuid references users(id) on delete set null;
--> statement-breakpoint
alter table users add column if not exists consult_declined_at timestamptz;
--> statement-breakpoint
-- Everyone who was offering consulting before this rule goes to the admin's queue: their offer
-- stops taking bookings at once, and comes back as it was once an admin approves them.
update users set consult_requested_at = now()
 where consult_requested_at is null and consult_approved_at is null
   and id in (select user_id from consult_offers where active);
