/**
 * 用户设置表数据迁移脚本
 * 将 settings JSON 字段拆分为独立列
 */

const fs = require('fs');
const path = require('path');

/**
 * 迁移用户设置数据
 * @param {Object} db - 数据库连接对象
 */
async function migrateUserSettings(db) {
  console.log('开始迁移用户设置表...');

  try {
    // 检查旧表是否存在
    const tableExists = await db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='user_settings'
    `).first();

    if (!tableExists) {
      console.log('用户设置表不存在，跳过迁移');
      return;
    }

    // 检查旧表结构，确认是否需要迁移
    const tableInfo = await db.prepare(`PRAGMA table_info(user_settings)`).all();
    const hasSettingsColumn = tableInfo.some(col => col.name === 'settings');
    
    if (!hasSettingsColumn) {
      console.log('用户设置表已经是新结构，跳过迁移');
      return;
    }

    console.log('检测到旧的用户设置表结构，开始迁移...');

    // 创建新表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS user_settings_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        filter_adult_content BOOLEAN DEFAULT 1,
        theme TEXT DEFAULT 'auto',
        language TEXT DEFAULT 'zh-CN',
        auto_play BOOLEAN DEFAULT 0,
        video_quality TEXT DEFAULT 'auto',
        updated_time INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
      )
    `);

    // 读取旧表数据
    const oldRecords = await db.prepare(`
      SELECT username, settings, updated_time 
      FROM user_settings
    `).all();

    console.log(`找到 ${oldRecords.length} 条用户设置记录`);

    // 迁移数据
    const insertStmt = db.prepare(`
      INSERT INTO user_settings_new (
        username, 
        filter_adult_content, 
        theme, 
        language, 
        auto_play, 
        video_quality, 
        updated_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let migratedCount = 0;
    let errorCount = 0;

    for (const record of oldRecords) {
      try {
        // 解析 JSON 设置
        let settings = {};
        if (record.settings) {
          try {
            settings = JSON.parse(record.settings);
          } catch (e) {
            console.warn(`解析用户 ${record.username} 的设置 JSON 失败:`, e.message);
          }
        }

        // 提取设置值，使用默认值作为后备
        const filterAdultContent = settings.filter_adult_content !== undefined ? 
          (settings.filter_adult_content ? 1 : 0) : 1;
        const theme = settings.theme || 'auto';
        const language = settings.language || 'zh-CN';
        const autoPlay = settings.auto_play !== undefined ? 
          (settings.auto_play ? 1 : 0) : 0;
        const videoQuality = settings.video_quality || 'auto';

        // 插入新表
        await insertStmt.run(
          record.username,
          filterAdultContent,
          theme,
          language,
          autoPlay,
          videoQuality,
          record.updated_time || Date.now()
        );

        migratedCount++;
      } catch (error) {
        console.error(`迁移用户 ${record.username} 的设置失败:`, error.message);
        errorCount++;
      }
    }

    console.log(`迁移完成: ${migratedCount} 条成功, ${errorCount} 条失败`);

    // 删除旧表并重命名新表
    await db.exec(`DROP TABLE user_settings`);
    await db.exec(`ALTER TABLE user_settings_new RENAME TO user_settings`);

    // 重建索引
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_settings_username ON user_settings(username);
      CREATE INDEX IF NOT EXISTS idx_user_settings_updated_time ON user_settings(updated_time DESC);
      CREATE INDEX IF NOT EXISTS idx_user_settings_filter_adult ON user_settings(filter_adult_content);
      CREATE INDEX IF NOT EXISTS idx_user_settings_theme ON user_settings(theme);
    `);

    console.log('用户设置表迁移完成！');

  } catch (error) {
    console.error('迁移用户设置表时发生错误:', error);
    throw error;
  }
}

/**
 * 验证迁移结果
 * @param {Object} db - 数据库连接对象
 */
async function validateMigration(db) {
  console.log('验证迁移结果...');

  try {
    // 检查新表结构
    const tableInfo = await db.prepare(`PRAGMA table_info(user_settings)`).all();
    console.log('新表结构:');
    tableInfo.forEach(col => {
      console.log(`  ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''} ${col.dflt_value ? `DEFAULT ${col.dflt_value}` : ''}`);
    });

    // 检查数据数量
    const count = await db.prepare(`SELECT COUNT(*) as count FROM user_settings`).first();
    console.log(`迁移后记录数量: ${count.count}`);

    // 检查索引
    const indexes = await db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='index' AND tbl_name='user_settings'
    `).all();
    console.log('索引列表:');
    indexes.forEach(idx => console.log(`  ${idx.name}`));

    console.log('验证完成！');
  } catch (error) {
    console.error('验证迁移结果时发生错误:', error);
  }
}

module.exports = {
  migrateUserSettings,
  validateMigration
};

// 如果直接运行此脚本
if (require.main === module) {
  console.log('请在应用程序中调用此迁移脚本，而不是直接运行');
  console.log('示例用法:');
  console.log('const { migrateUserSettings } = require("./migrate-user-settings");');
  console.log('await migrateUserSettings(db);');
}