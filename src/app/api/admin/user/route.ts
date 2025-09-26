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

    // 获取存储
    const storage = getStorage();
    if (!storage) {
      return NextResponse.json({ error: '存储未配置' }, { status: 500 });
    }

    // 判定操作者角色
    let operatorRole: 'owner' | 'admin';
    if (username === process.env.USERNAME) {
      operatorRole = 'owner';
    } else {
      // 从数据库获取操作者角色
      const operatorUserRole = await storage.getUserRole(username);
      if (!operatorUserRole || operatorUserRole !== 'admin') {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
      operatorRole = 'admin';
    }

    // 检查目标用户是否存在
    const userExists = await storage.checkUserExist(targetUsername);
    if (!userExists) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    // 获取目标用户角色
    const targetUserRole = await storage.getUserRole(targetUsername);
    if (!targetUserRole) {
      return NextResponse.json({ error: '无法获取用户角色' }, { status: 500 });
    }

    // 权限检查：管理员不能查看其他管理员的信息（除非是站长）
    const isTargetAdmin = targetUserRole === 'admin';
    if (isTargetAdmin && operatorRole !== 'owner' && username !== targetUsername) {
      return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    // 获取用户到期时间
    let expiryTime: string | null = null;
    if (typeof storage.getUserExpiryTime === 'function') {
      try {
        expiryTime = await storage.getUserExpiryTime(targetUsername);
      } catch (error) {
        console.error('获取用户到期时间失败:', error);
      }
    }

    // 获取用户封禁状态
    let banned = false;
    try {
      banned = await storage.getUserBanned(targetUsername);
    } catch (error) {
      console.error('获取用户封禁状态失败:', error);
    }

    return NextResponse.json({
      username: targetUsername,
      role: targetUserRole,
      banned: banned,
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
    if (!storage) {
      return NextResponse.json({ error: '存储未配置' }, { status: 500 });
    }

    // 判定操作者角色
    let operatorRole: 'owner' | 'admin';
    if (username === process.env.USERNAME) {
      operatorRole = 'owner';
    } else {
      // 从数据库获取操作者角色
      const operatorUserRole = await storage.getUserRole(username);
      if (!operatorUserRole || operatorUserRole !== 'admin') {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
      operatorRole = 'admin';
    }

    // 检查目标用户是否存在（除了添加用户操作）
    let targetUserExists = false;
    let targetUserRole: string | null = null;
    if (action !== 'add' && targetUsername) {
      targetUserExists = await storage.checkUserExist(targetUsername);
      if (targetUserExists) {
        targetUserRole = await storage.getUserRole(targetUsername);
      }
    }

    // 检查是否试图操作站长
    if (
      targetUserRole === 'owner' &&
      action !== 'changePassword'
    ) {
      return NextResponse.json({ error: '无法操作站长' }, { status: 400 });
    }

    // 权限校验逻辑
    const isTargetAdmin = targetUserRole === 'admin';

    if (action === 'setAllowRegister') {
      if (typeof allowRegister !== 'boolean') {
        return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
      }
      adminConfig.UserConfig.AllowRegister = allowRegister;
      // 保存后直接返回成功（走后面的统一保存逻辑）
    } else {
      switch (action) {
        case 'add': {
          // 检查用户是否已存在
          const userExists = await storage.checkUserExist(targetUsername!);
          if (userExists) {
            return NextResponse.json({ error: '用户已存在' }, { status: 400 });
          }
          if (!targetPassword) {
            return NextResponse.json(
              { error: '缺少目标用户密码' },
              { status: 400 }
            );
          }
          if (typeof storage.registerUser !== 'function') {
            return NextResponse.json(
              { error: '存储未配置用户注册' },
              { status: 500 }
            );
          }
          // 注册用户（角色默认为 'user'）
          await storage.registerUser(targetUsername!, targetPassword);
          // 更新本地变量以便后续权限检查
          targetUserExists = true;
          targetUserRole = 'user';
          break;
        }
        case 'ban': {
          if (!targetUserExists) {
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
          // 检查用户是否已被封禁
          const isAlreadyBanned = await storage.getUserBanned(targetUsername!);
          if (isAlreadyBanned) {
            return NextResponse.json(
              { error: '用户已被封禁' },
              { status: 400 }
            );
          }
          // 封禁用户
          await storage.setUserBanned(targetUsername!, true);
          break;
        }
        case 'unban': {
          if (!targetUserExists) {
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
          // 检查用户是否已被封禁
          const isBanned = await storage.getUserBanned(targetUsername!);
          if (!isBanned) {
            return NextResponse.json(
              { error: '用户未被封禁' },
              { status: 400 }
            );
          }
          // 解封用户
          await storage.setUserBanned(targetUsername!, false);
          break;
        }
        case 'setAdmin': {
          if (!targetUserExists) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (targetUserRole === 'admin') {
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
          // 更新数据库中的角色
          await storage.setUserRole(targetUsername!, 'admin');
          targetUserRole = 'admin';
          break;
        }
        case 'cancelAdmin': {
          if (!targetUserExists) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (targetUserRole !== 'admin') {
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
          // 更新数据库中的角色
          await storage.setUserRole(targetUsername!, 'user');
          targetUserRole = 'user';
          break;
        }
        case 'setVip': {
          if (!targetUserExists) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          // 不能将站长设为VIP用户，但可以将普通用户和管理员设为VIP用户
          if (targetUserRole === 'owner') {
            return NextResponse.json(
              { error: '不能将站长设为VIP用户' },
              { status: 400 }
            );
          }
          // 管理员和站长都可以设置VIP用户
          await storage.setUserRole(targetUsername!, 'vip');
          targetUserRole = 'vip';
          break;
        }
        case 'cancelVip': {
          if (!targetUserExists) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (targetUserRole !== 'vip') {
            return NextResponse.json(
              { error: '目标用户不是VIP用户' },
              { status: 400 }
            );
          }
          // 管理员和站长都可以取消VIP用户
          await storage.setUserRole(targetUsername!, 'user');
          targetUserRole = 'user';
          break;
        }
        case 'changePassword': {
          if (!targetUserExists) {
            return NextResponse.json(
              { error: '目标用户不存在' },
              { status: 404 }
            );
          }
          if (!targetPassword) {
            return NextResponse.json({ error: '缺少新密码' }, { status: 400 });
          }

          // 权限检查：不允许修改站长密码
          if (targetUserRole === 'owner') {
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

          if (typeof storage.changePassword !== 'function') {
            return NextResponse.json(
              { error: '存储未配置密码修改功能' },
              { status: 500 }
            );
          }

          await storage.changePassword(targetUsername!, targetPassword);
          break;
        }
        case 'deleteUser': {
          if (!targetUserExists) {
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

          if (typeof storage.deleteUser !== 'function') {
            return NextResponse.json(
              { error: '存储未配置用户删除功能' },
              { status: 500 }
            );
          }

          await storage.deleteUser(targetUsername!);
          break;
        }
        case 'setUserExpiry': {
          if (!targetUserExists) {
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

          if (typeof storage.setUserExpiryTime !== 'function') {
            return NextResponse.json(
              { error: '存储未配置用户到期时间功能' },
              { status: 500 }
            );
          }

          // 设置用户到期时间
          await storage.setUserExpiryTime(targetUsername!, expiryTime || null);
          break;
        }
        default:
          return NextResponse.json({ error: '未知操作' }, { status: 400 });
      }
    }

    // 只有 setAllowRegister 操作需要保存配置文件
    if (action === 'setAllowRegister') {
      if (typeof (storage as any).setAdminConfig === 'function') {
        await (storage as any).setAdminConfig(adminConfig);
      }
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
