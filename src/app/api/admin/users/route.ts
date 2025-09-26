import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getStorage } from '@/lib/db';

export const runtime = 'edge';

// 获取所有用户列表
export async function GET(request: NextRequest) {
  try {
    // 身份验证
    const authInfo = await getAuthInfoFromCookie(request);
    if (!authInfo) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { username } = authInfo;
    
    // 检查用户名是否存在
    if (!username) {
      return NextResponse.json({ error: '用户名缺失' }, { status: 401 });
    }
    
    const storage = getStorage();
    if (!storage) {
      return NextResponse.json({ error: '存储未初始化' }, { status: 500 });
    }

    // 权限检查：只有管理员和站长可以获取用户列表
    let operatorRole = 'user';
    if (username === process.env.USERNAME) {
      operatorRole = 'owner';
    } else {
      // 从数据库获取操作者角色
      const operatorUserRole = await storage.getUserRole(username);
      if (!operatorUserRole || (operatorUserRole !== 'admin' && operatorUserRole !== 'owner')) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
      operatorRole = operatorUserRole;
    }

    // 获取所有用户名
    const usernames = await storage.getAllUsers();
    
    // 获取每个用户的详细信息
    const users = await Promise.all(
      usernames.map(async (username) => {
        try {
          // 获取用户角色
          const role = await storage.getUserRole(username) || 'user';
          
          // 获取用户到期时间
          let expiryTime: string | null = null;
          if (typeof storage.getUserExpiryTime === 'function') {
            try {
              expiryTime = await storage.getUserExpiryTime(username);
            } catch (error) {
              // 获取到期时间失败，使用默认值
            }
          }

          // 获取用户封禁状态
          let banned = false;
          try {
            banned = await storage.getUserBanned(username);
          } catch (error) {
            // 获取封禁状态失败，使用默认值
          }

          return {
            username,
            role,
            banned,
            expires_at: expiryTime,
          };
        } catch (error) {
          // 获取用户信息失败，尝试至少获取封禁状态
          let banned = false;
          try {
            banned = await storage.getUserBanned(username);
          } catch (bannedError) {
            // 获取封禁状态失败，使用默认值
          }
          
          return {
            username,
            role: 'user',
            banned,
            expires_at: null,
          };
        }
      })
    );

    return NextResponse.json({ users });
  } catch (error) {
    return NextResponse.json(
      {
        error: '获取用户列表失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}