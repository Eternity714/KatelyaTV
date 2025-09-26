-- KatelyaTV D1数据库脚本
-- 整合版本：将初始化、升级和迁移脚本整合到一个文件中
-- 最后更新：重构整合版本，兼容Cloudflare D1
--
-- Cloudflare D1 兼容性说明：
-- 1. D1 不支持直接使用 SQL 的 BEGIN TRANSACTION 语句，应使用 JavaScript API
--    正确用法: state.storage.transaction() 或 state.storage.transactionSync()
-- 2. 本脚本已移除所有事务控制语句，在 JavaScript 中使用时应包装在事务API中
-- 3. 使用方法：可通过 wrangler d1 execute <DATABASE_NAME> --file=./D1用到的相关所有.sql 执行
--    或在 Workers/Pages 中通过 D1 绑定执行单条语句

-- =============================================
-- 第一部分：数据库版本控制
-- =============================================

-- 创建版本控制表
CREATE TABLE IF NOT EXISTS db_version (
  id INTEGER PRIMARY KEY DEFAULT 1,
  version TEXT NOT NULL,
  description TEXT NOT NULL,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 初始化版本信息（如果不存在）
INSERT OR IGNORE INTO db_version (id, version, description) 
VALUES (1, '1.2.0', '初始数据库结构，包含用户到期时间功能');

-- =============================================
-- 第二部分：核心表结构定义
-- =============================================

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  expires_at DATETIME DEFAULT NULL, -- 用户到期时间，NULL表示永不过期
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 用户设置表
CREATE TABLE IF NOT EXISTS user_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  settings TEXT NOT NULL, -- JSON格式存储所有设置
  updated_time INTEGER NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

-- 播放记录表
CREATE TABLE IF NOT EXISTS play_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  record_key TEXT NOT NULL, -- 唯一标识视频的键
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  cover TEXT NOT NULL,
  year TEXT NOT NULL,
  episode_index INTEGER NOT NULL DEFAULT 0,
  total_episodes INTEGER NOT NULL DEFAULT 0,
  current_time INTEGER NOT NULL DEFAULT 0, -- 当前播放时间（秒）
  duration INTEGER NOT NULL DEFAULT 0, -- 总时长（秒）
  updated_time INTEGER NOT NULL, -- 更新时间戳
  search_title TEXT, -- 搜索标题（可选）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, record_key)
);

-- 收藏表
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  favorite_key TEXT NOT NULL, -- 唯一标识视频的键
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  cover TEXT NOT NULL,
  year TEXT NOT NULL,
  rating REAL, -- 评分
  area TEXT, -- 地区
  category TEXT, -- 分类
  actors TEXT, -- 演员
  director TEXT, -- 导演
  description TEXT, -- 描述
  total_episodes INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, favorite_key)
);

-- 搜索历史表
CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  keyword TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, keyword)
);

-- 跳过配置表（片头片尾等）
CREATE TABLE IF NOT EXISTS skip_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  config_key TEXT NOT NULL, -- 视频唯一标识
  source TEXT NOT NULL, -- 视频源
  video_id TEXT NOT NULL, -- 视频ID
  title TEXT NOT NULL, -- 视频标题
  segments TEXT NOT NULL, -- JSON格式存储跳过片段信息
  updated_time INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, config_key)
);

-- 管理员配置表
CREATE TABLE IF NOT EXISTS admin_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key TEXT UNIQUE NOT NULL,
  config_value TEXT,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 视频源配置表（独立存储）
CREATE TABLE IF NOT EXISTS source_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT UNIQUE NOT NULL, -- 源的唯一标识符
  name TEXT NOT NULL, -- 源的显示名称
  api TEXT NOT NULL, -- 视频 API 的搜索接口地址
  detail TEXT, -- 视频详情接口地址（可选）
  from_type TEXT NOT NULL DEFAULT 'custom', -- 来源类型：'config' | 'custom'
  disabled BOOLEAN DEFAULT 0, -- 是否禁用
  is_adult BOOLEAN DEFAULT 0, -- 是否为成人内容源
  sort_order INTEGER DEFAULT 0, -- 排序顺序
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- 第三部分：索引创建
-- =============================================

-- 用户表索引
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_expires_at ON users(expires_at);

