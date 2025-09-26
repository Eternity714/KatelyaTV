/**
 * 数据迁移脚本：将 admin_configs 表中的 UserConfig 中的 Users 数据迁移到 users 表中
 * 
 * 使用方法：
 * 1. 在 Cloudflare Workers/Pages 环境中运行
 * 2. 或者通过 wrangler d1 execute 命令执行
 */

/**
 * 迁移 admin_configs 表中的用户数据到 users 表
 * @param {Object} db - D1 数据库连接对象
 */
async function migrateAdminUsersToUsersTable(db) {
  console.log('开始迁移 admin_configs 表中的用户数据到 users 表...');

  try {
    // 第一步：从 admin_configs 表读取 UserConfig 数据
    console.log('1. 读取 admin_configs 表中的 UserConfig 数据...');
    const adminConfigResult = await db.prepare(`
      SELECT config_value 
      FROM admin_configs 
      WHERE config_key = 'main_config'
    `).first();

    if (!adminConfigResult) {
      console.log('未找到 admin_configs 表中的 main_config 数据，跳过迁移');
      return;
    }

    let adminConfig;
    try {
      adminConfig = JSON.parse(adminConfigResult.config_value);
    } catch (error) {
      console.error('解析 admin_config JSON 数据失败:', error);
      return;
    }

    // 检查是否有 UserConfig 和 Users 数据
    if (!adminConfig.UserConfig || !adminConfig.UserConfig.Users || !Array.isArray(adminConfig.UserConfig.Users)) {
      console.log('admin_config 中没有找到 UserConfig.Users 数据，跳过迁移');
      return;
    }

    const users = adminConfig.UserConfig.Users;
    console.log(`找到 ${users.length} 个用户需要迁移`);

    if (users.length === 0) {
      console.log('没有用户数据需要迁移');
      return;
    }

    // 第二步：检查 users 表是否存在
    console.log('2. 检查 users 表结构...');
    const tableExists = await db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='users'
    `).first();

    if (!tableExists) {
      console.error('users 表不存在，请先创建 users 表');
      return;
    }

    // 第三步：迁移用户数据
    console.log('3. 开始迁移用户数据...');
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        // 检查用户是否已存在
        const existingUser = await db.prepare(`
          SELECT username FROM users WHERE username = ?
        `).bind(user.username).first();

        if (existingUser) {
          console.log(`用户 ${user.username} 已存在，跳过迁移`);
          skippedCount++;
          continue;
        }

        // 处理用户数据
        const username = user.username;
        const password = 'temp_password_' + Math.random().toString(36).substring(2, 15); // 临时密码，需要用户重新设置
        const expiresAt = user.expires_at || null; // 到期时间
        
        // 插入用户到 users 表
        await db.prepare(`
          INSERT INTO users (username, password, expires_at, created_at, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).bind(username, password, expiresAt).run();

        console.log(`成功迁移用户: ${username} (角色: ${user.role}, 到期时间: ${expiresAt || '永不过期'})`);
        migratedCount++;

      } catch (error) {
        console.error(`迁移用户 ${user.username} 失败:`, error);
        errorCount++;
      }
    }

    console.log(`\n迁移完成统计:`);
    console.log(`- 成功迁移: ${migratedCount} 个用户`);
    console.log(`- 跳过迁移: ${skippedCount} 个用户 (已存在)`);
    console.log(`- 迁移失败: ${errorCount} 个用户`);

    // 第四步：更新 admin_configs 表，清空 Users 数据
    if (migratedCount > 0) {
      console.log('\n4. 更新 admin_configs 表，清空 Users 数据...');
      
      // 清空 UserConfig 中的 Users 数组
      adminConfig.UserConfig.Users = [];
      
      await db.prepare(`
        UPDATE admin_configs 
        SET config_value = ?, updated_at = CURRENT_TIMESTAMP
        WHERE config_key = 'main_config'
      `).bind(JSON.stringify(adminConfig)).run();

      console.log('已清空 admin_configs 表中的 Users 数据');
    }

    console.log('\n用户数据迁移完成！');
    console.log('\n重要提示：');
    console.log('1. 所有迁移的用户都使用了临时密码，需要通知用户重新设置密码');
    console.log('2. 用户角色信息已保留在原 admin_configs 中，但 Users 数组已清空');
    console.log('3. 建议在生产环境运行前先在测试环境验证迁移结果');

  } catch (error) {
    console.error('迁移过程中发生错误:', error);
    throw error;
  }
}

/**
 * 验证迁移结果
 * @param {Object} db - D1 数据库连接对象
 */
async function validateMigration(db) {
  console.log('\n开始验证迁移结果...');

  try {
    // 检查 users 表中的用户数量
    const userCount = await db.prepare(`
      SELECT COUNT(*) as count FROM users
    `).first();

    console.log(`users 表中共有 ${userCount.count} 个用户`);

    // 检查 admin_configs 表中的 Users 数据
    const adminConfigResult = await db.prepare(`
      SELECT config_value 
      FROM admin_configs 
      WHERE config_key = 'main_config'
    `).first();

    if (adminConfigResult) {
      const adminConfig = JSON.parse(adminConfigResult.config_value);
      const remainingUsers = adminConfig.UserConfig?.Users?.length || 0;
      console.log(`admin_configs 表中剩余 ${remainingUsers} 个用户记录`);
    }

    console.log('验证完成');

  } catch (error) {
    console.error('验证过程中发生错误:', error);
  }
}

// 导出函数供外部调用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    migrateAdminUsersToUsersTable,
    validateMigration
  };
}

// 如果直接运行此脚本（在 Node.js 环境中）
if (typeof require !== 'undefined' && require.main === module) {
  console.log('请在 Cloudflare Workers/Pages 环境中运行此迁移脚本');
  console.log('或者使用 wrangler d1 execute 命令执行相关 SQL');
}