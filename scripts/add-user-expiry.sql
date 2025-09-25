-- 用户到期时间功能迁移脚本
-- 为用户表添加到期时间字段
-- 执行方式：wrangler d1 execute <DATABASE_NAME> --file=./scripts/add-user-expiry.sql

-- 添加到期时间字段到用户表
-- 使用 ALTER TABLE 添加新列，默认值为 NULL（表示永不过期）
ALTER TABLE users ADD COLUMN expires_at DATETIME DEFAULT NULL;

-- 为新字段添加索引，便于查询过期用户
CREATE INDEX IF NOT EXISTS idx_users_expires_at ON users(expires_at);

-- 更新数据库版本信息
UPDATE db_version SET 
  version = '1.2.0', 
  description = '添加用户到期时间功能',
  applied_at = CURRENT_TIMESTAMP 
WHERE id = 1;

-- 插入版本记录（如果需要保留历史记录）
INSERT OR IGNORE INTO db_version (version, description) 
VALUES ('1.2.0', '添加用户到期时间功能');