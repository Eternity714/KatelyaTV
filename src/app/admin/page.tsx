/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

'use client';

import {
  closestCenter,
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown,
  ChevronUp,
  Settings,
  Tv,
  Users,
  Video,
} from 'lucide-react';
import { GripVertical } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Swal from 'sweetalert2';

import { AdminConfig, AdminConfigResult } from '@/lib/admin.types';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

import PageLayout from '@/components/PageLayout';
import { useToast } from '@/components/ToastProvider';

// 新增站点配置类型
interface SiteConfig {
  SiteName: string;
  Announcement: string;
  SearchDownstreamMaxPage: number;
  SiteInterfaceCacheTime: number;
  ImageProxy: string;
  DoubanProxy: string;
}

// 视频源数据类型
interface DataSource {
  name: string;
  key: string;
  api: string;
  detail?: string;
  disabled?: boolean;
  from: 'config' | 'custom';
  is_adult?: boolean; // 添加成人内容标记字段
}

// 可折叠标签组件
interface CollapsibleTabProps {
  title: string;
  icon?: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const CollapsibleTab = ({
  title,
  icon,
  isExpanded,
  onToggle,
  children,
}: CollapsibleTabProps) => {
  return (
    <div className='rounded-xl shadow-sm mb-4 overflow-hidden bg-white/80 backdrop-blur-md dark:bg-gray-800/50 dark:ring-1 dark:ring-gray-700'>
      <button
        onClick={onToggle}
        className='w-full px-6 py-4 flex items-center justify-between bg-gray-50/70 dark:bg-gray-800/60 hover:bg-gray-100/80 dark:hover:bg-gray-700/60 transition-colors'
      >
        <div className='flex items-center gap-3'>
          {icon}
          <h3 className='text-lg font-medium text-gray-900 dark:text-gray-100'>
            {title}
          </h3>
        </div>
        <div className='text-gray-500 dark:text-gray-400'>
          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {isExpanded && <div className='px-6 py-4'>{children}</div>}
    </div>
  );
};

// 用户配置组件
interface UserConfigProps {
  config: AdminConfig | null;
  role: 'owner' | 'admin' | null;
  refreshConfig: () => Promise<void>;
}

const UserConfig = ({ config, role, refreshConfig }: UserConfigProps) => {
  const { showSuccess, showError } = useToast();
  const [userSettings, setUserSettings] = useState({
    enableRegistration: false,
  });
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [showChangePasswordForm, setShowChangePasswordForm] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
  });
  const [changePasswordUser, setChangePasswordUser] = useState({
    username: '',
    password: '',
  });
  // 添加内联编辑到期时间的状态
  const [editingExpiry, setEditingExpiry] = useState<string | null>(null);
  const [editingExpiryTime, setEditingExpiryTime] = useState<string>('');

  // 当前登录用户名
  const currentUsername = getAuthInfoFromBrowserCookie()?.username || null;

  // 检测存储类型是否为 d1
  const isD1Storage =
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.STORAGE_TYPE === 'd1';
  const isUpstashStorage =
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.STORAGE_TYPE === 'upstash';

  useEffect(() => {
    if (config?.UserConfig) {
      setUserSettings({
        enableRegistration: config.UserConfig.AllowRegister,
      });
    }
  }, [config]);

  // 切换允许注册设置
  const toggleAllowRegister = async (value: boolean) => {
    try {
      // 先更新本地 UI
      setUserSettings((prev) => ({ ...prev, enableRegistration: value }));

      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setAllowRegister',
          allowRegister: value,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${res.status}`);
      }

      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
      // revert toggle UI
      setUserSettings((prev) => ({ ...prev, enableRegistration: !value }));
    }
  };

  const handleBanUser = async (uname: string) => {
    try {
      await handleUserAction('ban', uname);
      showSuccess(`用户 ${uname} 已成功封禁`);
    } catch (err) {
      // 错误处理已在 handleUserAction 中完成
    }
  };

  const handleUnbanUser = async (uname: string) => {
    try {
      await handleUserAction('unban', uname);
      showSuccess(`用户 ${uname} 已成功解封`);
    } catch (err) {
      // 错误处理已在 handleUserAction 中完成
    }
  };

  // 统一的角色变更处理函数
  const handleRoleChange = async (username: string, newRole: 'user' | 'vip' | 'admin') => {
    try {
      // 根据新角色确定需要执行的操作
      let action: string;

      if (newRole === 'user') {
        // 如果目标是普通用户，需要取消当前角色
        const currentUser = config?.UserConfig.Users.find(u => u.username === username);
        if (currentUser?.role === 'admin') {
          action = 'cancelAdmin';
        } else if (currentUser?.role === 'vip') {
          action = 'cancelVip';
        } else {
          return; // 已经是普通用户，无需操作
        }
      } else if (newRole === 'vip') {
        action = 'setVip';
      } else if (newRole === 'admin') {
        action = 'setAdmin';
      } else {
        return;
      }

      await handleUserAction(action as any, username);
      showSuccess(`用户角色已更新为${newRole === 'user' ? '普通用户' : newRole === 'vip' ? 'VIP用户' : '管理员'}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : '角色更新失败');
    }
  };

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password) return;
    try {
      await handleUserAction('add', newUser.username, newUser.password);
      setNewUser({ username: '', password: '' });
      setShowAddUserForm(false);
      showSuccess(`用户 ${newUser.username} 添加成功`);
    } catch (err) {
      showError(err instanceof Error ? err.message : '添加用户失败');
    }
  };

  const handleChangePassword = async () => {
    if (!changePasswordUser.username || !changePasswordUser.password) return;
    try {
      await handleUserAction(
        'changePassword',
        changePasswordUser.username,
        changePasswordUser.password
      );
      setChangePasswordUser({ username: '', password: '' });
      setShowChangePasswordForm(false);
      showSuccess(`用户 ${changePasswordUser.username} 密码修改成功`);
    } catch (err) {
      showError(err instanceof Error ? err.message : '密码修改失败');
    }
  };

  const handleShowChangePasswordForm = (username: string) => {
    setChangePasswordUser({ username, password: '' });
    setShowChangePasswordForm(true);
    setShowAddUserForm(false); // 关闭添加用户表单
  };

  const handleDeleteUser = async (username: string) => {
    const { isConfirmed } = await Swal.fire({
      title: '确认删除用户',
      text: `删除用户 ${username} 将同时删除其搜索历史、播放记录和收藏夹，此操作不可恢复！`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonColor: '#dc2626',
    });

    if (!isConfirmed) return;

    try {
      await handleUserAction('deleteUser', username);
      showSuccess(`用户 ${username} 删除成功`);
    } catch (err) {
      showError(err instanceof Error ? err.message : '删除用户失败');
    }
  };

  // 开始编辑到期时间
  const handleStartEditExpiry = (username: string) => {
    const user = config?.UserConfig.Users.find(u => u.username === username);
    const currentExpiry = user?.expires_at;

    // 如果有当前到期时间，转换为本地时间格式用于输入框
    let formattedExpiry = '';
    if (currentExpiry) {
      const date = new Date(currentExpiry);
      // 转换为本地时间的 datetime-local 格式
      formattedExpiry = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    }

    setEditingExpiry(username);
    setEditingExpiryTime(formattedExpiry);
  };

  // 保存到期时间
  const handleSaveExpiry = async (username: string) => {
    try {
      // 如果输入了时间，转换为 ISO 字符串；否则设为 null（永不过期）
      const finalExpiryTime = editingExpiryTime
        ? new Date(editingExpiryTime).toISOString()
        : null;

      await handleUserAction('setUserExpiry', username, undefined, finalExpiryTime);
      setEditingExpiry(null);
      setEditingExpiryTime('');
      showSuccess(`用户 ${username} 到期时间设置成功`);
    } catch (err) {
      showError(err instanceof Error ? err.message : '设置到期时间失败');
    }
  };

  // 清除到期时间（设为永不过期）
  const handleClearExpiry = async (username: string) => {
    try {
      await handleUserAction('setUserExpiry', username, undefined, null);
      setEditingExpiry(null);
      showSuccess(`用户 ${username} 已设为永不过期`);
    } catch (err) {
      showError(err instanceof Error ? err.message : '清除到期时间失败');
    }
  };

  // 取消编辑到期时间
  const handleCancelEditExpiry = () => {
    setEditingExpiry(null);
    setEditingExpiryTime('');
  };

  // 通用请求函数
  const handleUserAction = async (
    action:
      | 'add'
      | 'ban'
      | 'unban'
      | 'setAdmin'
      | 'cancelAdmin'
      | 'setVip'
      | 'cancelVip'
      | 'changePassword'
      | 'deleteUser'
      | 'setUserExpiry',
    targetUsername: string,
    targetPassword?: string,
    expiryTime?: string | null
  ) => {
    const res = await fetch('/api/admin/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUsername,
        ...(targetPassword ? { targetPassword } : {}),
        ...(expiryTime !== undefined ? { expiryTime } : {}),
        action,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `操作失败: ${res.status}`);
    }

    // 成功后刷新配置（无需整页刷新）
    await refreshConfig();
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 用户统计 */}
      <div>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
          用户统计
        </h4>
        <div className='p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800'>
          <div className='text-2xl font-bold text-green-800 dark:text-green-300'>
            {config.UserConfig.Users.length}
          </div>
          <div className='text-sm text-green-600 dark:text-green-400'>
            总用户数
          </div>
        </div>
      </div>

      {/* 注册设置 */}
      <div>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
          注册设置
        </h4>
        <div className='flex items-center justify-between'>
          <label
            className={`text-gray-700 dark:text-gray-300 ${isD1Storage || isUpstashStorage ? 'opacity-50' : ''
              }`}
          >
            允许新用户注册
            {isD1Storage && (
              <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
                (D1 环境下请通过环境变量修改)
              </span>
            )}
            {isUpstashStorage && (
              <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
                (Upstash 环境下请通过环境变量修改)
              </span>
            )}
          </label>
          <button
            onClick={() =>
              !isD1Storage &&
              !isUpstashStorage &&
              toggleAllowRegister(!userSettings.enableRegistration)
            }
            disabled={isD1Storage || isUpstashStorage}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${userSettings.enableRegistration
                ? 'bg-green-600'
                : 'bg-gray-200 dark:bg-gray-700'
              } ${isD1Storage || isUpstashStorage
                ? 'opacity-50 cursor-not-allowed'
                : ''
              }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${userSettings.enableRegistration
                  ? 'translate-x-6'
                  : 'translate-x-1'
                }`}
            />
          </button>
        </div>
      </div>

      {/* 用户列表 */}
      <div>
        <div className='flex items-center justify-between mb-3'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            用户列表
          </h4>
          <button
            onClick={() => {
              setShowAddUserForm(!showAddUserForm);
              if (showChangePasswordForm) {
                setShowChangePasswordForm(false);
                setChangePasswordUser({ username: '', password: '' });
              }
            }}
            className='px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors'
          >
            {showAddUserForm ? '取消' : '添加用户'}
          </button>
        </div>

        {/* 添加用户表单 */}
        {showAddUserForm && (
          <div className='mb-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div className='flex flex-col sm:flex-row gap-4 sm:gap-3'>
              <input
                type='text'
                placeholder='用户名'
                value={newUser.username}
                onChange={(e) =>
                  setNewUser((prev) => ({ ...prev, username: e.target.value }))
                }
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <input
                type='password'
                placeholder='密码'
                value={newUser.password}
                onChange={(e) =>
                  setNewUser((prev) => ({ ...prev, password: e.target.value }))
                }
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <button
                onClick={handleAddUser}
                disabled={!newUser.username || !newUser.password}
                className='w-full sm:w-auto px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors'
              >
                添加
              </button>
            </div>
          </div>
        )}

        {/* 修改密码表单 */}
        {showChangePasswordForm && (
          <div className='mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700'>
            <h5 className='text-sm font-medium text-blue-800 dark:text-blue-300 mb-3'>
              修改用户密码
            </h5>
            <div className='flex flex-col sm:flex-row gap-4 sm:gap-3'>
              <input
                type='text'
                placeholder='用户名'
                value={changePasswordUser.username}
                disabled
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 cursor-not-allowed'
              />
              <input
                type='password'
                placeholder='新密码'
                value={changePasswordUser.password}
                onChange={(e) =>
                  setChangePasswordUser((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
              />
              <button
                onClick={handleChangePassword}
                disabled={!changePasswordUser.password}
                className='w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors'
              >
                修改密码
              </button>
              <button
                onClick={() => {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }}
                className='w-full sm:w-auto px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors'
              >
                取消
              </button>
            </div>
          </div>
        )}



        {/* 用户列表 */}
        <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-[28rem] overflow-y-auto overflow-x-auto'>
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900'>
              <tr>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  用户名
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  角色
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  状态
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  到期时间
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  操作
                </th>
              </tr>
            </thead>
            {/* 按规则排序用户：自己 -> 站长(若非自己) -> 管理员 -> VIP用户 -> 普通用户 */}
            {(() => {
              const sortedUsers = [...config.UserConfig.Users].sort((a, b) => {
                type UserInfo = (typeof config.UserConfig.Users)[number];
                const priority = (u: UserInfo) => {
                  if (u.username === currentUsername) return 0;
                  if (u.role === 'owner') return 1;
                  if (u.role === 'admin') return 2;
                  if (u.role === 'vip') return 3;
                  return 4;
                };
                return priority(a) - priority(b);
              });
              return (
                <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                  {sortedUsers.map((user) => {
                    // 修改密码权限：站长可修改管理员和普通用户密码，管理员可修改普通用户、VIP用户和自己的密码，但任何人都不能修改站长密码
                    const canChangePassword =
                      user.role !== 'owner' && // 不能修改站长密码
                      (role === 'owner' || // 站长可以修改管理员和普通用户密码
                        (role === 'admin' &&
                          (user.role === 'user' || user.role === 'vip' ||
                            user.username === currentUsername))); // 管理员可以修改普通用户、VIP用户和自己的密码

                    // 删除用户权限：站长可删除除自己外的所有用户，管理员可删除普通用户和VIP用户
                    const canDeleteUser =
                      user.username !== currentUsername &&
                      (role === 'owner' || // 站长可以删除除自己外的所有用户
                        (role === 'admin' && (user.role === 'user' || user.role === 'vip'))); // 管理员可删除普通用户和VIP用户

                    // 其他操作权限：不能操作自己，站长可操作所有用户，管理员可操作普通用户和VIP用户
                    const canOperate =
                      user.username !== currentUsername &&
                      (role === 'owner' ||
                        (role === 'admin' && (user.role === 'user' || user.role === 'vip')));
                    return (
                      <tr
                        key={user.username}
                        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors'
                      >
                        <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {user.username}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          {/* 角色下拉框 - 根据权限显示不同选项 */}
                          {canOperate ? (
                            <select
                              value={user.role}
                              onChange={(e) =>
                                handleRoleChange(
                                  user.username,
                                  e.target.value as 'user' | 'vip' | 'admin'
                                )
                              }
                              className={`pl-2 pr-6 py-1 text-xs rounded-md border-0 focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer min-w-[80px] ${user.role === 'owner'
                                  ? 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300'
                                  : user.role === 'admin'
                                    ? 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
                                    : user.role === 'vip'
                                      ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300'
                                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                                }`}
                              style={{
                                backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e")`,
                                backgroundPosition: 'right 0.25rem center',
                                backgroundRepeat: 'no-repeat',
                                backgroundSize: '1rem 1rem'
                              }}
                            >
                              <option value="user">普通用户</option>
                              <option value="vip">VIP用户</option>
                              {/* 只有站长可以设置管理员 */}
                              {role === 'owner' && <option value="admin">管理员</option>}
                            </select>
                          ) : (
                            <span
                              className={`px-2 py-1 text-xs rounded-full ${user.role === 'owner'
                                  ? 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300'
                                  : user.role === 'admin'
                                    ? 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
                                    : user.role === 'vip'
                                      ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300'
                                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                                }`}
                            >
                              {user.role === 'owner'
                                ? '站长'
                                : user.role === 'admin'
                                  ? '管理员'
                                  : user.role === 'vip'
                                    ? 'VIP用户'
                                    : '普通用户'}
                            </span>
                          )}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          {(() => {
                            // 检查用户是否过期
                            const isExpired = user.expires_at && new Date(user.expires_at) < new Date();

                            if (user.banned) {
                              return (
                                <span className='px-2 py-1 text-xs rounded-full bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'>
                                  已封禁
                                </span>
                              );
                            } else if (isExpired) {
                              return (
                                <span className='px-2 py-1 text-xs rounded-full bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300'>
                                  已过期
                                </span>
                              );
                            } else {
                              return (
                                <span className='px-2 py-1 text-xs rounded-full bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'>
                                  正常
                                </span>
                              );
                            }
                          })()}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
                          {editingExpiry === user.username ? (
                            // 编辑模式：显示时间选择器和操作按钮
                            <div className='flex flex-col gap-2'>
                              <input
                                type='datetime-local'
                                value={editingExpiryTime}
                                onChange={(e) => setEditingExpiryTime(e.target.value)}
                                className='w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-orange-500 focus:border-transparent'
                                title='选择到期时间'
                              />
                              <div className='flex gap-1'>
                                <button
                                  onClick={() => handleSaveExpiry(user.username)}
                                  className='px-2 py-1 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded transition-colors'
                                  title='保存到期时间'
                                >
                                  保存
                                </button>
                                <button
                                  onClick={() => handleClearExpiry(user.username)}
                                  className='px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded transition-colors'
                                  title='清除到期时间（永不过期）'
                                >
                                  清除
                                </button>
                                <button
                                  onClick={() => handleCancelEditExpiry()}
                                  className='px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded transition-colors'
                                  title='取消编辑'
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            // 显示模式：点击可编辑
                            <div 
                              className='cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-2 py-1 transition-colors'
                              onClick={() => handleStartEditExpiry(user.username)}
                              title='点击编辑到期时间'
                            >
                              {user.expires_at ? (
                                <div className='flex flex-col'>
                                  <span className='text-xs'>
                                    {new Date(user.expires_at).toLocaleDateString('zh-CN')}
                                  </span>
                                  <span className='text-xs text-gray-500 dark:text-gray-400'>
                                    {new Date(user.expires_at).toLocaleTimeString('zh-CN', {
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    })}
                                  </span>
                                </div>
                              ) : (
                                <span className='text-xs text-gray-500 dark:text-gray-400'>永不过期</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
                          {/* 修改密码按钮 */}
                          {canChangePassword && (
                            <button
                              onClick={() =>
                                handleShowChangePasswordForm(user.username)
                              }
                              className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/40 dark:hover:bg-blue-900/60 dark:text-blue-200 transition-colors'
                            >
                              修改密码
                            </button>
                          )}

                          {canOperate && (
                            <>
                              {/* 封禁/解封按钮 */}
                              {user.role !== 'owner' &&
                                (!user.banned ? (
                                  <button
                                    onClick={() => handleBanUser(user.username)}
                                    className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-300 transition-colors'
                                  >
                                    封禁
                                  </button>
                                ) : (
                                  <button
                                    onClick={() =>
                                      handleUnbanUser(user.username)
                                    }
                                    className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/40 dark:hover:bg-green-900/60 dark:text-green-300 transition-colors'
                                  >
                                    解封
                                  </button>
                                ))}
                            </>
                          )}
                          {/* 删除用户按钮 - 放在最后，使用更明显的红色样式 */}
                          {canDeleteUser && (
                            <button
                              onClick={() => handleDeleteUser(user.username)}
                              className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 transition-colors'
                            >
                              删除用户
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })()}
          </table>
        </div>
      </div>
    </div>
  );
};

// 视频源配置组件
const VideoSourceConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { showSuccess, showError } = useToast();
  const [sources, setSources] = useState<DataSource[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [newSource, setNewSource] = useState<DataSource>({
    name: '',
    key: '',
    api: '',
    detail: '',
    disabled: false,
    from: 'config',
    is_adult: false, // 默认不是成人内容
  });

  // dnd-kit 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 轻微位移即可触发
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 长按 150ms 后触发，避免与滚动冲突
        tolerance: 5,
      },
    })
  );

  // 初始化 - 从 API 获取源配置
  useEffect(() => {
    const loadSources = async () => {
      try {
        const resp = await fetch('/api/admin/source');
        if (resp.ok) {
          const data = await resp.json();
          if (data.sources) {
            // 转换数据格式以兼容现有组件
            const formattedSources = data.sources.map((source: any) => ({
              key: source.source_key || source.key,
              name: source.name,
              api: source.api,
              detail: source.detail,
              disabled: source.disabled,
              from: source.from_type || source.from,
              is_adult: source.is_adult
            }));
            setSources(formattedSources);
          }
        }
      } catch (error) {
        console.error('Failed to load sources:', error);
      }
      // 进入时重置 orderChanged
      setOrderChanged(false);
    };

    if (config) {
      loadSources();
    }
  }, [config]);

  // 通用 API 请求
  const callSourceApi = async (body: Record<string, any>) => {
    try {
      const resp = await fetch('/api/admin/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${resp.status}`);
      }

      // 获取响应数据
      const responseData = await resp.json();

      // 对于批量操作，直接返回响应数据，不刷新配置（由调用者处理）
      if (body.action === 'batch_delete' || body.action === 'batch_add') {
        return responseData;
      }

      // 其他操作成功后刷新配置
      await refreshConfig();
      return responseData;
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
      throw err; // 向上抛出方便调用处判断
    }
  };

  const handleToggleEnable = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    callSourceApi({ action, key }).catch(() => {
      console.error('操作失败', action, key);
    });
  };

  const handleDelete = (key: string) => {
    // 检查是否为示例源
    const source = sources.find(s => s.key === key);
    if (source?.from === 'config') {
      showError('示例源不可删除，这些源用于演示功能');
      return;
    }

    callSourceApi({ action: 'delete', key }).catch(() => {
      console.error('操作失败', 'delete', key);
    });
  };

  const handleAddSource = () => {
    if (!newSource.name || !newSource.key || !newSource.api) return;
    callSourceApi({
      action: 'add',
      key: newSource.key,
      name: newSource.name,
      api: newSource.api,
      detail: newSource.detail,
      is_adult: newSource.is_adult, // 传递成人内容标记
    })
      .then(() => {
        setNewSource({
          name: '',
          key: '',
          api: '',
          detail: '',
          disabled: false,
          from: 'custom',
          is_adult: false, // 重置为默认值
        });
        setShowAddForm(false);
      })
      .catch(() => {
        console.error('操作失败', 'add', newSource);
      });
  };

  // 批量操作相关函数
  const handleToggleBatchMode = () => {
    setBatchMode(!batchMode);
    setSelectedSources(new Set()); // 切换模式时清空选择
  };

  const handleSelectSource = (key: string, checked: boolean) => {
    const newSelected = new Set(selectedSources);
    if (checked) {
      newSelected.add(key);
    } else {
      newSelected.delete(key);
    }
    setSelectedSources(newSelected);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // 只选择可删除的视频源（排除示例源）
      const deletableSources = sources.filter(source => source.from !== 'config');
      setSelectedSources(new Set(deletableSources.map(source => source.key)));
    } else {
      setSelectedSources(new Set());
    }
  };

  const handleBatchDelete = async () => {
    if (selectedSources.size === 0) {
      showError('请先选择要删除的视频源');
      return;
    }

    const selectedArray = Array.from(selectedSources);
    const result = await Swal.fire({
      title: '确认批量删除',
      text: `即将删除 ${selectedArray.length} 个视频源，此操作不可撤销！`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280'
    });

    if (!result.isConfirmed) return;

    // 显示删除进度
    Swal.fire({
      title: '正在删除...',
      text: '请稍候，正在批量删除视频源',
      showConfirmButton: false,
      showCancelButton: false,
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    try {
      // 使用新的批量删除API
      const response = await callSourceApi({ 
        action: 'batch_delete', 
        keys: selectedArray 
      });

      // 处理批量删除结果
      const { results, total, success_count, failed_count } = response;
      
      if (failed_count === 0) {
        // 全部删除成功
        Swal.close(); // 关闭"正在删除..."弹框
        showSuccess(`成功删除 ${success_count} 个视频源`);
        setSelectedSources(new Set()); // 清空选择
        setBatchMode(false); // 退出批量模式
      } else {
        // 部分删除失败，显示详细结果
        const failedResults = results.filter((r: any) => !r.success);
        const errors = failedResults.map((r: any) => {
          const sourceName = sources.find(s => s.key === r.key)?.name || r.key;
          return `${sourceName}: ${r.error}`;
        });

        await Swal.fire({
          title: '删除完成',
          html: `
            <div class="text-left">
              <p class="text-green-600 mb-2">✅ 成功删除: ${success_count} 个</p>
              <p class="text-red-600 mb-2">❌ 删除失败: ${failed_count} 个</p>
              ${errors.length > 0 ? `
                <details class="mt-3">
                  <summary class="cursor-pointer text-gray-600">查看错误详情</summary>
                  <div class="mt-2 text-sm text-gray-500 max-h-32 overflow-y-auto">
                    ${errors.map((err: string) => `<div class="py-1">${err}</div>`).join('')}
                  </div>
                </details>
              ` : ''}
            </div>
          `,
          icon: success_count > 0 ? 'warning' : 'error',
          confirmButtonText: '确定'
        });

        // 只保留删除失败的选择项
        const failedKeys: Set<string> = new Set(failedResults.map((r: any) => r.key as string));
        setSelectedSources(failedKeys);
      }
    } catch (error) {
      // 批量删除API调用失败，回退到逐个删除
      console.warn('批量删除API失败，回退到逐个删除:', error);
      
      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < selectedArray.length; i++) {
        const key = selectedArray[i];
        try {
          await callSourceApi({ action: 'delete', key });
          successCount++;

          // 更新进度
          Swal.update({
            title: '正在删除...',
            text: `进度: ${i + 1}/${selectedArray.length}`,
          });
        } catch (error) {
          errorCount++;
          const sourceName = sources.find(s => s.key === key)?.name || key;
          errors.push(`${sourceName}: ${error instanceof Error ? error.message : '删除失败'}`);
        }
      }

      // 显示删除结果
      if (errorCount === 0) {
        Swal.close(); // 关闭"正在删除..."弹框
        showSuccess(`成功删除 ${successCount} 个视频源`);
        setSelectedSources(new Set());
        setBatchMode(false);
      } else {
        await Swal.fire({
          title: '删除完成',
          html: `
            <div class="text-left">
              <p class="text-green-600 mb-2">✅ 成功删除: ${successCount} 个</p>
              <p class="text-red-600 mb-2">❌ 删除失败: ${errorCount} 个</p>
              ${errors.length > 0 ? `
                <details class="mt-3">
                  <summary class="cursor-pointer text-gray-600">查看错误详情</summary>
                  <div class="mt-2 text-sm text-gray-500 max-h-32 overflow-y-auto">
                    ${errors.map(err => `<div class="py-1">${err}</div>`).join('')}
                  </div>
                </details>
              ` : ''}
            </div>
          `,
          icon: successCount > 0 ? 'warning' : 'error',
          confirmButtonText: '确定'
        });

        // 清空已成功删除的选择项
        const failedKeys = new Set(
          errors.map(err => {
            const keyMatch = err.split(':')[0];
            return sources.find(s => s.name === keyMatch)?.key;
          }).filter((key): key is string => Boolean(key))
        );
        setSelectedSources(failedKeys);
      }
    }

    await refreshConfig();
  };

  // 导出配置
  const handleExportConfig = () => {
    try {
      // 构建符合要求的配置格式
      const exportConfig = {
        cache_time: config?.SiteConfig?.SiteInterfaceCacheTime || 7200,
        api_site: {} as Record<string, any>
      };

      // 将视频源转换为config.json格式
      sources.forEach(source => {
        if (!source.disabled) {
          exportConfig.api_site[source.key] = {
            api: source.api,
            name: source.name,
            ...(source.detail && { detail: source.detail }),
            ...(source.is_adult !== undefined && { is_adult: source.is_adult }) // 确保导出 is_adult 字段
          };
        }
      });

      // 生成JSON文件并下载
      const dataStr = JSON.stringify(exportConfig, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `config_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showSuccess('配置文件已导出到下载文件夹');
    } catch (error) {
      showError('导出失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  // 导入配置
  const handleImportConfig = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 检查文件类型
    if (!file.name.toLowerCase().endsWith('.json')) {
      showError('请选择JSON文件');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const importConfig = JSON.parse(content);

        // 验证配置格式
        if (!importConfig.api_site || typeof importConfig.api_site !== 'object') {
          showError('配置文件格式错误：缺少 api_site 字段');
          return;
        }

        // 确认导入
        const result = await Swal.fire({
          title: '确认导入',
          text: `检测到 ${Object.keys(importConfig.api_site).length} 个视频源，是否继续导入？`,
          icon: 'question',
          showCancelButton: true,
          confirmButtonText: '确认导入',
          cancelButtonText: '取消',
          confirmButtonColor: '#059669',
          cancelButtonColor: '#6b7280'
        });

        if (!result.isConfirmed) return;

        // 显示导入进度
        Swal.fire({
          title: '正在导入...',
          text: '请稍候，正在批量导入视频源',
          showConfirmButton: false,
          showCancelButton: false,
          allowOutsideClick: false,
          didOpen: () => {
            Swal.showLoading();
          }
        });

        try {
          // 准备批量导入数据
          const sources = [];
          const validationErrors: string[] = [];

          for (const [key, source] of Object.entries(importConfig.api_site)) {
            // 类型检查和验证
            if (!source || typeof source !== 'object' || Array.isArray(source)) {
              validationErrors.push(`${key}: 无效的配置对象`);
              continue;
            }

            const sourceObj = source as { api?: string; name?: string; detail?: string; is_adult?: boolean };

            if (!sourceObj.api || !sourceObj.name) {
              validationErrors.push(`${key}: 缺少必要字段 api 或 name`);
              continue;
            }

            sources.push({
              key: key,
              name: sourceObj.name,
              api: sourceObj.api,
              detail: sourceObj.detail || '',
              is_adult: sourceObj.is_adult || false
            });
          }

          // 如果有验证错误，显示错误并停止导入
          if (validationErrors.length > 0) {
            await Swal.fire({
              title: '配置验证失败',
              html: `
                <div class="text-left">
                  <p class="text-red-600 mb-2">发现 ${validationErrors.length} 个配置错误：</p>
                  <div class="mt-2 text-sm text-gray-500 max-h-32 overflow-y-auto">
                    ${validationErrors.map(err => `<div class="py-1">${err}</div>`).join('')}
                  </div>
                </div>
              `,
              icon: 'error',
              confirmButtonText: '确定'
            });
            return;
          }

          // 使用批量导入 API
          const response = await callSourceApi({
            action: 'batch_add',
            sources: sources
          });

          // 处理批量导入结果
          const { results, total, success_count, failed_count } = response;
          
          if (failed_count === 0) {
            // 全部导入成功
            Swal.close(); // 关闭"正在导入..."弹框
            showSuccess(`成功导入 ${success_count} 个视频源`);
          } else {
            // 部分导入失败，显示详细结果
            const failedResults = results.filter((r: any) => !r.success);
            const errors = failedResults.map((r: any) => `${r.key}: ${r.error}`);

            await Swal.fire({
              title: '导入完成',
              html: `
                <div class="text-left">
                  <p class="text-green-600 mb-2">✅ 成功导入: ${success_count} 个</p>
                  <p class="text-red-600 mb-2">❌ 导入失败: ${failed_count} 个</p>
                  ${errors.length > 0 ? `
                    <details class="mt-3">
                      <summary class="cursor-pointer text-gray-600">查看错误详情</summary>
                      <div class="mt-2 text-sm text-gray-500 max-h-32 overflow-y-auto">
                        ${errors.map((err: string) => `<div class="py-1">${err}</div>`).join('')}
                      </div>
                    </details>
                  ` : ''}
                </div>
              `,
              icon: success_count > 0 ? 'warning' : 'error',
              confirmButtonText: '确定'
            });
          }
        } catch (error) {
          // 批量导入 API 调用失败，回退到逐个导入
          console.warn('批量导入API失败，回退到逐个导入:', error);
          
          let successCount = 0;
          let errorCount = 0;
          const errors: string[] = [];

          for (const [key, source] of Object.entries(importConfig.api_site)) {
            try {
              // 类型检查和验证
              if (!source || typeof source !== 'object' || Array.isArray(source)) {
                throw new Error(`${key}: 无效的配置对象`);
              }

              const sourceObj = source as { api?: string; name?: string; detail?: string; is_adult?: boolean };

              if (!sourceObj.api || !sourceObj.name) {
                throw new Error(`${key}: 缺少必要字段 api 或 name`);
              }

              await callSourceApi({
                action: 'add',
                key: key,
                name: sourceObj.name,
                api: sourceObj.api,
                detail: sourceObj.detail || '',
                is_adult: sourceObj.is_adult || false
              });
              successCount++;

              // 更新进度
              Swal.update({
                title: '正在导入...',
                text: `进度: ${successCount + errorCount}/${Object.keys(importConfig.api_site).length}`,
              });
            } catch (error) {
              errorCount++;
              errors.push(`${key}: ${error instanceof Error ? error.message : '未知错误'}`);
            }
          }

          // 显示回退导入结果
          if (errorCount === 0) {
            Swal.close(); // 关闭"正在导入..."弹框
            showSuccess(`成功导入 ${successCount} 个视频源`);
          } else {
            await Swal.fire({
              title: '导入完成',
              html: `
                <div class="text-left">
                  <p class="text-green-600 mb-2">✅ 成功导入: ${successCount} 个</p>
                  <p class="text-red-600 mb-2">❌ 导入失败: ${errorCount} 个</p>
                  ${errors.length > 0 ? `
                    <details class="mt-3">
                      <summary class="cursor-pointer text-gray-600">查看错误详情</summary>
                      <div class="mt-2 text-sm text-gray-500 max-h-32 overflow-y-auto">
                        ${errors.map(err => `<div class="py-1">${err}</div>`).join('')}
                      </div>
                    </details>
                  ` : ''}
                </div>
              `,
              icon: successCount > 0 ? 'warning' : 'error',
              confirmButtonText: '确定'
            });
          }
        }

      } catch (error) {
        showError('配置文件解析失败: ' + (error instanceof Error ? error.message : '文件格式错误'));
      }
    };

    reader.onerror = () => {
      showError('文件读取失败');
    };

    reader.readAsText(file);

    // 清空input，允许重复选择同一文件
    event.target.value = '';
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sources.findIndex((s) => s.key === active.id);
    const newIndex = sources.findIndex((s) => s.key === over.id);
    setSources((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = sources.map((s) => s.key);
    callSourceApi({ action: 'sort', order })
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => {
        console.error('操作失败', 'sort', order);
      });
  };

  // 可拖拽行封装 (dnd-kit)
  const DraggableRow = ({ source }: { source: DataSource }) => {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: source.key });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    } as React.CSSProperties;

    return (
      <tr
        ref={setNodeRef}
        style={style}
        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors select-none'
      >
        {/* 拖拽手柄 */}
        <td
          className='px-2 py-4 cursor-grab text-gray-400'
          style={{ touchAction: 'none' }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </td>

        {/* 批量选择复选框 */}
        {batchMode && (
          <td className='px-4 py-4 whitespace-nowrap'>
            <input
              type='checkbox'
              checked={selectedSources.has(source.key)}
              onChange={(e) => handleSelectSource(source.key, e.target.checked)}
              disabled={source.from === 'config'} // 禁用示例源选择
              className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 disabled:opacity-50'
            />
          </td>
        )}
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          <div className="flex items-center space-x-2">
            <span>{source.name}</span>
            {source.from === 'config' && (
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                示例源
              </span>
            )}
          </div>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {source.key}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-[12rem] truncate'
          title={source.api}
        >
          <a
            href={source.api}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {source.api}
          </a>
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-[8rem] truncate'
          title={source.detail || '-'}
        >
          {source.detail ? (
            <a
              href={source.detail}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {source.detail}
            </a>
          ) : (
            <span className="text-gray-400 dark:text-gray-500">-</span>
          )}
        </td>
        <td className='px-6 py-4 whitespace-nowrap max-w-[1rem]'>
          <span
            className={`px-2 py-1 text-xs rounded-full ${!source.disabled
                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
              }`}
          >
            {!source.disabled ? '启用中' : '已禁用'}
          </span>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
          <button
            onClick={() => handleToggleEnable(source.key)}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${!source.disabled
                ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60'
                : 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60'
              } transition-colors`}
          >
            {!source.disabled ? '禁用' : '启用'}
          </button>
          {source.from !== 'config' ? (
            <button
              onClick={() => handleDelete(source.key)}
              className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700/40 dark:hover:bg-gray-700/60 dark:text-gray-200 transition-colors'
            >
              删除
            </button>
          ) : (
            <span className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400'>
              不可删除
            </span>
          )}
        </td>
      </tr>
    );
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 视频源管理工具栏 */}
      <div className='flex items-center justify-between flex-wrap gap-3'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          视频源列表
        </h4>

        <div className='flex items-center gap-2 flex-wrap'>
          {/* 批量操作区域 */}
          {!batchMode ? (
            <>
              {/* 普通模式按钮 */}
              <button
                onClick={handleToggleBatchMode}
                className='inline-flex items-center px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors'
              >
                ☑️ 批量选择
              </button>

              {/* 导入导出按钮 */}
              <div className='flex items-center gap-1 border-l border-gray-300 dark:border-gray-600 pl-2'>
                <label className='relative'>
                  <input
                    type='file'
                    accept='.json'
                    onChange={handleImportConfig}
                    className='absolute inset-0 w-full h-full opacity-0 cursor-pointer'
                  />
                  <span className='inline-flex items-center px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors cursor-pointer'>
                    📂 导入
                  </span>
                </label>

                <button
                  onClick={handleExportConfig}
                  className='inline-flex items-center px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors'
                >
                  📤 导出
                </button>
              </div>

              {/* 添加视频源按钮 */}
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className='px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded-lg transition-colors'
              >
                {showAddForm ? '取消' : '➕ 添加'}
              </button>
            </>
          ) : (
            <>
              {/* 批量模式按钮 */}
              <button
                onClick={handleToggleBatchMode}
                className='inline-flex items-center px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded-lg transition-colors'
              >
                ❌ 退出批量
              </button>

              <div className='flex items-center gap-1 border-l border-gray-300 dark:border-gray-600 pl-2'>
                <span className='text-xs text-gray-500 dark:text-gray-400'>
                  已选 {selectedSources.size} 个
                </span>

                <button
                  onClick={handleBatchDelete}
                  disabled={selectedSources.size === 0}
                  className='inline-flex items-center px-3 py-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white text-sm rounded-lg transition-colors'
                >
                  🗑️ 批量删除
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {showAddForm && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <input
              type='text'
              placeholder='名称'
              value={newSource.name}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, name: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Key'
              value={newSource.key}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, key: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='API 地址'
              value={newSource.api}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, api: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Detail 地址（选填）'
              value={newSource.detail}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, detail: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />

            {/* 成人内容标记复选框 */}
            <div className='flex items-center space-x-2'>
              <input
                type='checkbox'
                id='is_adult'
                checked={newSource.is_adult || false}
                onChange={(e) =>
                  setNewSource((prev) => ({ ...prev, is_adult: e.target.checked }))
                }
                className='w-4 h-4 text-red-600 bg-gray-100 border-gray-300 rounded focus:ring-red-500 dark:bg-gray-700 dark:border-gray-600'
              />
              <label
                htmlFor='is_adult'
                className='text-sm font-medium text-gray-900 dark:text-gray-300'
              >
                🔞 成人内容资源站
              </label>
            </div>
          </div>
          <div className='flex justify-end'>
            <button
              onClick={handleAddSource}
              disabled={!newSource.name || !newSource.key || !newSource.api}
              className='w-full sm:w-auto px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors'
            >
              添加
            </button>
          </div>
        </div>
      )}

      {/* 视频源表格 */}
      <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-[28rem] overflow-y-auto overflow-x-auto'>
        <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
          <thead className='bg-gray-50 dark:bg-gray-900'>
            <tr>
              {/* 拖拽手柄列 */}
              <th className='w-8' />

              {/* 批量选择列 */}
              {batchMode && (
                <th className='w-12 px-4 py-3'>
                  <input
                    type='checkbox'
                    checked={selectedSources.size > 0 && selectedSources.size === sources.length}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                  />
                </th>
              )}

              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                名称
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                Key
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                API 地址
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                Detail 地址
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                状态
              </th>
              <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                操作
              </th>
            </tr>
          </thead>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            autoScroll={false}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          >
            <SortableContext
              items={sources.map((s) => s.key)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {sources.map((source) => (
                  <DraggableRow key={source.key} source={source} />
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
        </table>
      </div>

      {/* 保存排序按钮 */}
      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            className='px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors'
          >
            保存排序
          </button>
        </div>
      )}
    </div>
  );
};

// 新增站点配置组件
const SiteConfigComponent = ({ config }: { config: AdminConfig | null }) => {
  const { showSuccess, showError } = useToast();
  const [siteSettings, setSiteSettings] = useState<SiteConfig>({
    SiteName: '',
    Announcement: '',
    SearchDownstreamMaxPage: 1,
    SiteInterfaceCacheTime: 7200,
    ImageProxy: '',
    DoubanProxy: '',
  });
  // 保存状态
  const [saving, setSaving] = useState(false);

  // 检测存储类型是否为 d1 或 upstash
  const isD1Storage =
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.STORAGE_TYPE === 'd1';
  const isUpstashStorage =
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.STORAGE_TYPE === 'upstash';

  useEffect(() => {
    if (config?.SiteConfig) {
      setSiteSettings({
        ...config.SiteConfig,
        ImageProxy: config.SiteConfig.ImageProxy || '',
        DoubanProxy: config.SiteConfig.DoubanProxy || '',
      });
    }
  }, [config]);

  // 保存站点配置
  const handleSave = async () => {
    try {
      setSaving(true);
      const resp = await fetch('/api/admin/site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...siteSettings }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `保存失败: ${resp.status}`);
      }

      showSuccess('保存成功, 请刷新页面');
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 站点名称 */}
      <div>
        <label
          className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${isD1Storage || isUpstashStorage ? 'opacity-50' : ''
            }`}
        >
          站点名称
          {isD1Storage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (D1 环境下请通过环境变量修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (Upstash 环境下请通过环境变量修改)
            </span>
          )}
        </label>
        <input
          type='text'
          value={siteSettings.SiteName}
          onChange={(e) =>
            !isD1Storage &&
            !isUpstashStorage &&
            setSiteSettings((prev) => ({ ...prev, SiteName: e.target.value }))
          }
          disabled={isD1Storage || isUpstashStorage}
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent ${isD1Storage || isUpstashStorage
              ? 'opacity-50 cursor-not-allowed'
              : ''
            }`}
        />
      </div>

      {/* 站点公告 */}
      <div>
        <label
          className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${isD1Storage || isUpstashStorage ? 'opacity-50' : ''
            }`}
        >
          站点公告
          {isD1Storage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (D1 环境下请通过环境变量修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (Upstash 环境下请通过环境变量修改)
            </span>
          )}
        </label>
        <textarea
          value={siteSettings.Announcement}
          onChange={(e) =>
            !isD1Storage &&
            !isUpstashStorage &&
            setSiteSettings((prev) => ({
              ...prev,
              Announcement: e.target.value,
            }))
          }
          disabled={isD1Storage || isUpstashStorage}
          rows={3}
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent ${isD1Storage || isUpstashStorage
              ? 'opacity-50 cursor-not-allowed'
              : ''
            }`}
        />
      </div>

      {/* 搜索接口可拉取最大页数 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          搜索接口可拉取最大页数
        </label>
        <input
          type='number'
          min={1}
          value={siteSettings.SearchDownstreamMaxPage}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              SearchDownstreamMaxPage: Number(e.target.value),
            }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 站点接口缓存时间 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          站点接口缓存时间（秒）
        </label>
        <input
          type='number'
          min={1}
          value={siteSettings.SiteInterfaceCacheTime}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              SiteInterfaceCacheTime: Number(e.target.value),
            }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 图片代理 */}
      <div>
        <label
          className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${isD1Storage || isUpstashStorage ? 'opacity-50' : ''
            }`}
        >
          图片代理前缀
          {isD1Storage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (D1 环境下请通过环境变量修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (Upstash 环境下请通过环境变量修改)
            </span>
          )}
        </label>
        <input
          type='text'
          placeholder='例如: https://imageproxy.example.com/?url='
          value={siteSettings.ImageProxy}
          onChange={(e) =>
            !isD1Storage &&
            !isUpstashStorage &&
            setSiteSettings((prev) => ({
              ...prev,
              ImageProxy: e.target.value,
            }))
          }
          disabled={isD1Storage || isUpstashStorage}
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent ${isD1Storage || isUpstashStorage
              ? 'opacity-50 cursor-not-allowed'
              : ''
            }`}
        />
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          用于代理图片访问，解决跨域或访问限制问题。留空则不使用代理。
        </p>
      </div>

      {/* 豆瓣代理设置 */}
      <div>
        <label
          className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${isD1Storage || isUpstashStorage ? 'opacity-50' : ''
            }`}
        >
          豆瓣代理地址
          {isD1Storage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (D1 环境下请通过环境变量修改)
            </span>
          )}
          {isUpstashStorage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (Upstash 环境下请通过环境变量修改)
            </span>
          )}
        </label>
        <input
          type='text'
          placeholder='例如: https://proxy.example.com/fetch?url='
          value={siteSettings.DoubanProxy}
          onChange={(e) =>
            !isD1Storage &&
            !isUpstashStorage &&
            setSiteSettings((prev) => ({
              ...prev,
              DoubanProxy: e.target.value,
            }))
          }
          disabled={isD1Storage || isUpstashStorage}
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent ${isD1Storage || isUpstashStorage
              ? 'opacity-50 cursor-not-allowed'
              : ''
            }`}
        />
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          用于代理豆瓣数据访问，解决跨域或访问限制问题。留空则使用服务端API。
        </p>
      </div>

      {/* 操作按钮 */}
      <div className='flex justify-end'>
        <button
          onClick={handleSave}
          disabled={saving || isD1Storage || isUpstashStorage}
          className={`px-4 py-2 ${saving || isD1Storage || isUpstashStorage
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700'
            } text-white rounded-lg transition-colors`}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
};