-- 用户设置索引
CREATE INDEX IF NOT EXISTS idx_user_settings_username ON user_settings(username);
CREATE INDEX IF NOT EXISTS idx_user_settings_updated_time ON user_settings(updated_time DESC);

-- 播放记录索引
CREATE INDEX IF NOT EXISTS idx_play_records_user_id ON play_records(user_id);
CREATE INDEX IF NOT EXISTS idx_play_records_record_key ON play_records(record_key);
CREATE INDEX IF NOT EXISTS idx_play_records_updated_time ON play_records(updated_time DESC);

-- 收藏索引
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_favorite_key ON favorites(favorite_key);
CREATE INDEX IF NOT EXISTS idx_favorites_updated_at ON favorites(updated_at DESC);

-- 搜索历史索引
CREATE INDEX IF NOT EXISTS idx_search_history_user_id ON search_history(user_id);
CREATE INDEX IF NOT EXISTS idx_search_history_created_at ON search_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_history_user_id_keyword ON search_history(user_id, keyword);

-- 跳过配置索引
CREATE INDEX IF NOT EXISTS idx_skip_configs_user_id ON skip_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_skip_configs_config_key ON skip_configs(config_key);
CREATE INDEX IF NOT EXISTS idx_skip_configs_updated_time ON skip_configs(updated_time DESC);

-- 视频源配置索引
CREATE INDEX IF NOT EXISTS idx_source_configs_source_key ON source_configs(source_key);
CREATE INDEX IF NOT EXISTS idx_source_configs_disabled ON source_configs(disabled);
CREATE INDEX IF NOT EXISTS idx_source_configs_from_type ON source_configs(from_type);
CREATE INDEX IF NOT EXISTS idx_source_configs_sort_order ON source_configs(sort_order);
CREATE INDEX IF NOT EXISTS idx_source_configs_is_adult ON source_configs(is_adult);

-- =============================================
-- 第四部分：视图创建
-- =============================================

-- 用户统计视图
CREATE VIEW IF NOT EXISTS user_stats AS
SELECT 
  u.id,
  u.username,
  COUNT(DISTINCT pr.id) as play_count,
  COUNT(DISTINCT f.id) as favorite_count,
  COUNT(DISTINCT sh.id) as search_count,
  u.created_at
FROM users u
LEFT JOIN play_records pr ON u.id = pr.user_id
LEFT JOIN favorites f ON u.id = f.user_id
LEFT JOIN search_history sh ON u.id = sh.user_id
GROUP BY u.id, u.username, u.created_at;

-- =============================================
-- 第五部分：默认数据
-- =============================================

-- 插入默认管理员配置
INSERT OR IGNORE INTO admin_configs (config_key, config_value, description) VALUES
('site_name', 'KatelyaTV', '站点名称'),
('site_description', '高性能影视播放平台', '站点描述'),
('enable_register', 'true', '是否允许用户注册'),
('max_users', '100', '最大用户数量'),
('cache_ttl', '3600', '缓存时间（秒）');

-- =============================================
-- 第六部分：数据迁移脚本
-- =============================================

-- 注意：Cloudflare D1 不支持直接使用 SQL 的 BEGIN TRANSACTION 语句
-- 应使用 JavaScript API: state.storage.transaction() 或 state.storage.transactionSync()
-- 以下语句已移除事务控制，在 JavaScript 中应包装在事务API中执行

-- 注意：D1 不支持在 SELECT 语句中使用 EXISTS 子查询检查表是否存在
-- 以下是迁移旧数据的安全方式，如果表不存在会自动跳过
-- 如果需要迁移旧的 admin_config 表数据，请取消下面注释并单独执行

-- 迁移旧的 admin_config 表数据（已注释，需要时手动执行）
/*
INSERT OR IGNORE INTO admin_configs (config_key, config_value, description)
VALUES ('main_config', 
       (SELECT config FROM admin_config WHERE id = 1), 
       '从旧表迁移的主要管理员配置');
*/

-- 更新版本信息
UPDATE db_version SET version = '1.2.0', description = '完成数据迁移，包含用户到期时间功能' WHERE id = 1;

-- =============================================
-- 第七部分：实用查询
-- =============================================

-- 检查表是否存在
-- SELECT name FROM sqlite_master WHERE type='table' AND name='users';

-- 检查表结构
-- PRAGMA table_info(users);

-- 检查索引是否创建
-- SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='users';

-- 检查数据库版本
-- SELECT * FROM db_version;
