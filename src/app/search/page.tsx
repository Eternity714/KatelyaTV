/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */
'use client';

import { ChevronUp, Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';

import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

function SearchPageClient() {
  // 搜索历史
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  // 返回顶部按钮显示状态
  const [showBackToTop, setShowBackToTop] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  
  // 分组结果状态
  const [groupedResults, setGroupedResults] = useState<{
    regular: SearchResult[];
    adult: SearchResult[];
  } | null>(null);
  
  // 分组标签页状态
  const [activeTab, setActiveTab] = useState<'regular' | 'adult'>('regular');

  // 获取默认聚合设置：只读取用户本地设置，默认为 true
  const getDefaultAggregate = () => {
    if (typeof window !== 'undefined') {
      const userSetting = localStorage.getItem('defaultAggregateSearch');
      if (userSetting !== null) {
        return JSON.parse(userSetting);
      }
    }
    return true; // 默认启用聚合
  };

  const [viewMode, setViewMode] = useState<'agg' | 'all'>(() => {
    return getDefaultAggregate() ? 'agg' : 'all';
  });

  // 聚合函数
  const aggregateResults = (results: SearchResult[]) => {
    const map = new Map<string, SearchResult[]>();
    results.forEach((item) => {
      // 使用 title + year + type 作为键
      const key = `${item.title.replaceAll(' ', '')}-${
        item.year || 'unknown'
      }-${item.episodes.length === 1 ? 'movie' : 'tv'}`;
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    });
    return Array.from(map.entries()).sort((a, b) => {
      // 优先排序：标题与搜索词完全一致的排在前面
      const aExactMatch = a[1][0].title
        .replaceAll(' ', '')
        .includes(searchQuery.trim().replaceAll(' ', ''));
      const bExactMatch = b[1][0].title
        .replaceAll(' ', '')
        .includes(searchQuery.trim().replaceAll(' ', ''));

      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      // 年份排序
      if (a[1][0].year === b[1][0].year) {
        return a[0].localeCompare(b[0]);
      } else {
        const aYear = a[1][0].year;
        const bYear = b[1][0].year;

        if (aYear === 'unknown' && bYear === 'unknown') {
          return 0;
        } else if (aYear === 'unknown') {
          return 1;
        } else if (bYear === 'unknown') {
          return -1;
        } else {
          return aYear > bYear ? -1 : 1;
        }
      }
    });
  };

  useEffect(() => {
    // 无搜索参数时聚焦搜索框
    !searchParams.get('q') && document.getElementById('searchInput')?.focus();

    // 初始加载搜索历史
    getSearchHistory().then(setSearchHistory);

    // 监听搜索历史更新事件
    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (newHistory: string[]) => {
        setSearchHistory(newHistory);
      }
    );

    // 获取滚动位置的函数 - 专门针对 body 滚动
    const getScrollTop = () => {
      return document.body.scrollTop || 0;
    };

    // 使用 requestAnimationFrame 持续检测滚动位置
    let isRunning = false;
    const checkScrollPosition = () => {
      if (!isRunning) return;

      const scrollTop = getScrollTop();
      const shouldShow = scrollTop > 300;
      setShowBackToTop(shouldShow);

      requestAnimationFrame(checkScrollPosition);
    };

    // 启动持续检测
    isRunning = true;
    checkScrollPosition();

    // 监听 body 元素的滚动事件
    const handleScroll = () => {
      const scrollTop = getScrollTop();
      setShowBackToTop(scrollTop > 300);
    };

    document.body.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      unsubscribe();
      isRunning = false; // 停止 requestAnimationFrame 循环

      // 移除 body 滚动事件监听器
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    // 当搜索参数变化时更新搜索状态
    const query = searchParams.get('q');
    if (query) {
      setSearchQuery(query);
      fetchSearchResults(query);

      // 保存到搜索历史 (事件监听会自动更新界面)
      addSearchHistory(query);
    } else {
      setShowResults(false);
    }
  }, [searchParams]);

  const fetchSearchResults = async (query: string) => {
    try {
      setIsLoading(true);
      
      // 获取用户认证信息
      const authInfo = getAuthInfoFromBrowserCookie();
      
      // 构建请求头
      const headers: HeadersInit = {};
      if (authInfo?.username) {
        headers['Authorization'] = `Bearer ${authInfo.username}`;
      }
      
      // 简化的搜索请求 - 成人内容过滤现在在API层面自动处理
      // 添加时间戳参数避免缓存问题
      const timestamp = Date.now();
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query.trim())}&t=${timestamp}`, 
        { 
          headers: {
            ...headers,
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }
        }
      );
      const data = await response.json();
      
      // 处理新的搜索结果格式
      if (data.regular_results || data.adult_results) {
        // 处理分组结果
        setGroupedResults({
          regular: data.regular_results || [],
          adult: data.adult_results || []
        });
        setSearchResults([...(data.regular_results || []), ...(data.adult_results || [])]);
      } else if (data.grouped) {
        // 兼容旧的分组格式
        setGroupedResults({
          regular: data.regular || [],
          adult: data.adult || []
        });
        setSearchResults([...(data.regular || []), ...(data.adult || [])]);
      } else {
        // 兼容旧的普通结果格式
        setGroupedResults(null);
        setSearchResults(data.results || []);
      }
      
      setShowResults(true);
    } catch (error) {
      setGroupedResults(null);
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;

    // 回显搜索框
    setSearchQuery(trimmed);
    setIsLoading(true);
    setShowResults(true);

    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    // 直接发请求
    fetchSearchResults(trimmed);

    // 保存到搜索历史 (事件监听会自动更新界面)
    addSearchHistory(trimmed);
  };

  // 返回顶部功能
  const scrollToTop = () => {
    try {
      // 根据调试结果，真正的滚动容器是 document.body
      document.body.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } catch (error) {
      // 如果平滑滚动完全失败，使用立即滚动
      document.body.scrollTop = 0;
    }
  };

  return (
    <PageLayout activePath='/search'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10'>
        {/* 搜索框 */}
        <div className='mb-8'>
          <form onSubmit={handleSearch} className='max-w-2xl mx-auto'>
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500' />
              <input
                id='searchInput'
                type='text'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='搜索电影、电视剧...'
                className='w-full h-12 rounded-lg bg-gray-50/80 py-3 pl-10 pr-4 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:bg-white border border-gray-200/50 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 dark:border-gray-700'
              />
            </div>
          </form>
        </div>

        {/* 搜索结果或搜索历史 */}
        <div className='max-w-[95%] mx-auto mt-12 overflow-visible'>
          {isLoading ? (
            <div className='flex justify-center items-center h-40'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
            </div>
          ) : showResults ? (
            <section className='mb-12'>
              {/* 标题 + 聚合开关 */}
              <div className='mb-8 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                  搜索结果
                </h2>
                {/* 聚合开关 */}
                <label className='flex items-center gap-2 cursor-pointer select-none'>
                  <span className='text-sm text-gray-700 dark:text-gray-300'>
                    聚合
                  </span>
                  <div className='relative'>
                    <input
                      type='checkbox'
                      className='sr-only peer'
                      checked={viewMode === 'agg'}
                      onChange={() =>
                        setViewMode(viewMode === 'agg' ? 'all' : 'agg')
                      }
                    />
                    <div className='w-9 h-5 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                    <div className='absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4'></div>
                  </div>
                </label>
              </div>
              
              {/* 如果有分组结果且有成人内容，显示分组标签 */}
              {groupedResults && groupedResults.adult.length > 0 && (
                <div className="mb-6">
                  <div className="flex items-center justify-center mb-4">
                    <div className="inline-flex p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
                      <button
                        onClick={() => setActiveTab('regular')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                          activeTab === 'regular'
                            ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                        }`}
                      >
                        常规结果 ({groupedResults.regular.length})
                      </button>
                      <button
                        onClick={() => setActiveTab('adult')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                          activeTab === 'adult'
                            ? 'bg-white dark:bg-gray-700 text-red-600 dark:text-red-400 shadow-sm'
                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                        }`}
                      >
                        成人内容 ({groupedResults.adult.length})
                      </button>
                    </div>
                  </div>
                  {activeTab === 'adult' && (
                    <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                      <p className="text-sm text-red-600 dark:text-red-400 text-center">
                        ⚠️ 以下内容可能包含成人资源，请确保您已年满18周岁
                      </p>
                    </div>
                  )}
                </div>
              )}
              <div
                key={`search-results-${viewMode}-${activeTab}`}
                className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'
              >
                {(() => {
                  // 确定要显示的结果
                  let displayResults = searchResults;
                  if (groupedResults && groupedResults.adult.length > 0) {
                    displayResults = activeTab === 'adult' 
                      ? groupedResults.adult 
                      : groupedResults.regular;
                  }

                  // 聚合显示模式
                  if (viewMode === 'agg') {
                    const aggregated = aggregateResults(displayResults);
                    return aggregated.map(([mapKey, group]: [string, SearchResult[]]) => (
                      <div key={`agg-${mapKey}`} className='w-full'>
                        <VideoCard
                          from='search'
                          items={group}
                          query={
                            searchQuery.trim() !== group[0].title
                              ? searchQuery.trim()
                              : ''
                          }
                        />
                      </div>
                    ));
                  }

                  // 列表显示模式
                  return displayResults.map((item) => (
                    <div
                      key={`all-${item.source}-${item.id}`}
                      className='w-full'
                    >
                      <VideoCard
                        id={item.id}
                        title={item.title}
                        poster={item.poster}
                        episodes={item.episodes.length}
                        source={item.source}
                        source_name={item.source_name}
                        douban_id={item.douban_id?.toString()}
                        query={
                          searchQuery.trim() !== item.title
                            ? searchQuery.trim()
                            : ''
                        }
                        year={item.year}
                        from='search'
                        type={item.episodes.length > 1 ? 'tv' : 'movie'}
                      />
                    </div>
                  ));
                })()}
                {searchResults.length === 0 && (
                  <div className='col-span-full text-center text-gray-500 py-8 dark:text-gray-400'>
                    未找到相关结果
                  </div>
                )}
              </div>
            </section>
          ) : searchHistory.length > 0 ? (
            // 搜索历史
            <section className='mb-12'>
              <h2 className='mb-4 text-xl font-bold text-gray-800 text-left dark:text-gray-200'>
                搜索历史
                {searchHistory.length > 0 && (
                  <button
                    onClick={() => {
                      clearSearchHistory(); // 事件监听会自动更新界面
                    }}
                    className='ml-3 text-sm text-gray-500 hover:text-red-500 transition-colors dark:text-gray-400 dark:hover:text-red-500'
                  >
                    清空
                  </button>
                )}
              </h2>
              <div className='flex flex-wrap gap-2'>
                {searchHistory.map((item) => (
                  <div key={item} className='relative group'>
                    <button
                      onClick={() => {
                        setSearchQuery(item);
                        router.push(
                          `/search?q=${encodeURIComponent(item.trim())}`
                        );
                      }}
                      className='px-4 py-2 bg-gray-500/10 hover:bg-gray-300 rounded-full text-sm text-gray-700 transition-colors duration-200 dark:bg-gray-700/50 dark:hover:bg-gray-600 dark:text-gray-300'
                    >
                      {item}
                    </button>
                    {/* 删除按钮 */}
                    <button
                      aria-label='删除搜索历史'
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        deleteSearchHistory(item); // 事件监听会自动更新界面
                      }}
                      className='absolute -top-1 -right-1 w-4 h-4 opacity-0 group-hover:opacity-100 bg-gray-400 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] transition-colors'
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {/* 返回顶部悬浮按钮 */}
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
    </PageLayout>
  );
}

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

// 搜索结果缓存
const searchCache = new Map<string, { results: SearchResult[]; timestamp: number; searchTime: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

export default function SearchPage() {
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
  
  // 防抖搜索查询
  const debouncedQuery = useDebounce(query, 300);
  
  // 搜索输入框引用
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  // 取消搜索的引用
  const abortControllerRef = useRef<AbortController | null>(null);

  // 加载搜索历史
  useEffect(() => {
    const loadHistory = async () => {
      if (user) {
        try {
          const history = await getSearchHistory(user.username);
          setSearchHistory(history);
        } catch (error) {
          console.error('加载搜索历史失败:', error);
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
          await addSearchHistory(user.username, searchQuery);
          // 重新加载搜索历史
          const updatedHistory = await getSearchHistory(user.username);
          setSearchHistory(updatedHistory);
        } catch (error) {
          console.error('添加搜索历史失败:', error);
        }
      }

    } catch (error: any) {
      if (error.name === 'AbortError') {
        // 搜索被取消，不显示错误
        return;
      }
      
      console.error('搜索失败:', error);
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
                  <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                    <Clock className="w-4 h-4 mr-2" />
                    最近搜索
                  </div>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {searchHistory.slice(0, 10).map((historyItem, index) => (
                    <button
                      key={index}
                      onClick={() => handleHistoryClick(historyItem)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 
                               text-gray-700 dark:text-gray-300 transition-colors duration-150"
                    >
                      <div className="flex items-center">
                        <TrendingUp className="w-4 h-4 mr-3 text-gray-400" />
                        {historyItem}
                      </div>
                    </button>
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
                          <img
                            src={result.poster}
                            alt={result.title}
                            className="w-full h-full object-cover"
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
    </div>
  );
}

// ... existing code ...
