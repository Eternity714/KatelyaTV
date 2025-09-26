import { AdminConfig } from './admin.types';

// 播放记录数据结构
export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  year: string;
  index: number; // 第几集
  total_episodes: number; // 总集数
  play_time: number; // 播放进度（秒）
  total_time: number; // 总进度（秒）
  save_time: number; // 记录保存时间（时间戳）
  search_title: string; // 搜索时使用的标题
}

// 片头片尾数据结构
export interface SkipSegment {
  start: number; // 开始时间（秒）
  end: number; // 结束时间（秒）
  type: 'opening' | 'ending'; // 片头或片尾
  title?: string; // 可选的描述
}

// 剧集跳过配置
export interface EpisodeSkipConfig {
  source: string; // 资源站标识
  id: string; // 剧集ID
  title: string; // 剧集标题
  segments: SkipSegment[]; // 跳过片段列表
  updated_time: number; // 最后更新时间
}

// 收藏数据结构
export interface Favorite {
  source_name: string;
  total_episodes: number; // 总集数
  title: string;
  year: string;
  cover: string;
  save_time: number; // 记录保存时间（时间戳）
  search_title: string; // 搜索时使用的标题
}

// 视频源配置数据结构（独立存储）
export interface SourceConfig {
  id?: number; // 数据库主键（可选，新增时不需要）
  source_key: string; // 源的唯一标识符
  name: string; // 源的显示名称
  api: string; // 视频 API 的搜索接口地址
  detail?: string; // 视频详情接口地址（可选）
  from_type: 'config' | 'custom'; // 来源类型
  disabled: boolean; // 是否禁用
  is_adult: boolean; // 是否为成人内容源
  sort_order: number; // 排序顺序
  created_at?: string; // 创建时间（可选）
  updated_at?: string; // 更新时间（可选）
}

// 用户数据库记录接口
export interface UserRecord {
  id: number;
  username: string;
  password: string;
  expires_at?: string | null; // 用户到期时间，ISO 8601 格式字符串，null 表示永不过期
  created_at: string;
  updated_at: string;
}

// 存储接口
export interface IStorage {
  // 播放记录相关
  getPlayRecord(userName: string, key: string): Promise<PlayRecord | null>;
  setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void>;
  getAllPlayRecords(userName: string): Promise<{ [key: string]: PlayRecord }>;
  deletePlayRecord(userName: string, key: string): Promise<void>;

  // 收藏相关
  getFavorite(userName: string, key: string): Promise<Favorite | null>;
  setFavorite(userName: string, key: string, favorite: Favorite): Promise<void>;
  getAllFavorites(userName: string): Promise<{ [key: string]: Favorite }>;
  deleteFavorite(userName: string, key: string): Promise<void>;

  // 用户相关
  registerUser(userName: string, password: string): Promise<void>;
  verifyUser(userName: string, password: string): Promise<boolean>;
  // 检查用户是否存在（无需密码）
  checkUserExist(userName: string): Promise<boolean>;
  // 修改用户密码
  changePassword(userName: string, newPassword: string): Promise<void>;
  // 删除用户（包括密码、搜索历史、播放记录、收藏夹）
  deleteUser(userName: string): Promise<void>;
  // 获取用户角色
  getUserRole(userName: string): Promise<string | null>;
  // 设置用户角色
  setUserRole(userName: string, role: string): Promise<void>;
  // 获取用户封禁状态
  getUserBanned(userName: string): Promise<boolean>;
  // 设置用户封禁状态
  setUserBanned(userName: string, banned: boolean): Promise<void>;

  // 用户设置相关
  getUserSettings(userName: string): Promise<UserSettings | null>;
  setUserSettings(userName: string, settings: UserSettings): Promise<void>;
  updateUserSettings(userName: string, settings: Partial<UserSettings>): Promise<void>;

  // 搜索历史相关
  getSearchHistory(userName: string): Promise<string[]>;
  addSearchHistory(userName: string, keyword: string): Promise<void>;
  deleteSearchHistory(userName: string, keyword?: string): Promise<void>;

  // 片头片尾跳过配置相关
  getSkipConfig(userName: string, key: string): Promise<EpisodeSkipConfig | null>;
  setSkipConfig(userName: string, key: string, config: EpisodeSkipConfig): Promise<void>;
  getAllSkipConfigs(userName: string): Promise<{ [key: string]: EpisodeSkipConfig }>;
  deleteSkipConfig(userName: string, key: string): Promise<void>;

  // 用户列表
  getAllUsers(): Promise<string[]>;

  // 用户到期时间相关
  getUserExpiryTime(userName: string): Promise<string | null>;
  setUserExpiryTime(userName: string, expiryTime: string | null): Promise<void>;
  getExpiredUsers(): Promise<string[]>; // 获取已过期的用户列表

  // 管理员配置相关
  getAdminConfig(): Promise<AdminConfig | null>;
  setAdminConfig(config: AdminConfig): Promise<void>;

  // 视频源配置相关
  getAllSourceConfigs(): Promise<SourceConfig[]>;
  getSourceConfig(sourceKey: string): Promise<SourceConfig | null>;
  addSourceConfig(config: Omit<SourceConfig, 'id' | 'created_at' | 'updated_at'>): Promise<SourceConfig>;
  updateSourceConfig(sourceKey: string, config: Partial<Omit<SourceConfig, 'id' | 'source_key' | 'created_at' | 'updated_at'>>): Promise<SourceConfig | null>;
  deleteSourceConfig(sourceKey: string): Promise<boolean>;
  enableSourceConfig(sourceKey: string): Promise<boolean>;
  disableSourceConfig(sourceKey: string): Promise<boolean>;
  reorderSourceConfigs(sourceKeys: string[]): Promise<void>;
}

// 搜索结果数据结构
export interface SearchResult {
  id: string;
  title: string;
  poster: string;
  episodes: string[];
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
  douban_id?: number;
}

// 豆瓣数据结构
export interface DoubanItem {
  id: string;
  title: string;
  poster: string;
  rate: string;
  year: string;
}

export interface DoubanResult {
  code: number;
  message: string;
  list: DoubanItem[];
}

// 资源站配置
export interface ApiSite {
  api: string;
  name: string;
  detail?: string;
  type?: number;
  playMode?: 'parse' | 'direct';
  is_adult?: boolean; // 新增：是否为成人内容资源站
}

// 配置文件结构
export interface Config {
  cache_time: number;
  api_site: { [key: string]: ApiSite };
}

// 用户设置
export interface UserSettings {
  filter_adult_content: boolean; // 是否过滤成人内容，默认为 true
  theme: 'light' | 'dark' | 'auto';
  language: string;
  auto_play: boolean;
  video_quality: string;
  [key: string]: string | boolean | number; // 允许其他设置
}

// 搜索结果（支持成人内容分组）
export interface GroupedSearchResults {
  regular_results: SearchResult[];
  adult_results?: SearchResult[];
}

// Runtime配置类型
export interface RuntimeConfig {
  STORAGE_TYPE?: string;
  ENABLE_REGISTER?: boolean;
  IMAGE_PROXY?: string;
  DOUBAN_PROXY?: string;
}

// 全局Window类型扩展
declare global {
  interface Window {
    RUNTIME_CONFIG?: RuntimeConfig;
  }
}
