-- 用户设置表结构迁移脚本
-- 将 settings JSON 字段拆分为独立列
-- 
-- 注意：Cloudflare D1 不支持直接使用 ALTER TABLE 修改列结构
-- 需要使用重建表的方式进行迁移

-- 第一步：创建新的用户设置表结构
CREATE TABLE IF NOT EXISTS user_settings_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  filter_adult_content BOOLEAN DEFAULT 1, -- 是否过滤成人内容，默认为 true
  theme TEXT DEFAULT 'auto', -- 主题：'light' | 'dark' | 'auto'
  language TEXT DEFAULT 'zh-CN', -- 语言设置
  auto_play BOOLEAN DEFAULT 0, -- 是否自动播放，默认为 false
  video_quality TEXT DEFAULT 'auto', -- 视频质量设置
  updated_time INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

-- 第二步：迁移现有数据（如果旧表存在）
-- 注意：这个脚本假设旧表中的 settings 字段是 JSON 格式
-- 在实际执行时，需要在 JavaScript 中解析 JSON 并插入新表

-- 示例迁移逻辑（需要在 JavaScript 中实现）：
-- 1. 从旧表读取所有记录
-- 2. 解析每条记录的 settings JSON 字段
-- 3. 将解析后的数据插入新表的对应列
-- 4. 删除旧表，重命名新表

-- 第三步：删除旧表并重命名新表（在 JavaScript 中执行）
-- DROP TABLE IF EXISTS user_settings;
-- ALTER TABLE user_settings_new RENAME TO user_settings;

-- 第四步：重建索引
CREATE INDEX IF NOT EXISTS idx_user_settings_username ON user_settings_new(username);
CREATE INDEX IF NOT EXISTS idx_user_settings_updated_time ON user_settings_new(updated_time DESC);
CREATE INDEX IF NOT EXISTS idx_user_settings_filter_adult ON user_settings_new(filter_adult_content);
CREATE INDEX IF NOT EXISTS idx_user_settings_theme ON user_settings_new(theme);