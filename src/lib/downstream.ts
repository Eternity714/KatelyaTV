import { API_CONFIG, ApiSite, getConfig } from '@/lib/config';
import { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';

interface ApiSearchItem {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_remarks?: string;
  vod_play_url?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
}

// 优化的搜索配置
const SEARCH_CONFIG = {
  TIMEOUT: 6000, // 减少超时时间到6秒
  MAX_PAGES: 2, // 减少最大页数到2页，提高响应速度
  RETRY_ATTEMPTS: 1, // 添加重试机制
  CONCURRENT_REQUESTS: 3, // 并发请求限制
};

// 带重试的fetch函数
async function fetchWithRetry(url: string, options: RequestInit, retries: number = SEARCH_CONFIG.RETRY_ATTEMPTS): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SEARCH_CONFIG.TIMEOUT);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return response;
      }
      
      // 如果是最后一次尝试，抛出错误
      if (i === retries) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      // 如果是最后一次尝试，抛出错误
      if (i === retries) {
        throw error;
      }
      
      // 等待一段时间后重试
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  
  throw new Error('所有重试都失败了');
}

export async function searchFromApi(
  apiSite: ApiSite,
  query: string,
  includeAdult: boolean = false
): Promise<SearchResult[]> {
  try {
    const apiBaseUrl = apiSite.api;
    const apiUrl = apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);
    const apiName = apiSite.name;

    // 优化：根据查询长度决定搜索页数，长查询通常结果更精确
    const config = await getConfig();
    const configMaxPages = config.SiteConfig.SearchDownstreamMaxPage;
    const maxPages = query.length > 10 ? Math.min(2, configMaxPages) : Math.min(3, configMaxPages);

    // 第一页搜索 - 使用优化的fetch函数
    const response = await fetchWithRetry(apiUrl, {
      headers: API_CONFIG.search.headers,
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    if (!data || !data.list || !Array.isArray(data.list) || data.list.length === 0) {
      return [];
    }

    // 处理第一页结果
    const results = data.list
      .filter((item: ApiSearchItem) => {
        // 成人内容过滤
        if (!includeAdult && isAdultContent(item)) {
          return false;
        }
        return true;
      })
      .map((item: ApiSearchItem) => {
        let episodes: string[] = [];

        // 使用正则表达式从 vod_play_url 提取 m3u8 链接
        if (item.vod_play_url) {
          const m3u8Regex = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
          // 先用 $$$ 分割
          const vod_play_url_array = item.vod_play_url.split('$$$');
          // 对每个分片做匹配，取匹配到最多的作为结果
          vod_play_url_array.forEach((url: string) => {
            const matches = url.match(m3u8Regex) || [];
            if (matches.length > episodes.length) {
              episodes = matches;
            }
          });
        }

        episodes = Array.from(new Set(episodes)).map((link: string) => {
          link = link.substring(1); // 去掉开头的 $
          const parenIndex = link.indexOf('(');
          return parenIndex > 0 ? link.substring(0, parenIndex) : link;
        });

        return {
          id: item.vod_id.toString(),
          title: item.vod_name.trim().replace(/\s+/g, ' '),
          poster: item.vod_pic,
          episodes,
          source: apiSite.key,
          source_name: apiName,
          class: item.vod_class,
          year: item.vod_year ? item.vod_year.match(/\d{4}/)?.[0] || '' : 'unknown',
          desc: cleanHtmlTags(item.vod_content || ''),
          type_name: item.type_name,
          douban_id: item.vod_douban_id,
        };
      });

    // 如果第一页没有结果或只需要一页，直接返回
    if (results.length === 0 || maxPages === 1) {
      return results;
    }

    // 获取总页数
    const pageCount = data.pagecount || 1;
    // 确定需要获取的额外页数
    const pagesToFetch = Math.min(pageCount - 1, maxPages - 1);

    // 如果有额外页数，获取更多页的结果
    if (pagesToFetch > 0) {
      const additionalPagePromises = [];

      for (let page = 2; page <= pagesToFetch + 1; page++) {
        const pageUrl = apiBaseUrl + API_CONFIG.search.pagePath
          .replace('{query}', encodeURIComponent(query))
          .replace('{page}', page.toString());

        const pagePromise = fetchWithRetry(pageUrl, {
          headers: API_CONFIG.search.headers,
        })
          .then(async (pageResponse) => {
            if (!pageResponse.ok) return [];

            const pageData = await pageResponse.json();
            if (!pageData || !pageData.list || !Array.isArray(pageData.list)) return [];

            return pageData.list
              .filter((item: ApiSearchItem) => {
                // 成人内容过滤
                if (!includeAdult && isAdultContent(item)) {
                  return false;
                }
                return true;
              })
              .map((item: ApiSearchItem) => {
                let episodes: string[] = [];

                // 使用正则表达式从 vod_play_url 提取 m3u8 链接
                if (item.vod_play_url) {
                  const m3u8Regex = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
                  episodes = item.vod_play_url.match(m3u8Regex) || [];
                }

                episodes = Array.from(new Set(episodes)).map((link: string) => {
                  link = link.substring(1); // 去掉开头的 $
                  const parenIndex = link.indexOf('(');
                  return parenIndex > 0 ? link.substring(0, parenIndex) : link;
                });

                return {
                  id: item.vod_id.toString(),
                  title: item.vod_name.trim().replace(/\s+/g, ' '),
                  poster: item.vod_pic,
                  episodes,
                  source: apiSite.key,
                  source_name: apiName,
                  class: item.vod_class,
                  year: item.vod_year ? item.vod_year.match(/\d{4}/)?.[0] || '' : 'unknown',
                  desc: cleanHtmlTags(item.vod_content || ''),
                  type_name: item.type_name,
                  douban_id: item.vod_douban_id,
                };
              });
          })
          .catch((error) => {
            console.error(`第${page}页搜索失败 ${apiName}:`, error);
            return []; // 返回空数组而不是抛出错误
          });

        additionalPagePromises.push(pagePromise);
      }

      // 等待所有额外页的结果
      try {
        const additionalResults = await Promise.all(additionalPagePromises);

        // 合并所有页的结果
        additionalResults.forEach((pageResults) => {
          if (pageResults.length > 0) {
            results.push(...pageResults);
          }
        });
      } catch (error) {
        console.error(`额外页面搜索失败 ${apiName}:`, error);
        // 即使额外页面失败，也返回第一页的结果
      }
    }

    return results;
  } catch (error) {
    console.error(`搜索API失败 ${apiName}:`, error);
    return [];
  }
}

// 成人内容检测函数
function isAdultContent(item: ApiSearchItem): boolean {
  const adultKeywords = ['成人', '情色', '三级', '限制级', 'R级', '18+', '成人版', '伦理'];
  const title = (item.vod_name || '').toLowerCase();
  const content = (item.vod_content || '').toLowerCase();
  const typeName = (item.type_name || '').toLowerCase();
  
  return adultKeywords.some(keyword => 
    title.includes(keyword) || 
    content.includes(keyword) || 
    typeName.includes(keyword)
  );
}

// 匹配 m3u8 链接的正则
const M3U8_PATTERN = /(https?:\/\/[^"'\s]+?\.m3u8)/g;

export async function getDetailFromApi(
  apiSite: ApiSite,
  id: string
): Promise<SearchResult> {
  if (apiSite.detail) {
    return handleSpecialSourceDetail(id, apiSite);
  }

  const detailUrl = `${apiSite.api}${API_CONFIG.detail.path}${id}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const response = await fetch(detailUrl, {
    headers: API_CONFIG.detail.headers,
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`详情请求失败: ${response.status}`);
  }

  const data = await response.json();

  if (
    !data ||
    !data.list ||
    !Array.isArray(data.list) ||
    data.list.length === 0
  ) {
    throw new Error('获取到的详情内容无效');
  }

  const videoDetail = data.list[0];
  let episodes: string[] = [];

  // 处理播放源拆分
  if (videoDetail.vod_play_url) {
    const playSources = videoDetail.vod_play_url.split('$$$');
    if (playSources.length > 0) {
      const mainSource = playSources[0];
      const episodeList = mainSource.split('#');
      episodes = episodeList
        .map((ep: string) => {
          const parts = ep.split('$');
          return parts.length > 1 ? parts[1] : '';
        })
        .filter(
          (url: string) =>
            url && (url.startsWith('http://') || url.startsWith('https://'))
        );
    }
  }

  // 如果播放源为空，则尝试从内容中解析 m3u8
  if (episodes.length === 0 && videoDetail.vod_content) {
    const matches = videoDetail.vod_content.match(M3U8_PATTERN) || [];
    episodes = matches.map((link: string) => link.replace(/^\$/, ''));
  }

  return {
    id: id.toString(),
    title: videoDetail.vod_name,
    poster: videoDetail.vod_pic,
    episodes,
    source: apiSite.key,
    source_name: apiSite.name,
    class: videoDetail.vod_class,
    year: videoDetail.vod_year
      ? videoDetail.vod_year.match(/\d{4}/)?.[0] || ''
      : 'unknown',
    desc: cleanHtmlTags(videoDetail.vod_content),
    type_name: videoDetail.type_name,
    douban_id: videoDetail.vod_douban_id,
  };
}

async function handleSpecialSourceDetail(
  id: string,
  apiSite: ApiSite
): Promise<SearchResult> {
  const detailUrl = `${apiSite.detail}/index.php/vod/detail/id/${id}.html`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const response = await fetch(detailUrl, {
    headers: API_CONFIG.detail.headers,
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`详情页请求失败: ${response.status}`);
  }

  const html = await response.text();
  let matches: string[] = [];

  if (apiSite.key === 'ffzy') {
    const ffzyPattern =
      /\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g;
    matches = html.match(ffzyPattern) || [];
  }

  if (matches.length === 0) {
    const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
    matches = html.match(generalPattern) || [];
  }

  // 去重并清理链接前缀
  matches = Array.from(new Set(matches)).map((link: string) => {
    link = link.substring(1); // 去掉开头的 $
    const parenIndex = link.indexOf('(');
    return parenIndex > 0 ? link.substring(0, parenIndex) : link;
  });

  // 提取标题
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const titleText = titleMatch ? titleMatch[1].trim() : '';

  // 提取描述
  const descMatch = html.match(
    /<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/
  );
  const descText = descMatch ? cleanHtmlTags(descMatch[1]) : '';

  // 提取封面
  const coverMatch = html.match(/(https?:\/\/[^"'\s]+?\.jpg)/g);
  const coverUrl = coverMatch ? coverMatch[0].trim() : '';

  // 提取年份
  const yearMatch = html.match(/>(\d{4})</);
  const yearText = yearMatch ? yearMatch[1] : 'unknown';

  return {
    id,
    title: titleText,
    poster: coverUrl,
    episodes: matches,
    source: apiSite.key,
    source_name: apiSite.name,
    class: '',
    year: yearText,
    desc: descText,
    type_name: '',
    douban_id: 0,
  };
}
