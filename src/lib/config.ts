/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion */

import { AdminConfig } from './admin.types';
import { getStorage } from './db';
import { SourceConfig } from './types';
import runtimeConfig from './runtime';

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

interface ConfigFileStruct {
  cache_time?: number;
  api_site: {
    [key: string]: ApiSite;
  };
}

export const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    pagePath: '?ac=videolist&wd={query}&pg={page}',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

// 在模块加载时根据环境决定配置来源
let fileConfig: ConfigFileStruct;
let cachedConfig: AdminConfig;

async function initConfig() {
  if (cachedConfig) {
    return;
  }

  if (process.env.DOCKER_ENV === 'true') {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const _require = eval('require') as NodeRequire;
    const fs = _require('fs') as typeof import('fs');
    const path = _require('path') as typeof import('path');

    const configPath = path.join(process.cwd(), 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(raw) as ConfigFileStruct;
    console.log('load dynamic config success');
  } else {
    // 默认使用编译时生成的配置
    fileConfig = runtimeConfig as unknown as ConfigFileStruct;
  }
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType !== 'localstorage') {
    // 数据库存储，读取并补全管理员配置
    const storage = getStorage();

    try {
      // 尝试从数据库获取管理员配置
      let adminConfig: AdminConfig | null = null;
      if (storage && typeof (storage as any).getAdminConfig === 'function') {
        adminConfig = await (storage as any).getAdminConfig();
      }

      // 获取所有用户名，用于补全 Users
      let userNames: string[] = [];
      if (storage && typeof (storage as any).getAllUsers === 'function') {
        try {
          userNames = await (storage as any).getAllUsers();
        } catch (e) {
          console.error('获取用户列表失败:', e);
        }
      }

      // 从文件中获取源信息，用于补全源
      const apiSiteEntries = Object.entries(fileConfig.api_site);

      if (adminConfig) {
        // SourceConfig 现在存储在独立的 source_configs 表中，不再在 AdminConfig 中处理

        const existedUsers = new Set(
          (adminConfig.UserConfig.Users || []).map((u) => u.username)
        );
        
        // 为新用户获取角色和到期时间信息
        for (const uname of userNames) {
          if (!existedUsers.has(uname)) {
            let userRole = 'user';
            let expiresAt: string | null = null;
            
            try {
              // 获取用户角色
              if (storage && typeof (storage as any).getUserRole === 'function') {
                const role = await (storage as any).getUserRole(uname);
                if (role) userRole = role;
              }
              
              // 获取用户到期时间
              if (storage && typeof (storage as any).getUserExpiryTime === 'function') {
                expiresAt = await (storage as any).getUserExpiryTime(uname);
              }
            } catch (e) {
              console.error(`获取用户 ${uname} 的角色和到期时间失败:`, e);
            }
            
            adminConfig!.UserConfig.Users.push({
              username: uname,
              role: userRole as 'user' | 'vip' | 'admin' | 'owner',
              expires_at: expiresAt,
            });
          }
        }
        // 站长
        const ownerUser = process.env.USERNAME;
        if (ownerUser) {
          adminConfig!.UserConfig.Users = adminConfig!.UserConfig.Users.filter(
            (u) => u.username !== ownerUser
          );
          adminConfig!.UserConfig.Users.unshift({
            username: ownerUser,
            role: 'owner',
            expires_at: null, // 站长用户永不过期
          });
        }
      } else {
        // 数据库中没有配置，创建新的管理员配置
        let allUsers = [];
        
        // 为所有用户获取角色和到期时间信息
        for (const uname of userNames) {
          let userRole = 'user';
          let expiresAt: string | null = null;
          
          try {
            // 获取用户角色
            if (storage && typeof (storage as any).getUserRole === 'function') {
              const role = await (storage as any).getUserRole(uname);
              if (role) userRole = role;
            }
            
            // 获取用户到期时间
            if (storage && typeof (storage as any).getUserExpiryTime === 'function') {
              expiresAt = await (storage as any).getUserExpiryTime(uname);
            }
          } catch (e) {
            console.error(`获取用户 ${uname} 的角色和到期时间失败:`, e);
          }
          
          allUsers.push({
            username: uname,
            role: userRole as 'user' | 'vip' | 'admin' | 'owner',
            expires_at: expiresAt,
          });
        }
        const ownerUser = process.env.USERNAME;
        if (ownerUser) {
          allUsers = allUsers.filter((u) => u.username !== ownerUser);
          allUsers.unshift({
            username: ownerUser,
            role: 'owner',
            expires_at: null, // 站长用户永不过期
          });
        }
        adminConfig = {
          SiteConfig: {
            SiteName: process.env.SITE_NAME || 'KatelyaTV',
            Announcement:
              process.env.ANNOUNCEMENT ||
              '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
            SearchDownstreamMaxPage:
              Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
            SiteInterfaceCacheTime: fileConfig.cache_time || 7200,
            ImageProxy: process.env.NEXT_PUBLIC_IMAGE_PROXY || '',
            DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
          },
          UserConfig: {
            AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
            Users: allUsers as any,
          },
          // SourceConfig 现在存储在独立的 source_configs 表中
        };
      }

      // 写回数据库（更新/创建）
      if (storage && typeof (storage as any).setAdminConfig === 'function') {
        await (storage as any).setAdminConfig(adminConfig);
      }

      // 更新缓存
      cachedConfig = adminConfig;
    } catch (err) {
      console.error('加载管理员配置失败:', err);
    }
  } else {
    // 本地存储直接使用文件配置
    cachedConfig = {
      SiteConfig: {
        SiteName: process.env.SITE_NAME || 'KatelyaTV',
        Announcement:
          process.env.ANNOUNCEMENT ||
          '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
        SearchDownstreamMaxPage:
          Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
        SiteInterfaceCacheTime: fileConfig.cache_time || 7200,
        ImageProxy: process.env.NEXT_PUBLIC_IMAGE_PROXY || '',
        DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
      },
      UserConfig: {
        AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
        Users: [],
      },
      // SourceConfig 现在存储在独立的 source_configs 表中（本地存储模式下从文件读取）
    } as AdminConfig;
  }
}

