-- At most one ACTIVE command-signing key per branch, even if two requests
-- create the branch's first key at the same moment.
ALTER TABLE "BranchSigningKey"
  ADD CONSTRAINT signing_key_one_active_per_branch EXCLUDE USING gist ("branchId" WITH =) WHERE ("status" = 'ACTIVE');
