"""Canonical database schema."""
SQLITE_SCHEMA = """
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      password TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS logins (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS links (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (
      bucket TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS attempts_lookup ON attempts(bucket, at);
    CREATE TABLE IF NOT EXISTS account_suspensions (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
      actor_id TEXT NOT NULL, target_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS support_reports (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,
      status TEXT NOT NULL,reply TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,version INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS support_owner ON support_reports(user_id,updated);
    CREATE INDEX IF NOT EXISTS support_status ON support_reports(status,updated);
    CREATE TABLE IF NOT EXISTS support_receipts (
      report_id TEXT PRIMARY KEY REFERENCES support_reports(id) ON DELETE CASCADE,
      reply_version INTEGER NOT NULL DEFAULT 0,
      read_version INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO support_receipts(report_id,reply_version,read_version)
      SELECT id,CASE WHEN reply!='' THEN version ELSE 0 END,0 FROM support_reports;
    CREATE TABLE IF NOT EXISTS support_messages (
      id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES support_reports(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL,
      created INTEGER NOT NULL, version INTEGER NOT NULL,
      UNIQUE(report_id,version));
    CREATE INDEX IF NOT EXISTS support_message_order ON support_messages(report_id,version);
    CREATE TABLE IF NOT EXISTS support_threads (
      report_id TEXT PRIMARY KEY REFERENCES support_reports(id) ON DELETE CASCADE,
      user_version INTEGER NOT NULL, last_role TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS support_admin_reads (
      report_id TEXT NOT NULL REFERENCES support_reports(id) ON DELETE CASCADE,
      admin_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_version INTEGER NOT NULL, PRIMARY KEY(report_id,admin_id));
    INSERT OR IGNORE INTO support_messages(id,report_id,author_id,role,body,created,version)
      SELECT 'legacy-'||id,id,'legacy','admin',reply,updated,version FROM support_reports
      WHERE reply!='' AND NOT EXISTS(SELECT 1 FROM support_threads WHERE report_id=support_reports.id);
    INSERT OR IGNORE INTO support_threads(report_id,user_version,last_role)
      SELECT id,1,CASE WHEN reply!='' THEN 'admin' ELSE 'user' END FROM support_reports;
    CREATE TABLE IF NOT EXISTS interviews (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL, payload TEXT NOT NULL, bytes INTEGER NOT NULL,
      PRIMARY KEY(user_id, id));
    CREATE TABLE IF NOT EXISTS interview_drafts (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL, bytes INTEGER NOT NULL, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS recording_objects (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL,
      object_key TEXT UNIQUE NOT NULL, storage_origin TEXT NOT NULL, bucket TEXT NOT NULL,
      name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
      status TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS recording_owner ON recording_objects(user_id,session_id);
"""