// 初始化 source_configs 表，将文件配置中的源同步到数据库
async function initSourceConfigs() {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    // 本地存储模式不需要初始化数据库表
    return;
  }

  const storage = getStorage();
  if (!storage || typeof storage.getAllSourceConfigs !== 'function') {
    console.warn('Storage does not support SourceConfig operations');
    return;
  }

  try {
    // 获取当前数据库中的所有源配置
    const existingConfigs = await storage.getAllSourceConfigs();
    const existingKeys = new Set(existingConfigs.map(config => config.source_key));

    // 获取文件配置中的源
    if (!fileConfig) {
      fileConfig = runtimeConfig as unknown as ConfigFileStruct;
    }
    const apiSiteEntries = Object.entries(fileConfig.api_site);

    // 添加文件中存在但数据库中不存在的源
    for (const [key, site] of apiSiteEntries) {
      if (!existingKeys.has(key)) {
        await storage.addSourceConfig({
          source_key: key,
          name: site.name,
          api: site.api,
          detail: site.detail || '',
          from_type: 'config',
          disabled: false,
          is_adult: (site as any).is_adult || false,
          sort_order: 0
        });
        console.log(`Added source config: ${key}`);
      }
    }

    // 更新现有源的 from_type 字段
    const apiSiteKeys = new Set(apiSiteEntries.map(([key]) => key));
    for (const config of existingConfigs) {
      if (!apiSiteKeys.has(config.source_key) && config.from_type !== 'custom') {
        // 文件中不存在的源标记为 custom
        await storage.updateSourceConfig(config.source_key, { from_type: 'custom' });
      } else if (apiSiteKeys.has(config.source_key) && config.from_type !== 'config') {
        // 文件中存在的源标记为 config
        await storage.updateSourceConfig(config.source_key, { from_type: 'config' });
        
        // 同时更新 is_adult 字段
        const siteConfig = fileConfig.api_site[config.source_key];
        if (siteConfig) {
          const isAdult = (siteConfig as any).is_adult || false;
          if (config.is_adult !== isAdult) {
            await storage.updateSourceConfig(config.source_key, { is_adult: isAdult });
          }
        }
      }
    }
  } catch (error) {
    console.error('Failed to initialize source configs:', error);
  }
}

