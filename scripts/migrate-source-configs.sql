-- 数据迁移脚本：将 SourceConfig 从 admin_configs 迁移到 source_configs 表
-- 执行时间：2024年1月
-- 说明：此脚本将现有的视频源配置从 admin_configs 表的 JSON 字段中提取并迁移到独立的 source_configs 表

-- 第一步：创建 source_configs 表（如果不存在）
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

-- 第二步：创建索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_source_configs_source_key ON source_configs(source_key);
CREATE INDEX IF NOT EXISTS idx_source_configs_disabled ON source_configs(disabled);
CREATE INDEX IF NOT EXISTS idx_source_configs_from_type ON source_configs(from_type);
CREATE INDEX IF NOT EXISTS idx_source_configs_sort_order ON source_configs(sort_order);
CREATE INDEX IF NOT EXISTS idx_source_configs_is_adult ON source_configs(is_adult);

-- 第三步：数据迁移
-- 注意：由于 SQLite 不支持直接解析 JSON，这个脚本需要在应用层执行
-- 以下是迁移逻辑的伪代码，实际执行需要在 Node.js 中进行：

/*
迁移逻辑（需要在应用层执行）：

1. 从 admin_configs 表中获取 config_key = 'AdminConfig' 的记录
2. 解析 config_value 中的 JSON 数据
3. 提取 SourceConfig 数组
4. 为每个 SourceConfig 项目创建 source_configs 表记录：
   - source_key: item.key
   - name: item.name
   - api: item.api
   - detail: item.detail || null
   - from_type: item.from || 'custom'
   - disabled: item.disabled ? 1 : 0
   - is_adult: item.is_adult ? 1 : 0
   - sort_order: index (数组索引作为排序)
5. 从 admin_configs 的 JSON 中移除 SourceConfig 字段
6. 更新 admin_configs 表中的 config_value

示例迁移代码：
```javascript
// 获取现有配置
const adminConfig = await getAdminConfig('AdminConfig');
if (adminConfig && adminConfig.SourceConfig) {
  // 迁移每个源配置
  for (let i = 0; i < adminConfig.SourceConfig.length; i++) {
    const source = adminConfig.SourceConfig[i];
    await insertSourceConfig({
      source_key: source.key,
      name: source.name,
      api: source.api,
      detail: source.detail || null,
      from_type: source.from || 'custom',
      disabled: source.disabled ? 1 : 0,
      is_adult: source.is_adult ? 1 : 0,
      sort_order: i
    });
  }
  
  // 从 AdminConfig 中移除 SourceConfig
  delete adminConfig.SourceConfig;
  await setAdminConfig('AdminConfig', adminConfig);
}
```
*/

-- 第四步：验证迁移结果
-- 检查 source_configs 表中的数据
-- SELECT COUNT(*) as source_count FROM source_configs;
-- SELECT * FROM source_configs ORDER BY sort_order;

-- 第五步：清理（可选）
-- 如果迁移成功，可以考虑从 admin_configs 的 JSON 中移除 SourceConfig 字段
-- 这一步需要在应用层完成，因为需要解析和修改 JSON 数据