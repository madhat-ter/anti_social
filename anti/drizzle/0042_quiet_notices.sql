-- RFC §10.33: someone who used to come often and has been away a week. The people they talk with
-- most (or the admins, if they talk with nobody) get one note: "@maya hasn't been around for a
-- week. A hello might be nice." One row per quiet spell, keyed by when they were last here, so a
-- spell is noticed once; coming back and going quiet again starts a new one. Gone with the member.
-- told_to: who got a note (nobody hears about the same person twice in 30 days, even when the
-- note itself was taken away because they came back).
CREATE TABLE "quiet_notices" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "last_here" timestamp with time zone NOT NULL,
  "told_to" uuid[] DEFAULT '{}' NOT NULL,
  "noticed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "quiet_notices_pk" PRIMARY KEY ("user_id", "last_here")
);
