-- Rizance Profit — Migration 0015
-- Round B: chairman fields (org + activity) + president member role.
-- Safe to re-run (IF NOT EXISTS / DROP IF EXISTS).

BEGIN;

-- Org-level president (ประธานชมรม/องค์กร)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS chairman_name VARCHAR(160);

-- Project/activity-level president (ประธานโครงการ)
ALTER TABLE project_activities
  ADD COLUMN IF NOT EXISTS chairman_name VARCHAR(160);

-- Member role: add president (ประธาน)
ALTER TABLE project_members
  DROP CONSTRAINT IF EXISTS project_members_role_check;

ALTER TABLE project_members
  ADD CONSTRAINT project_members_role_check
  CHECK (role IN ('president', 'treasurer', 'member', 'advisor'));

COMMIT;
