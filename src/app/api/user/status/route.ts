import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    // 获取认证信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = authInfo.username;

    // 检查用户是否存在
    const userExists = await db.checkUserExist(username);
    if (!userExists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // 检查用户到期时间
    try {
      const storage = db.storage;
      if (storage && typeof storage.getUserExpiryTime === 'function') {
        const expiryTime = await storage.getUserExpiryTime(username);
        
        if (expiryTime) {
          const now = new Date();
          const expiry = new Date(expiryTime);
          
          if (now > expiry) {
            // 用户已过期
            return NextResponse.json({
              expired: true,
              expiryTime: expiryTime,
              message: '您的账户已过期，请联系站长续期。'
            }, { status: 403 });
          }
          
          // 用户未过期，返回到期时间
          return NextResponse.json({
            expired: false,
            expiryTime: expiryTime,
            message: '账户正常'
          });
        } else {
          // 用户永不过期
          return NextResponse.json({
            expired: false,
            expiryTime: null,
            message: '账户永不过期'
          });
        }
      } else {
        // 存储不支持到期时间功能
        return NextResponse.json({
          expired: false,
          expiryTime: null,
          message: '当前存储类型不支持到期时间功能'
        });
      }
    } catch (error) {
      console.error('检查用户到期时间失败:', error);
      return NextResponse.json(
        { error: '检查用户状态失败' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('用户状态检查API异常:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}