function AdminPageClient() {
  const router = useRouter();
  const { showError, showSuccess } = useToast();
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'owner' | 'admin' | null>(null);
  const [expandedTabs, setExpandedTabs] = useState<{ [key: string]: boolean }>({
    userConfig: false,
    videoSource: false,
    siteConfig: false,
  });

  // 获取管理员配置
  // showLoading 用于控制是否在请求期间显示整体加载骨架。
  const fetchConfig = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }

      const response = await fetch(`/api/admin/config`);

      if (!response.ok) {
        const data = (await response.json()) as any;
        throw new Error(`获取配置失败: ${data.error}`);
      }

      const data = (await response.json()) as AdminConfigResult;
      setConfig(data.Config);
      setRole(data.Role);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取配置失败';
      showError(msg);
      setError(msg);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // 首次加载时显示骨架
    fetchConfig(true);
  }, [fetchConfig]);

  // 切换标签展开状态
  const toggleTab = (tabKey: string) => {
    setExpandedTabs((prev) => ({
      ...prev,
      [tabKey]: !prev[tabKey],
    }));
  };

  // 新增: 重置配置处理函数
  const handleResetConfig = async () => {
    const { isConfirmed } = await Swal.fire({
      title: '确认重置配置',
      text: '此操作将重置用户封禁和管理员设置、自定义视频源，站点配置将重置为默认值，是否继续？',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '确认',
      cancelButtonText: '取消',
    });
    if (!isConfirmed) return;

    try {
      const response = await fetch(`/api/admin/reset`);
      if (!response.ok) {
        throw new Error(`重置失败: ${response.status}`);
      }
      showSuccess('重置成功，请刷新页面！');
    } catch (err) {
      showError(err instanceof Error ? err.message : '重置失败');
    }
  };

  if (loading) {
    return (
      <PageLayout activePath='/admin'>
        <div className='px-2 sm:px-10 py-4 sm:py-8'>
          <div className='max-w-[95%] mx-auto'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8'>
              管理员设置
            </h1>
            <div className='space-y-4'>
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className='h-20 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse'
                />
              ))}
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    // 错误已通过 SweetAlert2 展示，此处直接返回空
    return null;
  }

  return (
    <PageLayout activePath='/admin'>
      <div className='px-2 sm:px-10 py-4 sm:py-8'>
        <div className='max-w-[95%] mx-auto'>
          {/* 标题 + 重置配置按钮 */}
          <div className='flex items-center gap-2 mb-8'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
              管理员设置
            </h1>
            {config && role === 'owner' && (
              <button
                onClick={handleResetConfig}
                className='px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded-md transition-colors'
              >
                重置配置
              </button>
            )}
            <button
              onClick={() => router.push('/config')}
              className='px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-md transition-colors flex items-center gap-1'
            >
              <Tv size={14} />
              <span>TVBox 配置</span>
            </button>
          </div>

          {/* 站点配置标签 */}
          <CollapsibleTab
            title='站点配置'
            icon={
              <Settings
                size={20}
                className='text-gray-600 dark:text-gray-400'
              />
            }
            isExpanded={expandedTabs.siteConfig}
            onToggle={() => toggleTab('siteConfig')}
          >
            <SiteConfigComponent config={config} />
          </CollapsibleTab>

          <div className='space-y-4'>
            {/* 用户配置标签 */}
            <CollapsibleTab
              title='用户配置'
              icon={
                <Users size={20} className='text-gray-600 dark:text-gray-400' />
              }
              isExpanded={expandedTabs.userConfig}
              onToggle={() => toggleTab('userConfig')}
            >
              <UserConfig
                config={config}
                role={role}
                refreshConfig={fetchConfig}
              />
            </CollapsibleTab>

            {/* 视频源配置标签 */}
            <CollapsibleTab
              title='视频源配置'
              icon={
                <Video size={20} className='text-gray-600 dark:text-gray-400' />
              }
              isExpanded={expandedTabs.videoSource}
              onToggle={() => toggleTab('videoSource')}
            >
              <VideoSourceConfig config={config} refreshConfig={fetchConfig} />
            </CollapsibleTab>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <AdminPageClient />
    </Suspense>
  );
}
