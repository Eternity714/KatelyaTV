#!/usr/bin/env node

/**
 * 数据迁移脚本：将 SourceConfig 从 admin_configs 迁移到 source_configs 表
 * 使用方法：node scripts/migrate-source-configs.js
 */

const path = require('path');
const fs = require('fs');

// 动态导入 ES 模块
async function runMigration() {
  try {
    // 设置环境变量
    process.env.NODE_ENV = process.env.NODE_ENV || 'development';
    
    console.log('开始 SourceConfig 数据迁移...');
    
    // 动态导入数据库模块
    const { getDB } = await import('../src/lib/db.js');
    const { getAdminConfig, setAdminConfig } = await import('../src/lib/config.js');
    
    const db = getDB();
    
    // 检查 source_configs 表是否存在
    console.log('检查 source_configs 表...');
    
    // 创建 source_configs 表（如果不存在）
    await db.exec(`
      CREATE TABLE IF NOT EXISTS source_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        api TEXT NOT NULL,
        detail TEXT,
        from_type TEXT NOT NULL DEFAULT 'custom',
        disabled BOOLEAN DEFAULT 0,
        is_adult BOOLEAN DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // 创建索引
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_source_configs_source_key ON source_configs(source_key);
      CREATE INDEX IF NOT EXISTS idx_source_configs_disabled ON source_configs(disabled);
      CREATE INDEX IF NOT EXISTS idx_source_configs_from_type ON source_configs(from_type);
      CREATE INDEX IF NOT EXISTS idx_source_configs_sort_order ON source_configs(sort_order);
      CREATE INDEX IF NOT EXISTS idx_source_configs_is_adult ON source_configs(is_adult);
    `);
    
    console.log('source_configs 表已准备就绪');
    
    // 检查是否已经有数据
    const existingCount = await db.prepare('SELECT COUNT(*) as count FROM source_configs').get();
    if (existingCount.count > 0) {
      console.log(`source_configs 表中已有 ${existingCount.count} 条记录，跳过迁移`);
      return;
    }
    
    // 获取现有的 AdminConfig
    console.log('获取现有的 AdminConfig...');
    const adminConfig = await getAdminConfig();
    
    if (!adminConfig || !adminConfig.SourceConfig || !Array.isArray(adminConfig.SourceConfig)) {
      console.log('未找到需要迁移的 SourceConfig 数据');
      return;
    }
    
    console.log(`找到 ${adminConfig.SourceConfig.length} 个视频源配置，开始迁移...`);
    
    // 准备插入语句
    const insertStmt = db.prepare(`
      INSERT INTO source_configs (
        source_key, name, api, detail, from_type, disabled, is_adult, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    // 迁移每个源配置
    let migratedCount = 0;
    for (let i = 0; i < adminConfig.SourceConfig.length; i++) {
      const source = adminConfig.SourceConfig[i];
      
      try {
        await insertStmt.run(
          source.key,
          source.name,
          source.api,
          source.detail || null,
          source.from || 'custom',
          source.disabled ? 1 : 0,
          source.is_adult ? 1 : 0,
          i
        );
        migratedCount++;
        console.log(`✓ 迁移源配置: ${source.name} (${source.key})`);
      } catch (error) {
        console.error(`✗ 迁移失败: ${source.name} (${source.key})`, error.message);
      }
    }
    
    console.log(`成功迁移 ${migratedCount} 个视频源配置`);
    
    // 从 AdminConfig 中移除 SourceConfig 字段
    console.log('更新 AdminConfig，移除 SourceConfig 字段...');
    const updatedAdminConfig = { ...adminConfig };
    delete updatedAdminConfig.SourceConfig;
    
    await setAdminConfig(updatedAdminConfig);
    console.log('AdminConfig 已更新');
    
    // 验证迁移结果
    const finalCount = await db.prepare('SELECT COUNT(*) as count FROM source_configs').get();
    console.log(`迁移完成！source_configs 表中共有 ${finalCount.count} 条记录`);
    
    // 显示迁移的数据
    const sources = await db.prepare('SELECT * FROM source_configs ORDER BY sort_order').all();
    console.log('\n迁移的视频源配置：');
    sources.forEach((source, index) => {
      console.log(`${index + 1}. ${source.name} (${source.source_key})`);
      console.log(`   API: ${source.api}`);
      console.log(`   详情: ${source.detail || '无'}`);
      console.log(`   状态: ${source.disabled ? '禁用' : '启用'}`);
      console.log(`   成人内容: ${source.is_adult ? '是' : '否'}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('迁移过程中发生错误:', error);
    process.exit(1);
  }
}

// 运行迁移
runMigration().then(() => {
  console.log('迁移脚本执行完成');
  process.exit(0);
}).catch((error) => {
  console.error('迁移脚本执行失败:', error);
  process.exit(1);
});