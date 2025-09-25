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
      const expiryTime = await db.getUserExpiryTime(username);
      
      if (expiryTime) {
        const now = new Date();
        const expiry = new Date(expiryTime);
        const timeDiff = expiry.getTime() - now.getTime();
        const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));
        
        if (now > expiry) {
          // 用户已过期
          const daysExpired = Math.ceil((now.getTime() - expiry.getTime()) / (1000 * 3600 * 24));
          return NextResponse.json({
            expired: true,
            expiryTime: expiryTime,
            daysExpired: daysExpired,
            message: `您的账户已过期 ${daysExpired} 天，请联系站长续期。`
          }, { status: 403 });
        }
        
        // 用户未过期，返回到期时间和剩余天数
        let message = '账户正常';
        if (daysRemaining <= 7) {
          message = `账户将在 ${daysRemaining} 天后过期，请及时续期。`;
        } else if (daysRemaining <= 30) {
          message = `账户将在 ${daysRemaining} 天后过期。`;
        }
        
        return NextResponse.json({
          expired: false,
          expiryTime: expiryTime,
          daysRemaining: daysRemaining,
          message: message
        });
      } else {
        // 用户永不过期
        return NextResponse.json({
          expired: false,
          expiryTime: null,
          daysRemaining: null,
          message: '账户永不过期'
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