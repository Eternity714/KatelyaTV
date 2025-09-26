-- 用户数据迁移脚本：将 admin_configs 表中的 UserConfig 中的 Users 数据迁移到 users 表中
-- 
-- 注意：此脚本仅包含基础 SQL 结构，实际迁移需要在 JavaScript 中处理 JSON 数据解析
-- 建议使用配套的 migrate-admin-users-to-users-table.js 脚本进行完整迁移
--
-- 使用方法：
-- 1. 先运行 JavaScript 迁移脚本处理 JSON 数据
-- 2. 或者手动执行以下 SQL 语句进行数据验证

-- =============================================
-- 第一部分：数据验证查询
-- =============================================

-- 查看当前 admin_configs 表中的 main_config 数据
-- SELECT config_key, config_value FROM admin_configs WHERE config_key = 'main_config';

-- 查看当前 users 表中的用户数量
-- SELECT COUNT(*) as user_count FROM users;

-- 查看 users 表中的所有用户
-- SELECT username, expires_at, created_at FROM users ORDER BY created_at DESC;

-- =============================================
-- 第二部分：手动迁移示例（需要根据实际数据调整）
-- =============================================

-- 注意：以下 SQL 仅为示例，实际执行时需要根据 admin_configs 表中的具体数据进行调整
-- 建议使用 JavaScript 脚本自动处理 JSON 数据解析和迁移

-- 示例：手动插入用户（需要替换为实际的用户数据）
-- INSERT OR IGNORE INTO users (username, password, expires_at, created_at, updated_at)
-- VALUES 
--   ('admin_user', 'temp_password_123', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
--   ('test_user', 'temp_password_456', '2024-12-31T23:59:59Z', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- =============================================
-- 第三部分：迁移后清理（在 JavaScript 脚本中执行）
-- =============================================

-- 注意：以下操作会修改 admin_configs 表中的数据，请谨慎执行
-- 建议先备份数据，然后在 JavaScript 脚本中执行

-- 示例：更新 admin_configs 表，清空 UserConfig 中的 Users 数组
-- 这需要在 JavaScript 中处理 JSON 数据，然后更新数据库
-- UPDATE admin_configs 
-- SET config_value = '{"SiteConfig":{...},"UserConfig":{"AllowRegister":true,"Users":[]}}',
--     updated_at = CURRENT_TIMESTAMP
-- WHERE config_key = 'main_config';

-- =============================================
-- 第四部分：验证查询
-- =============================================

-- 验证迁移后的用户数据
-- SELECT 
--   u.username,
--   u.expires_at,
--   u.created_at,
--   CASE 
--     WHEN u.expires_at IS NULL THEN '永不过期'
--     WHEN u.expires_at > datetime('now') THEN '有效'
--     ELSE '已过期'
--   END as status
-- FROM users u
-- ORDER BY u.created_at DESC;

-- 验证 admin_configs 表中的 Users 数据是否已清空
-- SELECT 
--   config_key,
--   LENGTH(config_value) as config_length,
--   updated_at
-- FROM admin_configs 
-- WHERE config_key = 'main_config';

-- =============================================
-- 第五部分：回滚操作（紧急情况下使用）
-- =============================================

-- 注意：以下操作用于紧急回滚，请谨慎使用
-- 建议在执行迁移前先备份原始数据

-- 删除迁移的用户（如果需要回滚）
-- DELETE FROM users WHERE created_at >= '2024-01-01T00:00:00Z'; -- 根据实际迁移时间调整

-- 恢复 admin_configs 表中的 Users 数据（需要从备份中恢复）
-- UPDATE admin_configs 
-- SET config_value = '原始备份的 JSON 数据',
--     updated_at = CURRENT_TIMESTAMP
-- WHERE config_key = 'main_config';

-- =============================================
-- 使用说明
-- =============================================

-- 1. 推荐使用方式：
--    运行 migrate-admin-users-to-users-table.js 脚本进行自动迁移
--
-- 2. 手动迁移步骤：
--    a) 先查询 admin_configs 表中的数据，了解需要迁移的用户
--    b) 手动解析 JSON 数据，提取用户信息
--    c) 逐个插入用户到 users 表
--    d) 更新 admin_configs 表，清空 Users 数组
--
-- 3. 验证步骤：
--    a) 检查 users 表中的用户数量和数据
--    b) 确认 admin_configs 表中的 Users 数组已清空
--    c) 测试应用功能是否正常
--
-- 4. 注意事项：
--    a) 迁移前请备份数据库
--    b) 所有迁移的用户都使用临时密码，需要重新设置
--    c) 用户角色信息需要在应用层面重新配置
--    d) 建议在测试环境先验证迁移效果