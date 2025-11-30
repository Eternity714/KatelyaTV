/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */
'use client';

import { ChevronUp, Clock, Loader2, Search, TrendingUp, X } from 'lucide-react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';

import PageLayout from '@/components/PageLayout';

// 防抖Hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// 搜索缓存
const searchCache = new Map<string, { results: SearchResult[]; timestamp: number; searchTime: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

// 简单的 useAuth hook 实现
function useAuth() {
  const [user, setUser] = useState<{ username: string } | null>(null);

  useEffect(() => {
    const authInfo = getAuthInfoFromBrowserCookie();
    if (authInfo && authInfo.username) {
      setUser({ username: authInfo.username });
    }
  }, []);

  return { user };
}

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [searchTime, setSearchTime] = useState<number>(0);
  const [cached, setCached] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  
  // 防抖搜索查询
  const debouncedQuery = useDebounce(query, 300);
  
  // 搜索输入框引用
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  // 取消搜索的引用
  const abortControllerRef = useRef<AbortController | null>(null);

  // 监听滚动事件，显示/隐藏返回顶部按钮
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 300);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 加载搜索历史
  useEffect(() => {
    const loadHistory = async () => {
      if (user) {
        try {
          const history = await getSearchHistory();
          setSearchHistory(history);
        } catch (error) {
          // 静默处理错误
        }
      }
    };
    loadHistory();
  }, [user]);

  // 获取缓存键
  const getCacheKey = useCallback((searchQuery: string) => {
    return `${searchQuery}:${user?.username || 'anonymous'}`;
  }, [user]);

  // 清理过期缓存
  const cleanExpiredCache = useCallback(() => {
    const now = Date.now();
    for (const [key, value] of searchCache.entries()) {
      if (now - value.timestamp > CACHE_DURATION) {
        searchCache.delete(key);
      }
    }
  }, []);

  // 优化的搜索函数
  const fetchSearchResults = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setSearchTime(0);
      setCached(false);
      return;
    }

    // 取消之前的搜索请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // 检查缓存
    const cacheKey = getCacheKey(searchQuery);
    const cachedResult = searchCache.get(cacheKey);
    
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_DURATION) {
      setResults(cachedResult.results);
      setSearchTime(cachedResult.searchTime);
      setCached(true);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setCached(false);

    // 创建新的取消控制器
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const startTime = Date.now();
      
      // 构建搜索URL
      const searchUrl = new URL('/api/search', window.location.origin);
      searchUrl.searchParams.set('q', searchQuery);
      if (user) {
        searchUrl.searchParams.set('userName', user.username);
      }

      const response = await fetch(searchUrl.toString(), {
        headers: user ? { 'Authorization': `Bearer ${user.username}` } : {},
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`搜索请求失败: ${response.status}`);
      }

      const data = await response.json();
      const endTime = Date.now();
      const requestTime = endTime - startTime;

      // 处理搜索结果
      const searchResults = data.regular_results || [];
      const serverSearchTime = data.search_time || requestTime;
      const isFromCache = data.cached || false;

      setResults(searchResults);
      setSearchTime(serverSearchTime);
      setCached(isFromCache);

      // 缓存结果（只缓存非空结果）
      if (searchResults.length > 0) {
        // 清理过期缓存
        cleanExpiredCache();
        
        // 缓存新结果
        searchCache.set(cacheKey, {
          results: searchResults,
          timestamp: Date.now(),
          searchTime: serverSearchTime
        });
      }

      // 添加到搜索历史
      if (user && searchResults.length > 0) {
        try {
          await addSearchHistory(searchQuery);
          // 重新加载搜索历史
          const updatedHistory = await getSearchHistory();
          setSearchHistory(updatedHistory);
        } catch (error) {
          // 静默处理错误
        }
      }

    } catch (error: any) {
      if (error.name === 'AbortError') {
        // 搜索被取消，不显示错误
        return;
      }
      
      setError(error.message || '搜索失败，请稍后重试');
      setResults([]);
      setSearchTime(0);
      setCached(false);
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  }, [user, getCacheKey, cleanExpiredCache]);

  // 当防抖查询变化时执行搜索
  useEffect(() => {
    if (debouncedQuery) {
      fetchSearchResults(debouncedQuery);
    } else {
      setResults([]);
      setSearchTime(0);
      setCached(false);
    }
  }, [debouncedQuery, fetchSearchResults]);

  // 处理搜索表单提交
  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      // 立即搜索，不等待防抖
      fetchSearchResults(query.trim());
      setShowHistory(false);
      
      // 更新URL
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.set('q', query.trim());
      router.push(`/search?${newSearchParams.toString()}`);
    }
  }, [query, fetchSearchResults, searchParams, router]);

  // 处理历史搜索点击
  const handleHistoryClick = useCallback((historyQuery: string) => {
    setQuery(historyQuery);
    setShowHistory(false);
    
    // 更新URL
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.set('q', historyQuery);
    router.push(`/search?${newSearchParams.toString()}`);
  }, [searchParams, router]);

  // 删除搜索历史项
  const handleDeleteHistory = useCallback(async (historyItem: string) => {
    if (user) {
      try {
        await deleteSearchHistory(historyItem);
        const updatedHistory = await getSearchHistory();
        setSearchHistory(updatedHistory);
      } catch (error) {
        // 静默处理错误
      }
    }
  }, [user]);

  // 清空搜索历史
  const handleClearHistory = useCallback(async () => {
    if (user) {
      try {
        await clearSearchHistory();
        setSearchHistory([]);
      } catch (error) {
        // 静默处理错误
      }
    }
  }, [user]);

  // 清除搜索
  const clearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setError(null);
    setSearchTime(0);
    setCached(false);
    setShowHistory(false);
    
    // 取消正在进行的搜索
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // 聚焦搜索框
    searchInputRef.current?.focus();
  }, []);

  // 返回顶部
  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // 结果分组逻辑
  const groupedResults = useMemo(() => {
    const groups: { [key: string]: SearchResult[] } = {};
    
    results.forEach(result => {
      const source = result.source_name || result.source || '未知来源';
      if (!groups[source]) {
        groups[source] = [];
      }
      groups[source].push(result);
    });
    
    return groups;
  }, [results]);

  // 搜索统计信息
  const searchStats = useMemo(() => {
    const totalResults = results.length;
    const sourceCount = Object.keys(groupedResults).length;
    
    return {
      totalResults,
      sourceCount,
      searchTime: searchTime > 0 ? `${searchTime}ms` : '',
      cached
    };
  }, [results.length, groupedResults, searchTime, cached]);

  return (
    <PageLayout activePath='/search'>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="container mx-auto px-4 py-8">
          {/* 搜索头部 */}
          <div className="max-w-4xl mx-auto mb-8">
            <div className="relative">
              {/* 搜索表单 */}
              <form onSubmit={handleSearch} className="relative">
                <div className="relative flex items-center">
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => setShowHistory(true)}
                    placeholder="搜索影视内容..."
                    className="w-full pl-12 pr-12 py-4 text-lg border border-gray-300 dark:border-gray-600 rounded-xl 
                             bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                             focus:ring-2 focus:ring-blue-500 focus:border-transparent
                             transition-all duration-200"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={clearSearch}
                      className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </form>

              {/* 搜索历史下拉 */}
              {showHistory && searchHistory.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10">
                  <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                        <Clock className="w-4 h-4 mr-2" />
                        最近搜索
                      </div>
                      <button
                        onClick={handleClearHistory}
                        className="text-sm text-red-500 hover:text-red-600"
                      >
                        清空
                      </button>
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {searchHistory.slice(0, 10).map((historyItem, index) => (
                      <div key={index} className="flex items-center group">
                        <button
                          onClick={() => handleHistoryClick(historyItem)}
                          className="flex-1 text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 
                                   text-gray-700 dark:text-gray-300 transition-colors duration-150"
                        >
                          <div className="flex items-center">
                            <TrendingUp className="w-4 h-4 mr-3 text-gray-400" />
                            {historyItem}
                          </div>
                        </button>
                        <button
                          onClick={() => handleDeleteHistory(historyItem)}
                          className="px-3 py-3 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 搜索状态和统计 */}
            {(loading || results.length > 0 || error) && (
              <div className="mt-4 flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
                <div className="flex items-center space-x-4">
                  {loading && (
                    <div className="flex items-center">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      搜索中...
                    </div>
                  )}
                  {!loading && results.length > 0 && (
                    <div className="flex items-center space-x-4">
                      <span>找到 {searchStats.totalResults} 个结果</span>
                      <span>来自 {searchStats.sourceCount} 个源</span>
                      {searchStats.searchTime && (
                        <span>用时 {searchStats.searchTime}</span>
                      )}
                      {searchStats.cached && (
                        <span className="text-green-600 dark:text-green-400">已缓存</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="max-w-4xl mx-auto mb-6">
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <div className="text-red-800 dark:text-red-200">
                  {error}
                </div>
              </div>
            </div>
          )}

          {/* 搜索结果 */}
          {!loading && results.length > 0 && (
            <div className="max-w-6xl mx-auto">
              {Object.entries(groupedResults).map(([source, sourceResults]) => (
                <div key={source} className="mb-8">
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                    <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-3 py-1 rounded-full text-sm mr-3">
                      {sourceResults.length}
                    </span>
                    {source}
                  </h2>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {sourceResults.map((result, index) => (
                      <div
                        key={`${result.source}-${result.id}-${index}`}
                        className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 overflow-hidden"
                      >
                        <div className="aspect-[3/4] relative">
                          {result.poster ? (
                            <Image
                              src={result.poster}
                              alt={result.title}
                              fill
                              className="object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                              <span className="text-gray-400 text-sm">暂无图片</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="p-4">
                          <h3 className="font-semibold text-gray-900 dark:text-white mb-2 line-clamp-2">
                            {result.title}
                          </h3>
                          
                          <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                            {result.year && (
                              <div>年份: {result.year}</div>
                            )}
                            {result.type_name && (
                              <div>类型: {result.type_name}</div>
                            )}
                            {result.episodes && result.episodes.length > 0 && (
                              <div>集数: {result.episodes.length}</div>
                            )}
                          </div>
                          
                          <button
                            onClick={() => router.push(`/play?source=${result.source}&id=${result.id}`)}
                            className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg 
                                     transition-colors duration-200 text-sm font-medium"
                          >
                            播放
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 空状态 */}
          {!loading && !error && query && results.length === 0 && (
            <div className="max-w-4xl mx-auto text-center py-12">
              <div className="text-gray-500 dark:text-gray-400">
                <Search className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium mb-2">未找到相关内容</h3>
                <p>尝试使用不同的关键词或检查拼写</p>
              </div>
            </div>
          )}

          {/* 初始状态 */}
          {!loading && !query && (
            <div className="max-w-4xl mx-auto text-center py-12">
              <div className="text-gray-500 dark:text-gray-400">
                <Search className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium mb-2">开始搜索</h3>
                <p>输入影视名称、演员或导演来搜索内容</p>
              </div>
            </div>
          )}
        </div>

        {/* 返回顶部按钮 */}
        <button
          onClick={scrollToTop}
          className={`fixed bottom-20 md:bottom-6 right-6 z-[500] w-12 h-12 bg-green-500/90 hover:bg-green-500 text-white rounded-full shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out flex items-center justify-center group ${
            showBackToTop
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
          aria-label='返回顶部'
        >
          <ChevronUp className='w-6 h-6 transition-transform group-hover:scale-110' />
        </button>
      </div>
    </PageLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-8 text-gray-500 dark:text-gray-400">加载中...</div>}>
      <SearchContent />
    </Suspense>
  );
}