export async function getConfig(): Promise<AdminConfig> {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (process.env.DOCKER_ENV === 'true' || storageType === 'localstorage') {
    await initConfig();
    // 初始化 source_configs 表
    await initSourceConfigs();
    return cachedConfig;
  }
  // 非 docker 环境且 DB 存储，直接读 db 配置
  const storage = getStorage();
  let adminConfig: AdminConfig | null = null;
  if (storage && typeof (storage as any).getAdminConfig === 'function') {
    adminConfig = await (storage as any).getAdminConfig();
  }
  if (adminConfig) {
    // 获取所有用户名，用于补全 Users
    let userNames: string[] = [];
    if (storage && typeof (storage as any).getAllUsers === 'function') {
      try {
        userNames = await (storage as any).getAllUsers();
      } catch (e) {
        console.error('获取用户列表失败:', e);
      }
    }

    // 合并用户列表 - 将数据库中的用户添加到配置中，并获取实际的角色和到期时间
    const existedUsers = new Set(
      (adminConfig.UserConfig.Users || []).map((u) => u.username)
    );
    
    // 为新用户获取角色和到期时间信息
    for (const uname of userNames) {
      if (!existedUsers.has(uname)) {
        let userRole = 'user';
        let expiresAt: string | null = null;
        
        try {
          // 获取用户角色
          if (storage && typeof (storage as any).getUserRole === 'function') {
            const role = await (storage as any).getUserRole(uname);
            if (role) userRole = role;
          }
          
          // 获取用户到期时间
          if (storage && typeof (storage as any).getUserExpiryTime === 'function') {
            expiresAt = await (storage as any).getUserExpiryTime(uname);
          }
        } catch (e) {
          console.error(`获取用户 ${uname} 的角色和到期时间失败:`, e);
        }
        
        adminConfig!.UserConfig.Users.push({
          username: uname,
          role: userRole as 'user' | 'vip' | 'admin' | 'owner',
          expires_at: expiresAt,
        });
      }
    }
    
    // 更新现有用户的角色和到期时间信息
    for (const user of adminConfig.UserConfig.Users) {
      if (user.username !== process.env.USERNAME) { // 跳过站长用户
        try {
          // 获取用户角色
          if (storage && typeof (storage as any).getUserRole === 'function') {
            const role = await (storage as any).getUserRole(user.username);
            if (role) user.role = role as 'user' | 'vip' | 'admin' | 'owner';
          }
          
          // 获取用户到期时间
          if (storage && typeof (storage as any).getUserExpiryTime === 'function') {
            user.expires_at = await (storage as any).getUserExpiryTime(user.username);
          }
        } catch (e) {
          console.error(`更新用户 ${user.username} 的角色和到期时间失败:`, e);
        }
      }
    }

    // 合并一些环境变量配置
    adminConfig.SiteConfig.SiteName = process.env.SITE_NAME || 'KatelyaTV';
    adminConfig.SiteConfig.Announcement =
      process.env.ANNOUNCEMENT ||
      '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。';
    adminConfig.UserConfig.AllowRegister =
      process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
    adminConfig.SiteConfig.ImageProxy =
      process.env.NEXT_PUBLIC_IMAGE_PROXY || '';
    adminConfig.SiteConfig.DoubanProxy =
      process.env.NEXT_PUBLIC_DOUBAN_PROXY || '';

    // SourceConfig 现在存储在独立的 source_configs 表中，不再在这里合并

    const ownerUser = process.env.USERNAME || '';
    // 检查配置中的站长用户是否和 USERNAME 匹配，如果不匹配则降级为普通用户
    let containOwner = false;
    adminConfig.UserConfig.Users.forEach((user) => {
      if (user.username !== ownerUser && user.role === 'owner') {
        user.role = 'user';
      }
      if (user.username === ownerUser) {
        containOwner = true;
        user.role = 'owner';
      }
    });

    // 如果不在则添加
    if (!containOwner) {
      adminConfig.UserConfig.Users.unshift({
        username: ownerUser,
        role: 'owner',
      });
    }
    cachedConfig = adminConfig;
  } else {
    // DB 无配置，执行一次初始化
    await initConfig();
  }
  return cachedConfig;
}

