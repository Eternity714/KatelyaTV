/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, getAvailableApiSites } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { IStorage, SourceConfig } from '@/lib/types';

export const runtime = 'edge';

// 支持的操作类型
type Action = 'add' | 'disable' | 'enable' | 'delete' | 'sort';

// GET 方法：获取所有源配置
export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    // 获取配置进行权限校验
    const adminConfig = await getConfig();
    
    // 权限校验
    if (username !== process.env.USERNAME) {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!userEntry || userEntry.role !== 'admin') {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    if (storageType === 'localstorage') {
        // 本地存储模式从文件配置读取
        const sites = await getAvailableApiSites();
        return NextResponse.json({ sources: sites });
      }

    const storage = getStorage();
    if (!storage || typeof storage.getAllSourceConfigs !== 'function') {
      return NextResponse.json(
        { error: '当前存储不支持源配置管理' },
        { status: 400 }
      );
    }

    // 获取所有源配置
    const allConfigs = await storage.getAllSourceConfigs();
    
    return NextResponse.json(
      { sources: allConfigs },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('获取源配置失败:', error);
    return NextResponse.json(
      {
        error: '获取源配置失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

interface BaseBody {
  action?: Action;
}

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
    const body = (await request.json()) as BaseBody & Record<string, any>;
    const { action } = body;

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    // 基础校验
    const ACTIONS: Action[] = ['add', 'disable', 'enable', 'delete', 'sort'];
    if (!username || !action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    // 获取配置与存储
    const adminConfig = await getConfig();
    const storage: IStorage | null = getStorage();

    // 检查存储是否支持 SourceConfig 操作
    if (!storage || typeof storage.getAllSourceConfigs !== 'function') {
      return NextResponse.json(
        { error: '当前存储不支持源配置管理' },
        { status: 400 }
      );
    }

    // 权限与身份校验
    if (username !== process.env.USERNAME) {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!userEntry || userEntry.role !== 'admin') {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    switch (action) {
      case 'add': {
        const { key, name, api, detail, is_adult } = body as {
          key?: string;
          name?: string;
          api?: string;
          detail?: string;
          is_adult?: boolean;
        };
        if (!key || !name || !api) {
          return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
        }
        
        // 检查源是否已存在
        const existingConfig = await storage.getSourceConfig(key);
        if (existingConfig) {
          return NextResponse.json({ error: '该源已存在' }, { status: 400 });
        }
        
        // 添加新的源配置
        await storage.addSourceConfig({
          source_key: key,
          name,
          api,
          detail: detail || '',
          from_type: 'custom',
          disabled: false,
          is_adult: is_adult || false,
          sort_order: 0
        });
        break;
      }
      case 'disable': {
        const { key } = body as { key?: string };
        if (!key)
          return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
        
        // 检查源是否存在
        const existingConfig = await storage.getSourceConfig(key);
        if (!existingConfig)
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        
        // 禁用源
        await storage.disableSourceConfig(key);
        break;
      }
      case 'enable': {
        const { key } = body as { key?: string };
        if (!key)
          return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
        
        // 检查源是否存在
        const existingConfig = await storage.getSourceConfig(key);
        if (!existingConfig)
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        
        // 启用源
        await storage.enableSourceConfig(key);
        break;
      }
      case 'delete': {
        const { key } = body as { key?: string };
        if (!key)
          return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
        
        // 检查源是否存在
        const existingConfig = await storage.getSourceConfig(key);
        if (!existingConfig)
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        
        // 检查是否可以删除（来自配置文件的源不可删除）
        if (existingConfig.from_type === 'config') {
          return NextResponse.json({ error: '该源不可删除' }, { status: 400 });
        }
        
        // 删除源
        await storage.deleteSourceConfig(key);
        break;
      }
      case 'sort': {
        const { order } = body as { order?: string[] };
        if (!Array.isArray(order)) {
          return NextResponse.json(
            { error: '排序列表格式错误' },
            { status: 400 }
          );
        }
        
        // 重新排序源配置
        await storage.reorderSourceConfigs(order);
        break;
      }
      default:
        return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }

    // 数据库操作已经自动持久化，无需额外保存

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('视频源管理操作失败:', error);
    return NextResponse.json(
      {
        error: '视频源管理操作失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
