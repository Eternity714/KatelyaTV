import { NextRequest, NextResponse } from 'next/server';

import { getFilteredApiSites } from '@/lib/config';
import { handleOptionsRequest } from '@/lib/cors';
import { searchFromApi } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';

export const runtime = 'edge';

// 处理OPTIONS预检请求（OrionTV客户端需要）
export async function OPTIONS() {
  return handleOptionsRequest();
}

// 搜索结果缓存 - 使用 Map 实现内存缓存
const searchCache = new Map<string, { results: SearchResult[]; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存
const MAX_CACHE_SIZE = 1000; // 最大缓存条目数

// 清理过期缓存
function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      searchCache.delete(key);
    }
  }
}

// 获取缓存键
function getCacheKey(query: string, userName?: string, includeAdult?: boolean): string {
  return `${query}:${userName || 'anonymous'}:${includeAdult || false}`;
}

// 限制并发请求数量
async function searchWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit = 3
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const promise = task().then(result => {
      results.push(result);
    }).catch(() => {
      // 静默处理搜索任务失败，返回空结果而不是抛出错误
      results.push([] as unknown as T);
    });

    executing.push(promise);

    if (executing.length >= limit) {
      await Promise.race(executing);
      // 移除已完成的 promise
      const completedIndex = executing.findIndex(p => 
        p === promise || results.length > executing.length - limit
      );
      if (completedIndex !== -1) {
        executing.splice(completedIndex, 1);
      }
    }
  }

  await Promise.all(executing);
  return results;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    
    if (!query) {
      return NextResponse.json({ 
        regular_results: [], 
        adult_results: [],
        cached: false,
        search_time: 0
      });
    }

    // 获取用户信息
    const authHeader = request.headers.get('Authorization');
    const userName = authHeader?.replace('Bearer ', '') || searchParams.get('userName');
    const includeAdult = searchParams.get('include_adult') === 'true';

    // 检查缓存
    const cacheKey = getCacheKey(query, userName, includeAdult);
    const cached = searchCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return NextResponse.json({
        regular_results: cached.results,
        adult_results: [],
        cached: true,
        search_time: 0
      }, {
        headers: {
          'Cache-Control': 'public, max-age=300', // 5分钟浏览器缓存
        },
      });
    }

    const startTime = Date.now();

    // 获取可用的API站点
    const apiSites = await getFilteredApiSites(userName);
    
    if (apiSites.length === 0) {
      return NextResponse.json({ 
        regular_results: [], 
        adult_results: [],
        cached: false,
        search_time: Date.now() - startTime
      });
    }

    // 创建搜索任务
    const searchTasks = apiSites.map(site => 
      () => searchFromApi(site, query, includeAdult)
    );

    // 使用并发限制执行搜索
    const searchResults = await searchWithConcurrencyLimit(searchTasks, 3);

    // 合并所有搜索结果
    const allResults: SearchResult[] = [];
    for (const results of searchResults) {
      if (Array.isArray(results)) {
        allResults.push(...results);
      }
    }

    const searchTime = Date.now() - startTime;

    // 缓存结果
    if (allResults.length > 0) {
      // 清理过期缓存
      if (searchCache.size > MAX_CACHE_SIZE) {
        cleanExpiredCache();
      }
      
      // 如果缓存仍然太大，删除最旧的条目
      if (searchCache.size > MAX_CACHE_SIZE) {
        const oldestKey = searchCache.keys().next().value;
        if (oldestKey) {
          searchCache.delete(oldestKey);
        }
      }

      searchCache.set(cacheKey, {
        results: allResults,
        timestamp: Date.now()
      });
    }

    return NextResponse.json({
      regular_results: allResults,
      adult_results: [], // 成人内容已在源头过滤
      cached: false,
      search_time: searchTime
    }, {
      headers: {
        'Cache-Control': 'public, max-age=300', // 5分钟浏览器缓存
      },
    });

  } catch {
    // 静默处理搜索失败
    return NextResponse.json({
      regular_results: [],
      adult_results: [],
      cached: false,
      search_time: 0,
      error: '搜索服务暂时不可用'
    }, { status: 500 });
  }
}
