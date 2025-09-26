import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from '@/lib/db';

/**
 * 用户数据迁移 API
 * POST /api/admin/migrate-users
 * 
 * 将 admin_configs 表中的 UserConfig 中的 Users 数据迁移到 users 表中
 */
export async function POST(request: NextRequest) {
  try {
    // 检查存储类型，只有 D1 存储才需要迁移
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return NextResponse.json({
        success: false,
        message: 'localstorage 模式不需要迁移用户数据'
      }, { status: 400 });
    }

    const storage = getStorage();
    if (!storage) {
      return NextResponse.json({
        success: false,
        message: '无法获取存储实例'
      }, { status: 500 });
    }

    // 检查是否为 D1 存储
    if (!(storage as any).getDatabase) {
      return NextResponse.json({
        success: false,
        message: '当前存储类型不支持此迁移操作'
      }, { status: 400 });
    }

    // 获取 D1 数据库实例
    const db = await (storage as any).getDatabase();

    // 执行迁移逻辑
    const migrationResult = await migrateAdminUsersToUsersTable(db);

    return NextResponse.json({
      success: true,
      message: '用户数据迁移完成',
      data: migrationResult
    });

  } catch (error) {
    console.error('用户数据迁移失败:', error);
    return NextResponse.json({
      success: false,
      message: '用户数据迁移失败',
      error: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
}

/**
 * 获取迁移状态 API
 * GET /api/admin/migrate-users
 * 
 * 检查是否需要迁移以及当前状态
 */
export async function GET() {
  try {
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return NextResponse.json({
        success: true,
        needMigration: false,
        message: 'localstorage 模式不需要迁移'
      });
    }

    const storage = getStorage();
    if (!storage || !(storage as any).getDatabase) {
      return NextResponse.json({
        success: false,
        message: '无法检查迁移状态'
      }, { status: 500 });
    }

    const db = await (storage as any).getDatabase();
    const status = await checkMigrationStatus(db);

    return NextResponse.json({
      success: true,
      ...status
    });

  } catch (error) {
    console.error('检查迁移状态失败:', error);
    return NextResponse.json({
      success: false,
      message: '检查迁移状态失败',
      error: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
}

/**
 * 检查迁移状态
 */
async function checkMigrationStatus(db: any) {
  try {
    // 检查 admin_configs 表中是否有用户数据
    const adminConfigResult = await db.prepare(`
      SELECT config_value 
      FROM admin_configs 
      WHERE config_key = 'main_config'
    `).first();

    let hasUsersInAdminConfig = false;
    let usersCount = 0;

    if (adminConfigResult) {
      try {
        const adminConfig = JSON.parse(adminConfigResult.config_value);
        if (adminConfig.UserConfig?.Users && Array.isArray(adminConfig.UserConfig.Users)) {
          usersCount = adminConfig.UserConfig.Users.length;
          hasUsersInAdminConfig = usersCount > 0;
        }
      } catch (error) {
        console.error('解析 admin_config JSON 失败:', error);
      }
    }

    // 检查 users 表中的用户数量
    const userTableResult = await db.prepare(`
      SELECT COUNT(*) as count FROM users
    `).first();

    const usersInTable = userTableResult?.count || 0;

    return {
      needMigration: hasUsersInAdminConfig,
      usersInAdminConfig: usersCount,
      usersInTable: usersInTable,
      message: hasUsersInAdminConfig 
        ? `发现 ${usersCount} 个用户需要迁移，users 表中已有 ${usersInTable} 个用户`
        : `admin_configs 表中没有用户数据，users 表中已有 ${usersInTable} 个用户`
    };

  } catch (error) {
    console.error('检查迁移状态时发生错误:', error);
    throw error;
  }
}

/**
 * 执行用户数据迁移
 */
async function migrateAdminUsersToUsersTable(db: any) {
  console.log('开始迁移 admin_configs 表中的用户数据到 users 表...');

  // 第一步：从 admin_configs 表读取 UserConfig 数据
  const adminConfigResult = await db.prepare(`
    SELECT config_value 
    FROM admin_configs 
    WHERE config_key = 'main_config'
  `).first();

  if (!adminConfigResult) {
    throw new Error('未找到 admin_configs 表中的 main_config 数据');
  }

  let adminConfig;
  try {
    adminConfig = JSON.parse(adminConfigResult.config_value);
  } catch (error) {
    throw new Error('解析 admin_config JSON 数据失败: ' + error);
  }

  // 检查是否有 UserConfig 和 Users 数据
  if (!adminConfig.UserConfig || !adminConfig.UserConfig.Users || !Array.isArray(adminConfig.UserConfig.Users)) {
    throw new Error('admin_config 中没有找到 UserConfig.Users 数据');
  }

  const users = adminConfig.UserConfig.Users;
  if (users.length === 0) {
    return {
      migratedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      message: '没有用户数据需要迁移'
    };
  }

  // 第二步：迁移用户数据
  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

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
      // 生成临时密码，用户需要重新设置
      const password = 'temp_password_' + Math.random().toString(36).substring(2, 15);
      const expiresAt = user.expires_at || null; // 到期时间
      
      // 插入用户到 users 表
      await db.prepare(`
        INSERT INTO users (username, password, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(username, password, expiresAt).run();

      console.log(`成功迁移用户: ${username} (角色: ${user.role}, 到期时间: ${expiresAt || '永不过期'})`);
      migratedCount++;

    } catch (error) {
      const errorMsg = `迁移用户 ${user.username} 失败: ${error}`;
      console.error(errorMsg);
      errors.push(errorMsg);
      errorCount++;
    }
  }

  // 第三步：更新 admin_configs 表，清空 Users 数据
  if (migratedCount > 0) {
    // 清空 UserConfig 中的 Users 数组
    adminConfig.UserConfig.Users = [];
    
    await db.prepare(`
      UPDATE admin_configs 
      SET config_value = ?, updated_at = CURRENT_TIMESTAMP
      WHERE config_key = 'main_config'
    `).bind(JSON.stringify(adminConfig)).run();

    console.log('已清空 admin_configs 表中的 Users 数据');
  }

  return {
    migratedCount,
    skippedCount,
    errorCount,
    errors,
    message: `迁移完成：成功 ${migratedCount} 个，跳过 ${skippedCount} 个，失败 ${errorCount} 个`,
    warnings: [
      '所有迁移的用户都使用了临时密码，需要通知用户重新设置密码',
      '用户角色信息已保留在原 admin_configs 中，但 Users 数组已清空',
      '建议验证迁移结果并测试应用功能'
    ]
  };
}