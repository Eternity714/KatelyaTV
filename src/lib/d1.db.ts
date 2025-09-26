/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { AdminConfig } from './admin.types';
import { EpisodeSkipConfig, Favorite, IStorage, PlayRecord, SourceConfig, UserSettings } from './types';

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// D1 数据库接口
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<D1ExecResult>;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = any>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = any>(): Promise<D1Result<T>>;
}

interface D1Result<T = any> {
  results: T[];
  success: boolean;
  error?: string;
  meta: {
    changed_db: boolean;
    changes: number;
    last_row_id: number;
    duration: number;
  };
}

interface D1ExecResult {
  count: number;
  duration: number;
}

// 获取全局D1数据库实例
function getD1Database(): D1Database {
  return (process.env as any).DB as D1Database;
}

export class D1Storage implements IStorage {
  private db: D1Database | null = null;

  private async getDatabase(): Promise<D1Database> {
    if (!this.db) {
      this.db = getD1Database();
    }
    return this.db;
  }

  // 播放记录相关
  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM play_records WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return {
        title: result.title,
        source_name: result.source_name,
        cover: result.cover,
        year: result.year,
        index: result.index_episode,
        total_episodes: result.total_episodes,
        play_time: result.play_time,
        total_time: result.total_time,
        save_time: result.save_time,
        search_title: result.search_title || undefined,
      };
    } catch (err) {
      console.error('Failed to get play record:', err);
      throw err;
    }
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO play_records 
          (username, key, title, source_name, cover, year, index_episode, total_episodes, play_time, total_time, save_time, search_title)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          key,
          record.title,
          record.source_name,
          record.cover,
          record.year,
          record.index,
          record.total_episodes,
          record.play_time,
          record.total_time,
          record.save_time,
          record.search_title || null
        )
        .run();
    } catch (err) {
      console.error('Failed to set play record:', err);
      throw err;
    }
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT * FROM play_records WHERE username = ? ORDER BY save_time DESC'
        )
        .bind(userName)
        .all<any>();

      const records: Record<string, PlayRecord> = {};

      result.results.forEach((row: any) => {
        records[row.key] = {
          title: row.title,
          source_name: row.source_name,
          cover: row.cover,
          year: row.year,
          index: row.index_episode,
          total_episodes: row.total_episodes,
          play_time: row.play_time,
          total_time: row.total_time,
          save_time: row.save_time,
          search_title: row.search_title || undefined,
        };
      });

      return records;
    } catch (err) {
      console.error('Failed to get all play records:', err);
      throw err;
    }
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM play_records WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err) {
      console.error('Failed to delete play record:', err);
      throw err;
    }
  }

  // 收藏相关
  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM favorites WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return {
        title: result.title,
        source_name: result.source_name,
        cover: result.cover,
        year: result.year,
        total_episodes: result.total_episodes,
        save_time: result.save_time,
        search_title: result.search_title,
      };
    } catch (err) {
      console.error('Failed to get favorite:', err);
      throw err;
    }
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO favorites 
          (username, key, title, source_name, cover, year, total_episodes, save_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          key,
          favorite.title,
          favorite.source_name,
          favorite.cover,
          favorite.year,
          favorite.total_episodes,
          favorite.save_time
        )
        .run();
    } catch (err) {
      console.error('Failed to set favorite:', err);
      throw err;
    }
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT * FROM favorites WHERE username = ? ORDER BY save_time DESC'
        )
        .bind(userName)
        .all<any>();

      const favorites: Record<string, Favorite> = {};

      result.results.forEach((row: any) => {
        favorites[row.key] = {
          title: row.title,
          source_name: row.source_name,
          cover: row.cover,
          year: row.year,
          total_episodes: row.total_episodes,
          save_time: row.save_time,
          search_title: row.search_title,
        };
      });

      return favorites;
    } catch (err) {
      console.error('Failed to get all favorites:', err);
      throw err;
    }
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM favorites WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err) {
      console.error('Failed to delete favorite:', err);
      throw err;
    }
  }

  // 用户相关
  async registerUser(userName: string, password: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
        .bind(userName, password, 'user')
        .run();
    } catch (err) {
      console.error('Failed to register user:', err);
      throw err;
    }
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT password FROM users WHERE username = ?')
        .bind(userName)
        .first<{ password: string }>();

      return result?.password === password;
    } catch (err) {
      console.error('Failed to verify user:', err);
      throw err;
    }
  }

  async checkUserExist(userName: string): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT 1 FROM users WHERE username = ?')
        .bind(userName)
        .first();

      return result !== null;
    } catch (err) {
      console.error('Failed to check user existence:', err);
      throw err;
    }
  }

  // 获取用户角色
  async getUserRole(userName: string): Promise<string | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT role FROM users WHERE username = ?')
        .bind(userName)
        .first<{ role: string }>();

      return result?.role || null;
    } catch (err) {
      console.error('Failed to get user role:', err);
      throw err;
    }
  }

  // 设置用户角色
  async setUserRole(userName: string, role: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?')
        .bind(role, userName)
        .run();
    } catch (err) {
      console.error('Failed to set user role:', err);
      throw err;
    }
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('UPDATE users SET password = ? WHERE username = ?')
        .bind(newPassword, userName)
        .run();
    } catch (err) {
      console.error('Failed to change password:', err);
      throw err;
    }
  }

  async deleteUser(userName: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      
      // 首先获取用户ID
      console.log(`开始删除用户: ${userName}`);
      const userResult = await db
        .prepare('SELECT id FROM users WHERE username = ?')
        .bind(userName)
        .first<{ id: number }>();
      
      if (!userResult) {
        console.error(`用户不存在: ${userName}`);
        throw new Error(`用户不存在: ${userName}`);
      }
      
      const userId = userResult.id;
      console.log(`找到用户ID: ${userId}，开始删除关联数据`);
      
      // 按正确顺序删除数据，避免外键约束冲突
      const statements = [
        // 1. 删除播放记录（使用 user_id）
        db.prepare('DELETE FROM play_records WHERE user_id = ?').bind(userId),
        // 2. 删除收藏记录（使用 user_id）
        db.prepare('DELETE FROM favorites WHERE user_id = ?').bind(userId),
        // 3. 删除搜索历史（使用 user_id）
        db.prepare('DELETE FROM search_history WHERE user_id = ?').bind(userId),
        // 4. 删除跳过配置（使用 user_id）
        db.prepare('DELETE FROM skip_configs WHERE user_id = ?').bind(userId),
        // 5. 删除用户设置（使用 username，因为该表仍使用 username 作为外键）
        db.prepare('DELETE FROM user_settings WHERE username = ?').bind(userName),
        // 6. 最后删除用户本身
        db.prepare('DELETE FROM users WHERE id = ?').bind(userId)
      ];

      console.log(`执行批量删除操作，共 ${statements.length} 条语句`);
      await db.batch(statements);
      console.log(`成功删除用户: ${userName}`);
    } catch (err) {
      console.error(`删除用户失败 (${userName}):`, err);
      // 提供更详细的错误信息
      if (err instanceof Error) {
        throw new Error(`删除用户失败: ${err.message}`);
      } else {
        throw new Error(`删除用户失败: 未知错误`);
      }
    }
  }

  // 搜索历史相关
  async getSearchHistory(userName: string): Promise<string[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT keyword FROM search_history WHERE username = ? ORDER BY created_at DESC LIMIT ?'
        )
        .bind(userName, SEARCH_HISTORY_LIMIT)
        .all<{ keyword: string }>();

      return result.results.map((row) => row.keyword);
    } catch (err) {
      console.error('Failed to get search history:', err);
      throw err;
    }
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      // 先删除可能存在的重复记录
      await db
        .prepare(
          'DELETE FROM search_history WHERE username = ? AND keyword = ?'
        )
        .bind(userName, keyword)
        .run();

      // 添加新记录
      await db
        .prepare('INSERT INTO search_history (username, keyword) VALUES (?, ?)')
        .bind(userName, keyword)
        .run();

      // 保持历史记录条数限制
      await db
        .prepare(
          `
          DELETE FROM search_history 
          WHERE username = ? AND id NOT IN (
            SELECT id FROM search_history 
            WHERE username = ? 
            ORDER BY created_at DESC 
            LIMIT ?
          )
        `
        )
        .bind(userName, userName, SEARCH_HISTORY_LIMIT)
        .run();
    } catch (err) {
      console.error('Failed to add search history:', err);
      throw err;
    }
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      if (keyword) {
        await db
          .prepare(
            'DELETE FROM search_history WHERE username = ? AND keyword = ?'
          )
          .bind(userName, keyword)
          .run();
      } else {
        await db
          .prepare('DELETE FROM search_history WHERE username = ?')
          .bind(userName)
          .run();
      }
    } catch (err) {
      console.error('Failed to delete search history:', err);
      throw err;
    }
  }

  // 用户列表
  async getAllUsers(): Promise<string[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT username FROM users ORDER BY created_at ASC')
        .all<{ username: string }>();

      return result.results.map((row) => row.username);
    } catch (err) {
      console.error('Failed to get all users:', err);
      throw err;
    }
  }

  // 用户到期时间相关
  async getUserExpiryTime(userName: string): Promise<string | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT expires_at FROM users WHERE username = ?')
        .bind(userName)
        .first<{ expires_at: string | null }>();

      return result?.expires_at || null;
    } catch (err) {
      console.error('Failed to get user expiry time:', err);
      throw err;
    }
  }

  async setUserExpiryTime(userName: string, expiryTime: string | null): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('UPDATE users SET expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?')
        .bind(expiryTime, userName)
        .run();
    } catch (err) {
      console.error('Failed to set user expiry time:', err);
      throw err;
    }
  }

  async getExpiredUsers(): Promise<string[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT username FROM users WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP')
        .all<{ username: string }>();

      return result.results.map((row) => row.username);
    } catch (err) {
      console.error('Failed to get expired users:', err);
      throw err;
    }
  }

  // 管理员配置相关
  async getAdminConfig(): Promise<AdminConfig | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT config_value as config FROM admin_configs WHERE config_key = ? LIMIT 1')
        .bind('main_config')
        .first<{ config: string }>();

      if (!result) return null;

      return JSON.parse(result.config) as AdminConfig;
    } catch (err) {
      console.error('Failed to get admin config:', err);
      throw err;
    }
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          'INSERT OR REPLACE INTO admin_configs (config_key, config_value, description) VALUES (?, ?, ?)'
        )
        .bind('main_config', JSON.stringify(config), '主要管理员配置')
        .run();
    } catch (err) {
      console.error('Failed to set admin config:', err);
      throw err;
    }
  }

  // 跳过配置相关
  async getSkipConfig(
    userName: string,
    key: string
  ): Promise<EpisodeSkipConfig | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM skip_configs WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return {
        source: result.source,
        id: result.video_id,
        title: result.title,
        segments: JSON.parse(result.segments),
        updated_time: result.updated_time,
      };
    } catch (err) {
      console.error('Failed to get skip config:', err);
      throw err;
    }
  }

  async setSkipConfig(
    userName: string,
    key: string,
    config: EpisodeSkipConfig
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO skip_configs 
          (username, key, source, video_id, title, segments, updated_time)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          key,
          config.source,
          config.id,
          config.title,
          JSON.stringify(config.segments),
          config.updated_time
        )
        .run();
    } catch (err) {
      console.error('Failed to set skip config:', err);
      throw err;
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: EpisodeSkipConfig }> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM skip_configs WHERE username = ?')
        .bind(userName)
        .all<any>();

      const configs: { [key: string]: EpisodeSkipConfig } = {};
      
      for (const row of result.results) {
        configs[row.key] = {
          source: row.source,
          id: row.video_id,
          title: row.title,
          segments: JSON.parse(row.segments),
          updated_time: row.updated_time,
        };
      }

      return configs;
    } catch (err) {
      console.error('Failed to get all skip configs:', err);
      throw err;
    }
  }

  async deleteSkipConfig(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM skip_configs WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err) {
      console.error('Failed to delete skip config:', err);
      throw err;
    }
  }

  // ---------- 用户设置 ----------
  async getUserSettings(userName: string): Promise<UserSettings | null> {
    try {
      const db = await this.getDatabase();
      const row = await db
        .prepare(`
          SELECT 
            filter_adult_content,
            theme,
            language,
            auto_play,
            video_quality
          FROM user_settings 
          WHERE username = ?
        `)
        .bind(userName)
        .first();
      
      if (row) {
        return {
          filter_adult_content: Boolean(row.filter_adult_content),
          theme: row.theme as 'light' | 'dark' | 'auto',
          language: row.language as string,
          auto_play: Boolean(row.auto_play),
          video_quality: row.video_quality as string
        };
      }
      return null;
    } catch (err) {
      console.error('Failed to get user settings:', err);
      throw err;
    }
  }

  async setUserSettings(
    userName: string,
    settings: UserSettings
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(`
          INSERT OR REPLACE INTO user_settings (
            username, 
            filter_adult_content, 
            theme, 
            language, 
            auto_play, 
            video_quality, 
            updated_time
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          userName,
          settings.filter_adult_content ? 1 : 0,
          settings.theme,
          settings.language,
          settings.auto_play ? 1 : 0,
          settings.video_quality,
          Date.now()
        )
        .run();
    } catch (err) {
      console.error('Failed to set user settings:', err);
      throw err;
    }
  }

  async updateUserSettings(
    userName: string,
    settings: Partial<UserSettings>
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      const currentSettings = await this.getUserSettings(userName);
      
      // 如果用户设置不存在，创建默认设置
      if (!currentSettings) {
        const defaultSettings: UserSettings = {
          filter_adult_content: true,
          theme: 'auto',
          language: 'zh-CN',
          auto_play: false,
          video_quality: 'auto'
        };
        const newSettings: UserSettings = {
          filter_adult_content: settings.filter_adult_content ?? defaultSettings.filter_adult_content,
          theme: settings.theme ?? defaultSettings.theme,
          language: settings.language ?? defaultSettings.language,
          auto_play: settings.auto_play ?? defaultSettings.auto_play,
          video_quality: settings.video_quality ?? defaultSettings.video_quality
        };
        await this.setUserSettings(userName, newSettings);
        return;
      }

      // 构建动态更新 SQL
      const updateFields: string[] = [];
      const values: any[] = [];

      if (settings.filter_adult_content !== undefined) {
        updateFields.push('filter_adult_content = ?');
        values.push(settings.filter_adult_content ? 1 : 0);
      }
      if (settings.theme !== undefined) {
        updateFields.push('theme = ?');
        values.push(settings.theme);
      }
      if (settings.language !== undefined) {
        updateFields.push('language = ?');
        values.push(settings.language);
      }
      if (settings.auto_play !== undefined) {
        updateFields.push('auto_play = ?');
        values.push(settings.auto_play ? 1 : 0);
      }
      if (settings.video_quality !== undefined) {
        updateFields.push('video_quality = ?');
        values.push(settings.video_quality);
      }

      if (updateFields.length > 0) {
        updateFields.push('updated_time = ?');
        values.push(Date.now());
        values.push(userName); // WHERE 条件的参数

        const sql = `
          UPDATE user_settings 
          SET ${updateFields.join(', ')} 
          WHERE username = ?
        `;

        await db.prepare(sql).bind(...values).run();
      }
    } catch (err) {
      console.error('Failed to update user settings:', err);
      throw err;
    }
  }

  // 视频源配置相关
  async getAllSourceConfigs(): Promise<SourceConfig[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM source_configs ORDER BY sort_order ASC, id ASC')
        .all<any>();

      return result.results.map(row => ({
        id: row.id,
        source_key: row.source_key,
        name: row.name,
        api: row.api,
        detail: row.detail || undefined,
        from_type: row.from_type as 'config' | 'custom',
        disabled: Boolean(row.disabled),
        is_adult: Boolean(row.is_adult),
        sort_order: row.sort_order,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));
    } catch (err) {
      console.error('Failed to get all source configs:', err);
      throw err;
    }
  }

  async getSourceConfig(sourceKey: string): Promise<SourceConfig | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM source_configs WHERE source_key = ?')
        .bind(sourceKey)
        .first<any>();

      if (!result) return null;

      return {
        id: result.id,
        source_key: result.source_key,
        name: result.name,
        api: result.api,
        detail: result.detail || undefined,
        from_type: result.from_type as 'config' | 'custom',
        disabled: Boolean(result.disabled),
        is_adult: Boolean(result.is_adult),
        sort_order: result.sort_order,
        created_at: result.created_at,
        updated_at: result.updated_at,
      };
    } catch (err) {
      console.error('Failed to get source config:', err);
      throw err;
    }
  }

  async addSourceConfig(config: Omit<SourceConfig, 'id' | 'created_at' | 'updated_at'>): Promise<SourceConfig> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(`
          INSERT INTO source_configs 
          (source_key, name, api, detail, from_type, disabled, is_adult, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          config.source_key,
          config.name,
          config.api,
          config.detail || null,
          config.from_type,
          config.disabled ? 1 : 0,
          config.is_adult ? 1 : 0,
          config.sort_order
        )
        .run();

      if (!result.success) {
        throw new Error('Failed to insert source config');
      }

      // 返回新创建的记录
      const newConfig = await this.getSourceConfig(config.source_key);
      if (!newConfig) {
        throw new Error('Failed to retrieve newly created source config');
      }

      return newConfig;
    } catch (err) {
      console.error('Failed to add source config:', err);
      throw err;
    }
  }

  async updateSourceConfig(
    sourceKey: string,
    config: Partial<Omit<SourceConfig, 'id' | 'source_key' | 'created_at' | 'updated_at'>>
  ): Promise<SourceConfig | null> {
    try {
      const db = await this.getDatabase();
      
      // 构建动态更新语句
      const updateFields: string[] = [];
      const values: any[] = [];

      if (config.name !== undefined) {
        updateFields.push('name = ?');
        values.push(config.name);
      }
      if (config.api !== undefined) {
        updateFields.push('api = ?');
        values.push(config.api);
      }
      if (config.detail !== undefined) {
        updateFields.push('detail = ?');
        values.push(config.detail || null);
      }
      if (config.from_type !== undefined) {
        updateFields.push('from_type = ?');
        values.push(config.from_type);
      }
      if (config.disabled !== undefined) {
        updateFields.push('disabled = ?');
        values.push(config.disabled ? 1 : 0);
      }
      if (config.is_adult !== undefined) {
        updateFields.push('is_adult = ?');
        values.push(config.is_adult ? 1 : 0);
      }
      if (config.sort_order !== undefined) {
        updateFields.push('sort_order = ?');
        values.push(config.sort_order);
      }

      if (updateFields.length === 0) {
        // 没有字段需要更新，返回现有记录
        return this.getSourceConfig(sourceKey);
      }

      // 添加 updated_at 字段
      updateFields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(sourceKey);

      const sql = `UPDATE source_configs SET ${updateFields.join(', ')} WHERE source_key = ?`;
      const result = await db.prepare(sql).bind(...values).run();

      if (!result.success || result.meta.changes === 0) {
        return null;
      }

      return this.getSourceConfig(sourceKey);
    } catch (err) {
      console.error('Failed to update source config:', err);
      throw err;
    }
  }

  async deleteSourceConfig(sourceKey: string): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('DELETE FROM source_configs WHERE source_key = ?')
        .bind(sourceKey)
        .run();

      return result.success && result.meta.changes > 0;
    } catch (err) {
      console.error('Failed to delete source config:', err);
      throw err;
    }
  }

  async enableSourceConfig(sourceKey: string): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('UPDATE source_configs SET disabled = 0, updated_at = CURRENT_TIMESTAMP WHERE source_key = ?')
        .bind(sourceKey)
        .run();

      return result.success && result.meta.changes > 0;
    } catch (err) {
      console.error('Failed to enable source config:', err);
      throw err;
    }
  }

  async disableSourceConfig(sourceKey: string): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('UPDATE source_configs SET disabled = 1, updated_at = CURRENT_TIMESTAMP WHERE source_key = ?')
        .bind(sourceKey)
        .run();

      return result.success && result.meta.changes > 0;
    } catch (err) {
      console.error('Failed to disable source config:', err);
      throw err;
    }
  }

  async reorderSourceConfigs(sourceKeys: string[]): Promise<void> {
    try {
      const db = await this.getDatabase();
      
      // 使用事务批量更新排序
      const statements = sourceKeys.map((sourceKey, index) =>
        db.prepare('UPDATE source_configs SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE source_key = ?')
          .bind(index, sourceKey)
      );

      await db.batch(statements);
    } catch (err) {
      console.error('Failed to reorder source configs:', err);
      throw err;
    }
  }
}
