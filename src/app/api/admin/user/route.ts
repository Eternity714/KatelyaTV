/* eslint-disable @typescript-eslint/no-explicit-any,no-console,@typescript-eslint/no-non-null-assertion */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { IStorage } from '@/lib/types';

export const runtime = 'edge';

// GET 方法：获取用户信息（包括到期时间）
export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const targetUsername = searchParams.get('username');

    if (!targetUsername) {
      return NextResponse.json({ error: '缺少用户名参数' }, { status: 400 });
    }

    // 获取配置与存储
    const adminConfig = await getConfig();
    const storage = getStorage();

    // 判定操作者角色
    let operatorRole: 'owner' | 'admin';
    if (username === process.env.USERNAME) {
      operatorRole = 'owner';
    } else {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!userEntry || userEntry.role !== 'admin') {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
      operatorRole = 'admin';
    }

    // 查找目标用户
    const targetEntry = adminConfig.UserConfig.Users.find(
      (u) => u.username === targetUsername
    );

    if (!targetEntry) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    // 权限检查：管理员不能查看其他管理员的信息（除非是站长）
    const isTargetAdmin = targetEntry.role === 'admin';
    if (isTargetAdmin && operatorRole !== 'owner' && username !== targetUsername) {
      return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    // 获取用户到期时间
    let expiryTime: string | null = null;
    if (storage && typeof storage.getUserExpiryTime === 'function') {
      try {
        expiryTime = await storage.getUserExpiryTime(targetUsername);
      } catch (error) {
        console.error('获取用户到期时间失败:', error);
      }
    }

    return NextResponse.json({
      username: targetEntry.username,
      role: targetEntry.role,
      banned: targetEntry.banned || false,
      expires_at: expiryTime,
    });
  } catch (error) {
    console.error('获取用户信息失败:', error);
    return NextResponse.json(
      {
        error: '获取用户信息失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

// 支持的操作类型
const ACTIONS = [
  'add',
  'ban',
  'unban',
  'setAdmin',
  'cancelAdmin',
  'setVip',
  'cancelVip',
  'setAllowRegister',
  'changePassword',
  'deleteUser',
  'setUserExpiry', // 新增：设置用户到期时间
] as const;

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const {
      targetUsername, // 目标用户名
      targetPassword, // 目标用户密码（仅在添加用户时需要）
      allowRegister,
      action,
      expiryTime, // 用户到期时间（ISO 8601 格式字符串或 null）
    } = body as {
      targetUsername?: string;
      targetPassword?: string;
      allowRegister?: boolean;
      action?: (typeof ACTIONS)[number];
      expiryTime?: string | null;
    };

    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    if (action !== 'setAllowRegister' && !targetUsername) {
      return NextResponse.json({ error: '缺少目标用户名' }, { status: 400 });
    }

    if (action === 'setUserExpiry' && expiryTime !== null && expiryTime !== undefined) {
      // 验证到期时间格式（应该是有效的 ISO 8601 字符串）
      try {
        new Date(expiryTime);
      } catch {
        return NextResponse.json({ error: '到期时间格式无效' }, { status: 400 });
      }
    }

    if (
      action !== 'setAllowRegister' &&
      action !== 'changePassword' &&
      action !== 'deleteUser' &&
      username === targetUsername
    ) {
      return NextResponse.json(
        { error: '无法对自己进行此操作' },
        { status: 400 }
      );
    }

    // 获取配置与存储
    const adminConfig = await getConfig();
    const storage: IStorage | null = getStorage();

    // 判定操作者角色
    let operatorRole: 'owner' | 'admin';
    if (username === process.env.USERNAME) {
      operatorRole = 'owner';
    } else {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!userEntry || userEntry.role !== 'admin') {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
      operatorRole = 'admin';
    }

    // 查找目标用户条目
    let targetEntry = adminConfig.UserConfig.Users.find(
      (u) => u.username === targetUsername
    );

    if (
      targetEntry &&
      targetEntry.role === 'owner' &&
      action !== 'changePassword'
    ) {
      return NextResponse.json({ error: '无法操作站长' }, { status: 400 });
    }

    // 权限校验逻辑
    const isTargetAdmin = targetEntry?.role === 'admin';

    if (action === 'setAllowRegister') {
      if (typeof allowRegister !== 'boolean') {
        return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
      }
      adminConfig.UserConfig.AllowRegister = allowRegister;
      // 保存后直接返回成功（走后面的统一保存逻辑）
    } else {
      switch (action) {
        case 'add': {
          if (targetEntry) {
            return NextResponse.json({ error: '用户已存在' }, { status: 400 });
          }
          if (!targetPassword) {
            return NextResponse.json(
              { error: '缺少目标用户密码' },
              { status: 400 }
            );
          }
          if (!storage || typeof storage.registerUser !== 'function') {
            return NextResponse.json(
              { error: '存储未配置用户注册' },
              { status: 500 }
            );
          }
          await storage.registerUser(targetUsername!, targetPassword);
          // 更新配置
          adminConfig.UserConfig.Users.push({
            username: targetUsername!,
            role: 'user',
          });
          targetEntry =
            adminConfig.UserConfig.Users[
              adminConfig.UserConfig.Users.length - 1
            ];
          break;
        }
        case 'ban': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (isTargetAdmin) {
            // 目标是管理员
            if (operatorRole !== 'owner') {
              return NextResponse.json(
                { error: '仅站长可封禁管理员' },
                { status: 401 }
              );
            }
          }
          targetEntry.banned = true;
          break;
        }
        case 'unban': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (isTargetAdmin) {
            if (operatorRole !== 'owner') {
              return NextResponse.json(
                { error: '仅站长可操作管理员' },
                { status: 401 }
              );
            }
          }
          targetEntry.banned = false;
          break;
        }
        case 'setAdmin': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (targetEntry.role === 'admin') {
            return NextResponse.json(
              { error: '该用户已是管理员' },
              { status: 400 }
            );
          }
          if (operatorRole !== 'owner') {
            return NextResponse.json(
              { error: '仅站长可设置管理员' },
              { status: 401 }
            );
          }
          targetEntry.role = 'admin';
          break;
        }
        case 'cancelAdmin': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (targetEntry.role !== 'admin') {
            return NextResponse.json(
              { error: '目标用户不是管理员' },
              { status: 400 }
            );
          }
          if (operatorRole !== 'owner') {
            return NextResponse.json(
              { error: '仅站长可取消管理员' },
              { status: 401 }
            );
          }
          targetEntry.role = 'user';
          break;
        }
        case 'setVip': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (targetEntry.role !== 'user') {
            return NextResponse.json(
              { error: '只能将普通用户设为VIP用户' },
              { status: 400 }
            );
          }
          // 管理员和站长都可以设置VIP用户
          targetEntry.role = 'vip';
          break;
        }
        case 'cancelVip': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (targetEntry.role !== 'vip') {
            return NextResponse.json(
              { error: '目标用户不是VIP用户' },
              { status: 400 }
            );
          }
          // 管理员和站长都可以取消VIP用户
          targetEntry.role = 'user';
          break;
        }
        case 'changePassword': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (!targetPassword) {
            return NextResponse.json({ error: '缺少新密码' }, { status: 400 });
          }

          // 权限检查：不允许修改站长密码
          if (targetEntry.role === 'owner') {
            return NextResponse.json(
              { error: '无法修改站长密码' },
              { status: 401 }
            );
          }

          if (
            isTargetAdmin &&
            operatorRole !== 'owner' &&
            username !== targetUsername
          ) {
            return NextResponse.json(
              { error: '仅站长可修改其他管理员密码' },
              { status: 401 }
            );
          }

          if (!storage || typeof storage.changePassword !== 'function') {
            return NextResponse.json(
              { error: '存储未配置密码修改功能' },
              { status: 500 }
            );
          }

          await storage.changePassword(targetUsername!, targetPassword);
          break;
        }
        case 'deleteUser': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }

          // 权限检查：站长可删除所有用户（除了自己），管理员可删除普通用户
          if (username === targetUsername) {
            return NextResponse.json(
              { error: '不能删除自己' },
              { status: 400 }
            );
          }

          if (isTargetAdmin && operatorRole !== 'owner') {
            return NextResponse.json(
              { error: '仅站长可删除管理员' },
              { status: 401 }
            );
          }

          if (!storage || typeof storage.deleteUser !== 'function') {
            return NextResponse.json(
              { error: '存储未配置用户删除功能' },
              { status: 500 }
            );
          }

          await storage.deleteUser(targetUsername!);

          // 从配置中移除用户
          const userIndex = adminConfig.UserConfig.Users.findIndex(
            (u) => u.username === targetUsername
          );
          if (userIndex > -1) {
            adminConfig.UserConfig.Users.splice(userIndex, 1);
          }

          break;
        }
        case 'setUserExpiry': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }

          // 权限检查：站长可设置所有用户的到期时间，管理员可设置普通用户和VIP用户的到期时间
          if (isTargetAdmin && operatorRole !== 'owner') {
            return NextResponse.json(
              { error: '仅站长可设置管理员的到期时间' },
              { status: 401 }
            );
          }

          if (!storage || typeof storage.setUserExpiryTime !== 'function') {
            return NextResponse.json(
              { error: '存储未配置用户到期时间功能' },
              { status: 500 }
            );
          }

          // 设置用户到期时间
          await storage.setUserExpiryTime(targetUsername!, expiryTime || null);
          
          // 更新配置中的用户信息
          targetEntry.expires_at = expiryTime || null;

          break;
        }
        default:
          return NextResponse.json({ error: '未知操作' }, { status: 400 });
      }
    }

    // 将更新后的配置写入数据库
    if (storage && typeof (storage as any).setAdminConfig === 'function') {
      await (storage as any).setAdminConfig(adminConfig);
    }

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 管理员配置不缓存
        },
      }
    );
  } catch (error) {
    console.error('用户管理操作失败:', error);
    return NextResponse.json(
      {
        error: '用户管理操作失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