export async function resetConfig() {
  const storage = getStorage();
  // 获取所有用户名，用于补全 Users
  let userNames: string[] = [];
  if (storage && typeof (storage as any).getAllUsers === 'function') {
    try {
      userNames = await (storage as any).getAllUsers();
    } catch (e) {
      console.error('获取用户列表失败:', e);
    }
  }

  if (process.env.DOCKER_ENV === 'true') {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const _require = eval('require') as NodeRequire;
    const fs = _require('fs') as typeof import('fs');
    const path = _require('path') as typeof import('path');

    const configPath = path.join(process.cwd(), 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(raw) as ConfigFileStruct;
    console.log('load dynamic config success');
  } else {
    // 默认使用编译时生成的配置
    fileConfig = runtimeConfig as unknown as ConfigFileStruct;
  }

  // 从文件中获取源信息，用于补全源
  const apiSiteEntries = Object.entries(fileConfig.api_site);
  let allUsers = userNames.map((uname) => ({
    username: uname,
    role: 'user',
  }));
  const ownerUser = process.env.USERNAME;
  if (ownerUser) {
    allUsers = allUsers.filter((u) => u.username !== ownerUser);
    allUsers.unshift({
      username: ownerUser,
      role: 'owner',
    });
  }
  const adminConfig = {
    SiteConfig: {
      SiteName: process.env.SITE_NAME || 'KatelyaTV',
      Announcement:
        process.env.ANNOUNCEMENT ||
        '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
      SearchDownstreamMaxPage:
        Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
      SiteInterfaceCacheTime: fileConfig.cache_time || 7200,
      ImageProxy: process.env.NEXT_PUBLIC_IMAGE_PROXY || '',
      DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
    },
    UserConfig: {
      AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
      Users: allUsers as any,
    },
    SourceConfig: apiSiteEntries.map(([key, site]) => ({
      key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      from: 'config',
      disabled: false,
    })),
  } as AdminConfig;

  if (storage && typeof (storage as any).setAdminConfig === 'function') {
    await (storage as any).setAdminConfig(adminConfig);
  }
  if (cachedConfig == null) {
    // serverless 环境，直接使用 adminConfig
    cachedConfig = adminConfig;
  }
  cachedConfig.SiteConfig = adminConfig.SiteConfig;
  cachedConfig.UserConfig = adminConfig.UserConfig;
  // SourceConfig 现在存储在独立的数据库表中，不再缓存
}

export async function getCacheTime(): Promise<number> {
  const config = await getConfig();
  return config.SiteConfig.SiteInterfaceCacheTime || 7200;
}

export async function getAvailableApiSites(filterAdult = false): Promise<ApiSite[]> {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  
  if (storageType === 'localstorage') {
    // 本地存储模式从文件配置读取
    if (!fileConfig) {
      fileConfig = runtimeConfig as unknown as ConfigFileStruct;
    }
    let sites = Object.entries(fileConfig.api_site).map(([key, site]) => ({
      key,
      name: site.name,
      api: site.api,
      detail: site.detail || '',
      is_adult: (site as any).is_adult || false,
      disabled: false
    }));
    
    // 如果需要过滤成人内容，则排除标记为成人内容的资源站
    if (filterAdult) {
      sites = sites.filter((s) => !s.is_adult);
    }
    
    return sites.map((s) => ({
      key: s.key,
      name: s.name,
      api: s.api,
      detail: s.detail,
    }));
  }

  const storage = getStorage();
  if (!storage || typeof storage.getAllSourceConfigs !== 'function') {
    console.warn('Storage does not support SourceConfig operations');
    return [];
  }

  try {
    const allConfigs = await storage.getAllSourceConfigs();
    let sites = allConfigs
      .filter((s) => !s.disabled)
      .map((s) => ({
        ...s,
        is_adult: s.is_adult === true // 严格检查，只有明确为 true 的才是成人内容
      }));
    
    // 如果需要过滤成人内容，则排除标记为成人内容的资源站
    if (filterAdult) {
      sites = sites.filter((s) => !s.is_adult);
    }
    
    return sites.map((s) => ({
      key: s.source_key,
      name: s.name,
      api: s.api,
      detail: s.detail,
    }));
  } catch (error) {
    console.error('Failed to get available API sites:', error);
    return [];
  }
}

// 根据用户设置动态获取可用资源站（你的想法实现）
export async function getFilteredApiSites(userName?: string): Promise<ApiSite[]> {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  
  // 默认过滤成人内容
  let shouldFilterAdult = true;
  
  // 如果提供了用户名，获取用户设置
  if (userName) {
    try {
      const storage = getStorage();
      const userSettings = await storage.getUserSettings(userName);
      shouldFilterAdult = userSettings?.filter_adult_content !== false; // 默认为 true
    } catch (error) {
      // 获取用户设置失败时，默认过滤成人内容
      console.warn('Failed to get user settings, using default filter:', error);
    }
  }
  
  if (storageType === 'localstorage') {
    // 本地存储模式从文件配置读取
    if (!fileConfig) {
      fileConfig = runtimeConfig as unknown as ConfigFileStruct;
    }
    let sites = Object.entries(fileConfig.api_site).map(([key, site]) => ({
      key,
      name: site.name,
      api: site.api,
      detail: site.detail || '',
      is_adult: (site as any).is_adult || false,
      disabled: false
    }));
    
    // 根据用户设置动态过滤成人内容源
    if (shouldFilterAdult) {
      sites = sites.filter((s) => !s.is_adult);
    }
    
    return sites.map((s) => ({
      key: s.key,
      name: s.name,
      api: s.api,
      detail: s.detail,
    }));
  }

  const storage = getStorage();
  if (!storage || typeof storage.getAllSourceConfigs !== 'function') {
    console.warn('Storage does not support SourceConfig operations');
    return [];
  }

  try {
    const allConfigs = await storage.getAllSourceConfigs();
    let sites = allConfigs
      .filter((s) => !s.disabled)
      .map((s) => ({
        ...s,
        is_adult: s.is_adult === true // 严格检查，只有明确为 true 的才是成人内容
      }));
    
    // 根据用户设置动态过滤成人内容源
    if (shouldFilterAdult) {
      sites = sites.filter((s) => !s.is_adult);
    }
    
    return sites.map((s) => ({
      key: s.source_key,
      name: s.name,
      api: s.api,
      detail: s.detail,
    }));
  } catch (error) {
    console.error('Failed to get filtered API sites:', error);
    return [];
  }
}

// 获取成人内容资源站
export async function getAdultApiSites(): Promise<ApiSite[]> {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  
  if (storageType === 'localstorage') {
    // 本地存储模式从文件配置读取
    if (!fileConfig) {
      fileConfig = runtimeConfig as unknown as ConfigFileStruct;
    }
    const adultSites = Object.entries(fileConfig.api_site)
      .filter(([key, site]) => (site as any).is_adult === true)
      .map(([key, site]) => ({
        key,
        name: site.name,
        api: site.api,
        detail: site.detail || '',
      }));
    
    return adultSites;
  }

  const storage = getStorage();
  if (!storage || typeof storage.getAllSourceConfigs !== 'function') {
    console.warn('Storage does not support SourceConfig operations');
    return [];
  }

  try {
    const allConfigs = await storage.getAllSourceConfigs();
    const adultSites = allConfigs
      .filter((s) => !s.disabled && s.is_adult === true); // 只有明确为 true 的才被认为是成人内容
    
    return adultSites.map((s) => ({
      key: s.source_key,
      name: s.name,
      api: s.api,
      detail: s.detail,
    }));
  } catch (error) {
    console.error('Failed to get adult API sites:', error);
    return [];
  }
}
