-- RFC §10.24: a member may share their File outside anti by a link; off until they switch it on.
ALTER TABLE "users" ADD COLUMN "file_public" boolean DEFAULT false NOT NULL;
