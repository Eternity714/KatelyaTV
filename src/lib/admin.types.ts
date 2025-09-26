export interface AdminConfig {
  SiteConfig: {
    SiteName: string;
    Announcement: string;
    SearchDownstreamMaxPage: number;
    SiteInterfaceCacheTime: number;
    ImageProxy: string;
    DoubanProxy: string;
  };
  UserConfig: {
    AllowRegister: boolean;
    Users: {
      username: string;
      role: 'user' | 'vip' | 'admin' | 'owner';
      banned?: boolean;
      expires_at?: string | null; // 用户到期时间，ISO 8601 格式字符串，null 表示永不过期
    }[];
  };
  // SourceConfig 已迁移到独立的 source_configs 数据库表
}

export interface AdminConfigResult {
  Role: 'owner' | 'admin';
  Config: AdminConfig;
}
