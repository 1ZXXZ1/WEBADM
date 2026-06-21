import type { APIOperation } from '@/types';

export const API_OPERATIONS: APIOperation[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // USERS
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'user.create',
    label: 'Создать пользователя',
    category: 'users',
    icon: 'UserPlus',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
      { name: 'password', label: 'Пароль', type: 'string' },
      { name: 'must_change_at_next_login', label: 'Сменить пароль при входе', type: 'boolean', default: false },
      { name: 'random_password', label: 'Случайный пароль', type: 'boolean', default: false },
      { name: 'smartcard_required', label: 'Требуется смарт-карта', type: 'boolean', default: false },
      { name: 'use_username_as_cn', label: 'Имя как CN', type: 'boolean', default: false },
      { name: 'userou', label: 'Подразделение (OU)', type: 'string' },
      { name: 'surname', label: 'Фамилия', type: 'string' },
      { name: 'given_name', label: 'Имя', type: 'string' },
      { name: 'initials', label: 'Инициалы', type: 'string' },
      { name: 'profile_path', label: 'Путь профиля', type: 'string' },
      { name: 'script_path', label: 'Путь скрипта', type: 'string' },
      { name: 'home_drive', label: 'Домашний диск', type: 'string' },
      { name: 'home_directory', label: 'Домашняя директория', type: 'string' },
      { name: 'job_title', label: 'Должность', type: 'string' },
      { name: 'department', label: 'Отдел', type: 'string' },
      { name: 'company', label: 'Компания', type: 'string' },
      { name: 'description', label: 'Описание', type: 'string' },
      { name: 'mail_address', label: 'Электронная почта', type: 'string' },
      { name: 'internet_address', label: 'Интернет-адрес', type: 'string' },
      { name: 'telephone_number', label: 'Телефон', type: 'string' },
      { name: 'physical_delivery_office', label: 'Офис доставки', type: 'string' },
      { name: 'rfc2307_from_nss', label: 'RFC2307 из NSS', type: 'boolean', default: false },
      { name: 'nis_domain', label: 'NIS-домен', type: 'string' },
      { name: 'unix_home', label: 'Домашняя директория Unix', type: 'string' },
      { name: 'uid', label: 'UID', type: 'string' },
      { name: 'uid_number', label: 'Номер UID', type: 'number', default: 0 },
      { name: 'gid_number', label: 'Номер GID', type: 'number', default: 0 },
      { name: 'gecos', label: 'GECOS', type: 'string' },
      { name: 'login_shell', label: 'Оболочка входа', type: 'string' },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'given_name', label: 'Имя' },
      { name: 'surname', label: 'Фамилия' },
      { name: 'mail_address', label: 'Электронная почта' },
      { name: 'department', label: 'Отдел' },
      { name: 'company', label: 'Компания' },
      { name: 'description', label: 'Описание' },
      { name: 'job_title', label: 'Должность' },
      { name: 'telephone_number', label: 'Телефон' },
    ],
  },
  {
    method: 'user.edit',
    label: 'Редактировать',
    category: 'users',
    icon: 'PenLine',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
      { name: 'given_name', label: 'Имя', type: 'string' },
      { name: 'surname', label: 'Фамилия', type: 'string' },
      { name: 'initials', label: 'Инициалы', type: 'string' },
      { name: 'display_name', label: 'Отображаемое имя', type: 'string' },
      { name: 'description', label: 'Описание', type: 'string' },
      { name: 'mail', label: 'Электронная почта', type: 'string' },
      { name: 'telephone_number', label: 'Телефон', type: 'string' },
      { name: 'department', label: 'Отдел', type: 'string' },
      { name: 'company', label: 'Компания', type: 'string' },
      { name: 'job_title', label: 'Должность', type: 'string' },
      { name: 'profile_path', label: 'Путь профиля', type: 'string' },
      { name: 'script_path', label: 'Путь скрипта', type: 'string' },
      { name: 'home_drive', label: 'Домашний диск', type: 'string' },
      { name: 'home_directory', label: 'Домашняя директория', type: 'string' },
      { name: 'physical_delivery_office', label: 'Офис доставки', type: 'string' },
      { name: 'internet_address', label: 'Интернет-адрес', type: 'string' },
      { name: 'street_address', label: 'Адрес улицы', type: 'string' },
      { name: 'city', label: 'Город', type: 'string' },
      { name: 'state', label: 'Область/Штат', type: 'string' },
      { name: 'postal_code', label: 'Почтовый индекс', type: 'string' },
      { name: 'country', label: 'Страна', type: 'string' },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'given_name', label: 'Имя' },
      { name: 'surname', label: 'Фамилия' },
      { name: 'display_name', label: 'Отображаемое имя' },
      { name: 'mail', label: 'Электронная почта' },
      { name: 'department', label: 'Отдел' },
      { name: 'company', label: 'Компания' },
      { name: 'description', label: 'Описание' },
      { name: 'job_title', label: 'Должность' },
      { name: 'telephone_number', label: 'Телефон' },
    ],
  },
  {
    method: 'user.delete',
    label: 'Удалить пользователя',
    category: 'users',
    icon: 'UserMinus',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'user.enable',
    label: 'Включить',
    category: 'users',
    icon: 'UserCheck',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'enabled', label: 'Включён' },
    ],
  },
  {
    method: 'user.disable',
    label: 'Отключить',
    category: 'users',
    icon: 'UserX',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'disabled', label: 'Отключён' },
    ],
  },
  {
    method: 'user.unlock',
    label: 'Разблокировать',
    category: 'users',
    icon: 'KeyRound',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'unlocked', label: 'Разблокирован' },
    ],
  },
  {
    method: 'user.setpassword',
    label: 'Установить пароль',
    category: 'users',
    icon: 'Lock',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
      { name: 'new_password', label: 'Новый пароль', type: 'string', required: true },
      { name: 'must_change_at_next_login', label: 'Сменить при входе', type: 'boolean', default: false },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'password_set', label: 'Пароль установлен' },
    ],
  },
  {
    method: 'user.list',
    label: 'Список пользователей',
    category: 'users',
    icon: 'Users',
    params: [
      { name: 'verbose', label: 'Подробно', type: 'boolean', default: false },
      { name: 'base_dn', label: 'Базовый DN', type: 'string' },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'user.show',
    label: 'Просмотр',
    category: 'users',
    icon: 'Eye',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
      { name: 'attributes', label: 'Атрибуты', type: 'string' },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'given_name', label: 'Имя' },
      { name: 'surname', label: 'Фамилия' },
      { name: 'display_name', label: 'Отображаемое имя' },
      { name: 'mail', label: 'Электронная почта' },
      { name: 'department', label: 'Отдел' },
      { name: 'company', label: 'Компания' },
      { name: 'description', label: 'Описание' },
      { name: 'job_title', label: 'Должность' },
      { name: 'telephone_number', label: 'Телефон' },
      { name: 'account_enabled', label: 'Аккаунт активен' },
      { name: 'last_logon', label: 'Последний вход' },
      { name: 'password_last_set', label: 'Пароль изменён' },
      { name: 'member_of', label: 'Член групп' },
    ],
  },
  {
    method: 'user.move',
    label: 'Переместить',
    category: 'users',
    icon: 'FolderInput',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
      { name: 'new_parent_dn', label: 'Новый родительский DN', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'new_parent_dn', label: 'Новый родительский DN' },
    ],
  },
  {
    method: 'user.rename',
    label: 'Переименовать',
    category: 'users',
    icon: 'PenLine',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
      { name: 'new_name', label: 'Новое имя', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'new_name', label: 'Новое имя' },
    ],
  },
  {
    method: 'user.setexpiry',
    label: 'Установить срок',
    category: 'users',
    icon: 'CalendarClock',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
      { name: 'days', label: 'Дни', type: 'number', required: true },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'expiry_date', label: 'Дата истечения' },
    ],
  },
  {
    method: 'user.setprimarygroup',
    label: 'Основная группа',
    category: 'users',
    icon: 'Shield',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
      { name: 'groupname', label: 'Основная группа', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'groupname', label: 'Основная группа' },
    ],
  },
  {
    method: 'user.addunixattrs',
    label: 'Unix-атрибуты',
    category: 'users',
    icon: 'Terminal',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
      { name: 'uid_number', label: 'Номер UID', type: 'number', required: true },
      { name: 'gid_number', label: 'Номер GID', type: 'number', required: true },
      { name: 'login_shell', label: 'Оболочка входа', type: 'string' },
      { name: 'unix_home', label: 'Домашняя директория Unix', type: 'string' },
      { name: 'gecos', label: 'GECOS', type: 'string' },
      { name: 'nis_domain', label: 'NIS-домен', type: 'string' },
      { name: 'uid', label: 'Имя UID', type: 'string' },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'uid_number', label: 'Номер UID' },
      { name: 'gid_number', label: 'Номер GID' },
      { name: 'login_shell', label: 'Оболочка входа' },
      { name: 'unix_home', label: 'Домашняя директория Unix' },
    ],
  },
  {
    method: 'user.sensitive',
    label: 'Чувствительный',
    category: 'users',
    icon: 'ShieldAlert',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
      { name: 'on', label: 'Чувствительный', type: 'boolean', default: true },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'sensitive', label: 'Чувствительный' },
    ],
  },
  {
    method: 'user.getpassword',
    label: 'Получить пароль',
    category: 'users',
    icon: 'KeyRound',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'password', label: 'Пароль' },
    ],
  },
  {
    method: 'user.search',
    label: 'Поиск пользователей',
    category: 'users',
    icon: 'Search',
    params: [
      { name: 'search', label: 'Строка поиска', type: 'string' },
      { name: 'filter', label: 'LDAP-фильтр', type: 'string' },
      { name: 'attributes', label: 'Атрибуты (через запятую)', type: 'string' },
      { name: 'offset', label: 'Смещение', type: 'number', default: 0 },
      { name: 'limit', label: 'Лимит', type: 'number', default: 100 },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'given_name', label: 'Имя' },
      { name: 'surname', label: 'Фамилия' },
      { name: 'mail', label: 'Электронная почта' },
    ],
  },
  {
    method: 'user.import',
    label: 'Импорт из CSV',
    category: 'users',
    icon: 'Upload',
    params: [
      { name: 'file', label: 'CSV-файл', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'task_id', label: 'ID задачи' },
      { name: 'result_url', label: 'URL результата' },
    ],
  },
  {
    method: 'user.export',
    label: 'Экспорт пользователей',
    category: 'users',
    icon: 'Download',
    params: [
      { name: 'format', label: 'Формат', type: 'select', default: 'csv', options: [
        { label: 'CSV', value: 'csv' },
        { label: 'JSON', value: 'json' },
      ]},
      { name: 'attributes', label: 'Атрибуты (через запятую)', type: 'string' },
    ],
    outputFields: [
      { name: 'format', label: 'Формат' },
      { name: 'count', label: 'Кол-во записей' },
    ],
  },
  {
    method: 'user.batch',
    label: 'Пакетное получение',
    category: 'users',
    icon: 'Users',
    params: [
      { name: 'usernames', label: 'Имена (через запятую)', type: 'string', required: true },
      { name: 'attributes', label: 'Атрибуты (через запятую)', type: 'string' },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'given_name', label: 'Имя' },
      { name: 'surname', label: 'Фамилия' },
    ],
  },
  {
    method: 'user.list.full',
    label: 'Список пользователей (полный)',
    category: 'users',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
      { name: 'given_name', label: 'Имя' },
      { name: 'surname', label: 'Фамилия' },
      { name: 'mail', label: 'Электронная почта' },
      { name: 'department', label: 'Отдел' },
    ],
  },
  {
    method: 'user.groups',
    label: 'Группы пользователя',
    category: 'users',
    icon: 'Users',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'groupname', label: 'Имя группы' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'user.kerberos',
    label: 'Билет Kerberos',
    category: 'users',
    icon: 'KeyRound',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'ticket', label: 'Билет' },
      { name: 'expires', label: 'Истекает' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // GROUPS
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'group.create',
    label: 'Создать группу',
    category: 'groups',
    icon: 'FolderPlus',
    params: [
      { name: 'groupname', label: 'Имя группы', type: 'string', required: true },
      { name: 'groupou', label: 'Подразделение (OU)', type: 'string' },
      { name: 'description', label: 'Описание', type: 'string' },
      { name: 'mail_address', label: 'Электронная почта', type: 'string' },
      { name: 'notes', label: 'Заметки', type: 'string' },
      { name: 'gid_number', label: 'Номер GID', type: 'number' },
      { name: 'nis_domain', label: 'NIS-домен', type: 'string' },
      { name: 'group_scope', label: 'Область действия', type: 'select', options: [
        { label: 'Доменный локальный', value: 'DomainLocal' },
        { label: 'Глобальная', value: 'Global' },
        { label: 'Универсальная', value: 'Universal' },
      ]},
      { name: 'group_type', label: 'Тип', type: 'select', options: [
        { label: 'Безопасность', value: 'Security' },
        { label: 'Рассылка', value: 'Distribution' },
      ]},
    ],
    outputFields: [
      { name: 'groupname', label: 'Имя группы' },
      { name: 'dn', label: 'DN' },
      { name: 'description', label: 'Описание' },
      { name: 'group_scope', label: 'Область действия' },
      { name: 'group_type', label: 'Тип' },
    ],
  },
  {
    method: 'group.delete',
    label: 'Удалить группу',
    category: 'groups',
    icon: 'FolderMinus',
    params: [
      { name: 'groupname', label: 'Имя группы', type: 'string', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'group.addmembers',
    label: 'Добавить участников',
    category: 'groups',
    icon: 'UserPlus',
    params: [
      { name: 'groupname', label: 'Имя группы', type: 'string', required: true },
      { name: 'members', label: 'Участники (через запятую)', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'groupname', label: 'Имя группы' },
      { name: 'dn', label: 'DN' },
      { name: 'members', label: 'Добавленные участники' },
    ],
  },
  {
    method: 'group.removemembers',
    label: 'Удалить участников',
    category: 'groups',
    icon: 'UserMinus',
    params: [
      { name: 'groupname', label: 'Имя группы', type: 'string', required: true },
      { name: 'members', label: 'Участники (через запятую)', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'groupname', label: 'Имя группы' },
      { name: 'dn', label: 'DN' },
      { name: 'members', label: 'Удалённые участники' },
    ],
  },
  {
    method: 'group.list',
    label: 'Список групп',
    category: 'groups',
    icon: 'List',
    params: [
      { name: 'verbose', label: 'Подробно', type: 'boolean', default: false },
    ],
    outputFields: [
      { name: 'groupname', label: 'Имя группы' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'group.list.full',
    label: 'Список групп (полный)',
    category: 'groups',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'groupname', label: 'Имя группы' },
      { name: 'dn', label: 'DN' },
      { name: 'description', label: 'Описание' },
      { name: 'members_count', label: 'Кол-во участников' },
    ],
  },
  {
    method: 'group.listmembers',
    label: 'Участники группы',
    category: 'groups',
    icon: 'Users',
    params: [
      { name: 'groupname', label: 'Имя группы', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'group.move',
    label: 'Переместить группу',
    category: 'groups',
    icon: 'FolderInput',
    params: [
      { name: 'groupname', label: 'Имя группы', type: 'string', required: true },
      { name: 'new_parent_dn', label: 'Новый родительский DN', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'groupname', label: 'Имя группы' },
      { name: 'dn', label: 'DN' },
      { name: 'new_parent_dn', label: 'Новый родительский DN' },
    ],
  },
  {
    method: 'group.show',
    label: 'Просмотр группы',
    category: 'groups',
    icon: 'Eye',
    params: [
      { name: 'groupname', label: 'Имя группы', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'groupname', label: 'Имя группы' },
      { name: 'dn', label: 'DN' },
      { name: 'description', label: 'Описание' },
      { name: 'group_scope', label: 'Область действия' },
      { name: 'group_type', label: 'Тип' },
      { name: 'members_count', label: 'Кол-во участников' },
    ],
  },
  {
    method: 'group.stats',
    label: 'Статистика групп',
    category: 'groups',
    icon: 'BarChart3',
    params: [],
    outputFields: [
      { name: 'total_groups', label: 'Всего групп' },
      { name: 'security_groups', label: 'Группы безопасности' },
      { name: 'distribution_groups', label: 'Группы рассылки' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CONTACTS
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'contact.create',
    label: 'Создать контакт',
    category: 'contacts',
    icon: 'Contact',
    params: [
      { name: 'contactname', label: 'Имя контакта', type: 'string', required: true },
      { name: 'contactou', label: 'Подразделение (OU)', type: 'string' },
      { name: 'surname', label: 'Фамилия', type: 'string' },
      { name: 'given_name', label: 'Имя', type: 'string' },
      { name: 'initials', label: 'Инициалы', type: 'string' },
      { name: 'display_name', label: 'Отображаемое имя', type: 'string' },
      { name: 'description', label: 'Описание', type: 'string' },
      { name: 'mail_address', label: 'Электронная почта', type: 'string' },
      { name: 'telephone_number', label: 'Телефон', type: 'string' },
    ],
    outputFields: [
      { name: 'contactname', label: 'Имя контакта' },
      { name: 'dn', label: 'DN' },
      { name: 'given_name', label: 'Имя' },
      { name: 'surname', label: 'Фамилия' },
      { name: 'display_name', label: 'Отображаемое имя' },
      { name: 'mail_address', label: 'Электронная почта' },
      { name: 'telephone_number', label: 'Телефон' },
    ],
  },
  {
    method: 'contact.delete',
    label: 'Удалить контакт',
    category: 'contacts',
    icon: 'Trash2',
    params: [
      { name: 'contactname', label: 'Имя контакта', type: 'string', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'contact.list',
    label: 'Список контактов',
    category: 'contacts',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'contactname', label: 'Имя контакта' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'contact.list.full',
    label: 'Список контактов (полный)',
    category: 'contacts',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'contactname', label: 'Имя контакта' },
      { name: 'dn', label: 'DN' },
      { name: 'display_name', label: 'Отображаемое имя' },
      { name: 'mail_address', label: 'Электронная почта' },
    ],
  },
  {
    method: 'contact.show',
    label: 'Просмотр контакта',
    category: 'contacts',
    icon: 'Eye',
    params: [
      { name: 'contactname', label: 'Имя контакта', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'contactname', label: 'Имя контакта' },
      { name: 'dn', label: 'DN' },
      { name: 'given_name', label: 'Имя' },
      { name: 'surname', label: 'Фамилия' },
      { name: 'display_name', label: 'Отображаемое имя' },
      { name: 'description', label: 'Описание' },
      { name: 'mail_address', label: 'Электронная почта' },
      { name: 'telephone_number', label: 'Телефон' },
    ],
  },
  {
    method: 'contact.move',
    label: 'Переместить контакт',
    category: 'contacts',
    icon: 'FolderInput',
    params: [
      { name: 'contactname', label: 'Имя контакта', type: 'string', required: true },
      { name: 'new_parent_dn', label: 'Новый родительский DN', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'contactname', label: 'Имя контакта' },
      { name: 'dn', label: 'DN' },
      { name: 'new_parent_dn', label: 'Новый родительский DN' },
    ],
  },
  {
    method: 'contact.rename',
    label: 'Переименовать контакт',
    category: 'contacts',
    icon: 'PenLine',
    params: [
      { name: 'contactname', label: 'Имя контакта', type: 'string', required: true },
      { name: 'new_name', label: 'Новое имя', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'contactname', label: 'Имя контакта' },
      { name: 'dn', label: 'DN' },
      { name: 'new_name', label: 'Новое имя' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // COMPUTERS
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'computer.create',
    label: 'Создать компьютер',
    category: 'computers',
    icon: 'Monitor',
    params: [
      { name: 'computername', label: 'Имя компьютера', type: 'string', required: true },
      { name: 'computerou', label: 'Подразделение (OU)', type: 'string' },
      { name: 'description', label: 'Описание', type: 'string' },
      { name: 'ip_address_list', label: 'IP-адреса', type: 'string' },
      { name: 'service_principal_name_list', label: 'Список SPN', type: 'string' },
    ],
    outputFields: [
      { name: 'computername', label: 'Имя компьютера' },
      { name: 'dn', label: 'DN' },
      { name: 'description', label: 'Описание' },
    ],
  },
  {
    method: 'computer.delete',
    label: 'Удалить компьютер',
    category: 'computers',
    icon: 'Trash2',
    params: [
      { name: 'computername', label: 'Имя компьютера', type: 'string', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'computer.list',
    label: 'Список компьютеров',
    category: 'computers',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'computername', label: 'Имя компьютера' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'computer.list.full',
    label: 'Список компьютеров (полный)',
    category: 'computers',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'computername', label: 'Имя компьютера' },
      { name: 'dn', label: 'DN' },
      { name: 'description', label: 'Описание' },
      { name: 'operating_system', label: 'Операционная система' },
    ],
  },
  {
    method: 'computer.show',
    label: 'Просмотр компьютера',
    category: 'computers',
    icon: 'Eye',
    params: [
      { name: 'computername', label: 'Имя компьютера', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'computername', label: 'Имя компьютера' },
      { name: 'dn', label: 'DN' },
      { name: 'description', label: 'Описание' },
      { name: 'operating_system', label: 'Операционная система' },
      { name: 'ip_address', label: 'IP-адрес' },
      { name: 'last_logon', label: 'Последний вход' },
      { name: 'member_of', label: 'Член групп' },
    ],
  },
  {
    method: 'computer.move',
    label: 'Переместить компьютер',
    category: 'computers',
    icon: 'FolderInput',
    params: [
      { name: 'computername', label: 'Имя компьютера', type: 'string', required: true },
      { name: 'new_ou_dn', label: 'Новый DN подразделения', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'computername', label: 'Имя компьютера' },
      { name: 'dn', label: 'DN' },
      { name: 'new_ou_dn', label: 'Новый DN подразделения' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DNS
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'dns.zone.create',
    label: 'Создать зону',
    category: 'dns',
    icon: 'Globe',
    params: [
      { name: 'zone', label: 'Имя зоны', type: 'string', required: true },
      { name: 'dns_directory_partition', label: 'Раздел каталога', type: 'select', default: 'domain', options: [
        { label: 'Домен', value: 'domain' },
        { label: 'Лес', value: 'forest' },
      ]},
    ],
    outputFields: [
      { name: 'zone', label: 'Имя зоны' },
      { name: 'dn', label: 'DN' },
      { name: 'dns_directory_partition', label: 'Раздел каталога' },
    ],
  },
  {
    method: 'dns.zone.delete',
    label: 'Удалить зону',
    category: 'dns',
    icon: 'Trash2',
    params: [
      { name: 'zone', label: 'Имя зоны', type: 'string', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'dns.zone.list',
    label: 'Список зон',
    category: 'dns',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'zone', label: 'Имя зоны' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'dns.zone.show',
    label: 'Просмотр зоны',
    category: 'dns',
    icon: 'Eye',
    params: [
      { name: 'zone', label: 'Имя зоны', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'zone', label: 'Имя зоны' },
      { name: 'dn', label: 'DN' },
      { name: 'serial', label: 'Серийный номер' },
      { name: 'refresh', label: 'Обновление' },
      { name: 'retry', label: 'Повтор' },
      { name: 'expire', label: 'Истечение' },
      { name: 'minimum_ttl', label: 'Минимальный TTL' },
      { name: 'records_count', label: 'Кол-во записей' },
    ],
  },
  {
    method: 'dns.record.create',
    label: 'Создать запись',
    category: 'dns',
    icon: 'FilePlus',
    params: [
      { name: 'zone', label: 'Зона', type: 'string', required: true },
      { name: 'name', label: 'Имя записи', type: 'string', required: true },
      { name: 'record_type', label: 'Тип', type: 'select', required: true, options: [
        { label: 'A', value: 'A' }, { label: 'AAAA', value: 'AAAA' },
        { label: 'CNAME', value: 'CNAME' }, { label: 'MX', value: 'MX' },
        { label: 'NS', value: 'NS' }, { label: 'PTR', value: 'PTR' },
        { label: 'SRV', value: 'SRV' }, { label: 'TXT', value: 'TXT' },
      ]},
      { name: 'data', label: 'Данные', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'zone', label: 'Зона' },
      { name: 'name', label: 'Имя записи' },
      { name: 'record_type', label: 'Тип' },
      { name: 'data', label: 'Данные' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'dns.record.delete',
    label: 'Удалить запись',
    category: 'dns',
    icon: 'FileMinus',
    params: [
      { name: 'zone', label: 'Зона', type: 'string', required: true },
      { name: 'name', label: 'Имя записи', type: 'string', required: true },
      { name: 'record_type', label: 'Тип', type: 'string', required: true },
      { name: 'data', label: 'Данные', type: 'string', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'dns.record.list',
    label: 'Список записей',
    category: 'dns',
    icon: 'List',
    params: [
      { name: 'zone', label: 'Зона', type: 'string', required: true },
      { name: 'name', label: 'Имя', type: 'string', default: '@' },
      { name: 'record_type', label: 'Тип', type: 'string', default: 'ALL' },
    ],
    outputFields: [
      { name: 'name', label: 'Имя' },
      { name: 'record_type', label: 'Тип' },
      { name: 'data', label: 'Данные' },
      { name: 'ttl', label: 'TTL' },
    ],
  },
  {
    method: 'dns.record.update',
    label: 'Обновить запись',
    category: 'dns',
    icon: 'RefreshCw',
    params: [
      { name: 'zone', label: 'Зона', type: 'string', required: true },
      { name: 'name', label: 'Имя записи', type: 'string', required: true },
      { name: 'old_record_type', label: 'Старый тип', type: 'string', required: true },
      { name: 'old_data', label: 'Старые данные', type: 'string', required: true },
      { name: 'new_data', label: 'Новые данные', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'zone', label: 'Зона' },
      { name: 'name', label: 'Имя записи' },
      { name: 'record_type', label: 'Тип' },
      { name: 'new_data', label: 'Новые данные' },
    ],
  },
  {
    method: 'dns.serverinfo',
    label: 'Информация о DNS',
    category: 'dns',
    icon: 'Info',
    params: [],
    outputFields: [
      { name: 'server', label: 'Сервер' },
      { name: 'version', label: 'Версия' },
      { name: 'zones_count', label: 'Кол-во зон' },
      { name: 'forest', label: 'Лес' },
    ],
  },
  {
    method: 'dns.record.rorecords',
    label: 'Записи DNS (только чтение)',
    category: 'dns',
    icon: 'List',
    params: [
      { name: 'zone', label: 'Зона', type: 'string', required: true },
      { name: 'name', label: 'Имя', type: 'string' },
      { name: 'record_type', label: 'Тип записи', type: 'string' },
    ],
    outputFields: [
      { name: 'name', label: 'Имя' },
      { name: 'record_type', label: 'Тип' },
      { name: 'data', label: 'Данные' },
      { name: 'ttl', label: 'TTL' },
    ],
  },
  {
    method: 'dns.zone.options',
    label: 'Настройки зоны',
    category: 'dns',
    icon: 'Settings',
    params: [
      { name: 'zone', label: 'Зона', type: 'string', required: true },
      { name: 'aging', label: 'Старение', type: 'boolean' },
      { name: 'no_scavenge', label: 'Без очистки', type: 'boolean' },
    ],
    outputFields: [
      { name: 'zone', label: 'Зона' },
      { name: 'aging', label: 'Старение' },
      { name: 'no_scavenge', label: 'Без очистки' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // OU
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'ou.create',
    label: 'Создать OU',
    category: 'ou',
    icon: 'FolderPlus',
    params: [
      { name: 'ouname', label: 'Имя подразделения', type: 'string', required: true },
      { name: 'description', label: 'Описание', type: 'string' },
    ],
    outputFields: [
      { name: 'ouname', label: 'Имя подразделения' },
      { name: 'dn', label: 'DN' },
      { name: 'description', label: 'Описание' },
    ],
  },
  {
    method: 'ou.delete',
    label: 'Удалить OU',
    category: 'ou',
    icon: 'FolderMinus',
    params: [
      { name: 'ouname', label: 'Имя подразделения', type: 'string', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'ou.list',
    label: 'Список OU',
    category: 'ou',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'ouname', label: 'Имя подразделения' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'ou.move',
    label: 'Переместить OU',
    category: 'ou',
    icon: 'FolderInput',
    params: [
      { name: 'ouname', label: 'Имя подразделения', type: 'string', required: true },
      { name: 'new_parent_dn', label: 'Новый родительский DN', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'ouname', label: 'Имя подразделения' },
      { name: 'dn', label: 'DN' },
      { name: 'new_parent_dn', label: 'Новый родительский DN' },
    ],
  },
  {
    method: 'ou.rename',
    label: 'Переименовать OU',
    category: 'ou',
    icon: 'PenLine',
    params: [
      { name: 'ouname', label: 'Имя подразделения', type: 'string', required: true },
      { name: 'new_name', label: 'Новое имя', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'ouname', label: 'Имя подразделения' },
      { name: 'dn', label: 'DN' },
      { name: 'new_name', label: 'Новое имя' },
    ],
  },
  {
    method: 'ou.search',
    label: 'Поиск OU',
    category: 'ou',
    icon: 'Search',
    params: [
      { name: 'name', label: 'Фильтр имени', type: 'string' },
    ],
    outputFields: [
      { name: 'ouname', label: 'Имя подразделения' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'ou.tree',
    label: 'Дерево OU',
    category: 'ou',
    icon: 'GitBranch',
    params: [],
    outputFields: [
      { name: 'ouname', label: 'Имя подразделения' },
      { name: 'dn', label: 'DN' },
      { name: 'children', label: 'Дочерние элементы' },
    ],
  },
  {
    method: 'ou.stats',
    label: 'Статистика OU',
    category: 'ou',
    icon: 'BarChart3',
    params: [
      { name: 'ou_dn', label: 'DN подразделения', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'ou_dn', label: 'DN подразделения' },
      { name: 'users_count', label: 'Кол-во пользователей' },
      { name: 'groups_count', label: 'Кол-во групп' },
      { name: 'computers_count', label: 'Кол-во компьютеров' },
      { name: 'contacts_count', label: 'Кол-во контактов' },
    ],
  },
  {
    method: 'ou.subtree',
    label: 'Поддерево OU',
    category: 'ou',
    icon: 'GitBranch',
    params: [
      { name: 'ou_dn', label: 'DN подразделения', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'ouname', label: 'Имя подразделения' },
      { name: 'dn', label: 'DN' },
      { name: 'children', label: 'Дочерние элементы' },
      { name: 'object_count', label: 'Кол-во объектов' },
    ],
  },
  {
    method: 'ou.list.full',
    label: 'Список OU (полный)',
    category: 'ou',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'ouname', label: 'Имя подразделения' },
      { name: 'dn', label: 'DN' },
      { name: 'description', label: 'Описание' },
      { name: 'children_count', label: 'Кол-во дочерних' },
    ],
  },
  {
    method: 'ou.objects',
    label: 'Объекты в OU',
    category: 'ou',
    icon: 'List',
    params: [
      { name: 'ouname', label: 'Имя подразделения', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'ouname', label: 'Имя подразделения' },
      { name: 'dn', label: 'DN' },
      { name: 'object_name', label: 'Имя объекта' },
      { name: 'object_type', label: 'Тип объекта' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SHELL
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'shell.exec',
    label: 'Выполнить команду',
    category: 'shell',
    icon: 'Terminal',
    params: [
      { name: 'cmd', label: 'Команда', type: 'string', required: true },
      { name: 'shell', label: 'Оболочка', type: 'select', default: 'bash', options: [
        { label: 'Bash', value: 'bash' },
        { label: 'Python 3', value: 'python3' },
      ]},
      { name: 'sudo', label: 'Sudo', type: 'boolean', default: false },
      { name: 'timeout', label: 'Таймаут (сек)', type: 'number', default: 30 },
      { name: 'env', label: 'Переменные окружения (JSON)', type: 'string' },
    ],
    outputFields: [
      { name: 'stdout', label: 'Стандартный вывод' },
      { name: 'stderr', label: 'Вывод ошибок' },
      { name: 'exit_code', label: 'Код возврата' },
    ],
  },
  {
    method: 'shell.script',
    label: 'Выполнить скрипт',
    category: 'shell',
    icon: 'FileCode',
    params: [
      { name: 'lines', label: 'Строки скрипта (через запятую)', type: 'string', required: true },
      { name: 'shell', label: 'Оболочка', type: 'select', default: 'bash', options: [
        { label: 'Bash', value: 'bash' },
        { label: 'Python 3', value: 'python3' },
      ]},
      { name: 'sudo', label: 'Sudo', type: 'boolean', default: false },
      { name: 'timeout', label: 'Таймаут (сек)', type: 'number', default: 60 },
      { name: 'env', label: 'Переменные окружения (JSON)', type: 'string' },
    ],
    outputFields: [
      { name: 'stdout', label: 'Стандартный вывод' },
      { name: 'stderr', label: 'Вывод ошибок' },
      { name: 'exit_code', label: 'Код возврата' },
    ],
  },
  {
    method: 'shell.list',
    label: 'Список оболочек',
    category: 'shell',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'shell_name', label: 'Оболочка' },
      { name: 'available', label: 'Доступна' },
      { name: 'path', label: 'Путь' },
      { name: 'description', label: 'Описание' },
    ],
  },
  {
    method: 'shell.script.file',
    label: 'Выполнить файл скрипта',
    category: 'shell',
    icon: 'FileCode2',
    params: [
      { name: 'file', label: 'Файл скрипта', type: 'string', required: true },
      { name: 'shell', label: 'Оболочка', type: 'select', default: 'bash', options: [
        { label: 'Bash', value: 'bash' },
        { label: 'Python 3', value: 'python3' },
      ]},
      { name: 'sudo', label: 'Sudo', type: 'boolean', default: false },
      { name: 'timeout', label: 'Таймаут (сек)', type: 'number', default: 60 },
      { name: 'auto_delete', label: 'Авто-удаление', type: 'boolean', default: true },
    ],
    outputFields: [
      { name: 'stdout', label: 'Стандартный вывод' },
      { name: 'stderr', label: 'Вывод ошибок' },
      { name: 'exit_code', label: 'Код возврата' },
      { name: 'filename', label: 'Имя файла' },
      { name: 'workspace_path', label: 'Путь рабочей области' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SHELL PROJECT
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'shell.project.create',
    label: 'Создать проект',
    category: 'shell-project',
    icon: 'FolderPlus',
    params: [
      { name: 'name', label: 'Имя проекта', type: 'string', required: true },
      { name: 'archive', label: 'Архив', type: 'string' },
      { name: 'run_command', label: 'Команда выполнения', type: 'string' },
      { name: 'run_args', label: 'Аргументы команды', type: 'string' },
      { name: 'auto_delete', label: 'Авто-удаление', type: 'boolean', default: true },
      { name: 'sudo', label: 'Sudo', type: 'boolean', default: false },
      { name: 'timeout', label: 'Таймаут (сек)', type: 'number', default: 300 },
      { name: 'env', label: 'Переменные окружения (JSON)', type: 'string' },
      { name: 'owner', label: 'Владелец', type: 'string' },
      { name: 'permissions', label: 'Права доступа', type: 'string' },
      { name: 'pre_commands', label: 'Пред-команды (через запятую)', type: 'string' },
      { name: 'post_commands', label: 'Пост-команды (через запятую)', type: 'string' },
      { name: 'tags', label: 'Теги (через запятую)', type: 'string' },
      { name: 'ttl_seconds', label: 'TTL (сек)', type: 'number' },
      { name: 'callback_url', label: 'URL обратного вызова', type: 'string' },
      { name: 'wait_for_completion', label: 'Ждать завершения', type: 'boolean', default: false },
      { name: 'dry_run', label: 'Пробный запуск', type: 'boolean', default: false },
    ],
    outputFields: [
      { name: 'projet_id', label: 'ID проекта' },
      { name: 'name', label: 'Имя проекта' },
      { name: 'workspace_path', label: 'Путь рабочей области' },
      { name: 'ws_url', label: 'WebSocket URL' },
    ],
  },
  {
    method: 'shell.project.upload',
    label: 'Загрузить файл в проект',
    category: 'shell-project',
    icon: 'Upload',
    params: [
      { name: 'projet_id', label: 'ID проекта', type: 'string', required: true },
      { name: 'file', label: 'Файл', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'projet_id', label: 'ID проекта' },
      { name: 'filename', label: 'Имя файла' },
      { name: 'size', label: 'Размер' },
      { name: 'extracted', label: 'Распакован' },
    ],
  },
  {
    method: 'shell.project.upload-multi',
    label: 'Загрузить несколько файлов',
    category: 'shell-project',
    icon: 'Files',
    params: [
      { name: 'projet_id', label: 'ID проекта', type: 'string', required: true },
      { name: 'files', label: 'Файлы (через запятую)', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'projet_id', label: 'ID проекта' },
      { name: 'uploaded_files', label: 'Загруженные файлы' },
      { name: 'total_size', label: 'Общий размер' },
    ],
  },
  {
    method: 'shell.project.run',
    label: 'Выполнить команду в проекте',
    category: 'shell-project',
    icon: 'Play',
    params: [
      { name: 'projet_id', label: 'ID проекта', type: 'string', required: true },
      { name: 'run_command', label: 'Команда выполнения', type: 'string', required: true },
      { name: 'run_args', label: 'Аргументы команды', type: 'string' },
      { name: 'sudo', label: 'Sudo', type: 'boolean', default: false },
      { name: 'timeout', label: 'Таймаут (сек)', type: 'number', default: 300 },
      { name: 'env', label: 'Переменные окружения (JSON)', type: 'string' },
      { name: 'auto_delete', label: 'Авто-удаление', type: 'boolean', default: false },
      { name: 'pre_commands', label: 'Пред-команды (через запятую)', type: 'string' },
      { name: 'post_commands', label: 'Пост-команды (через запятую)', type: 'string' },
      { name: 'dry_run', label: 'Пробный запуск', type: 'boolean', default: false },
    ],
    outputFields: [
      { name: 'projet_id', label: 'ID проекта' },
      { name: 'returncode', label: 'Код возврата' },
      { name: 'stdout', label: 'Стандартный вывод' },
      { name: 'stderr', label: 'Вывод ошибок' },
      { name: 'elapsed', label: 'Время выполнения (сек)' },
      { name: 'timed_out', label: 'Таймаут' },
    ],
  },
  {
    method: 'shell.project.list',
    label: 'Список проектов',
    category: 'shell-project',
    icon: 'List',
    params: [
      { name: 'owner', label: 'Владелец', type: 'string' },
      { name: 'status_filter', label: 'Фильтр статуса', type: 'string' },
      { name: 'name', label: 'Имя', type: 'string' },
      { name: 'tag', label: 'Тег', type: 'string' },
      { name: 'label', label: 'Метка', type: 'string' },
    ],
    outputFields: [
      { name: 'projet_id', label: 'ID проекта' },
      { name: 'name', label: 'Имя проекта' },
      { name: 'status', label: 'Статус' },
      { name: 'owner', label: 'Владелец' },
      { name: 'workspace_path', label: 'Путь рабочей области' },
    ],
  },
  {
    method: 'shell.project.health',
    label: 'Проверка здоровья',
    category: 'shell-project',
    icon: 'HeartPulse',
    params: [],
    outputFields: [
      { name: 'total_projects', label: 'Всего проектов' },
      { name: 'running', label: 'Выполняется' },
      { name: 'ready', label: 'Готов' },
      { name: 'completed', label: 'Завершён' },
      { name: 'failed', label: 'Ошибка' },
      { name: 'disk_usage_mb', label: 'Использование диска (МБ)' },
    ],
  },
  {
    method: 'shell.project.show',
    label: 'Просмотр проекта',
    category: 'shell-project',
    icon: 'Eye',
    params: [
      { name: 'projet_id', label: 'ID проекта', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'projet_id', label: 'ID проекта' },
      { name: 'name', label: 'Имя проекта' },
      { name: 'status', label: 'Статус' },
      { name: 'workspace_path', label: 'Путь рабочей области' },
      { name: 'owner', label: 'Владелец' },
      { name: 'file_count', label: 'Кол-во файлов' },
    ],
  },
  {
    method: 'shell.project.download',
    label: 'Скачать проект (ZIP)',
    category: 'shell-project',
    icon: 'Download',
    params: [
      { name: 'projet_id', label: 'ID проекта', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'projet_id', label: 'ID проекта' },
    ],
  },
  {
    method: 'shell.project.owner',
    label: 'Передать владение',
    category: 'shell-project',
    icon: 'UserCog',
    params: [
      { name: 'projet_id', label: 'ID проекта', type: 'string', required: true },
      { name: 'new_owner', label: 'Новый владелец', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'projet_id', label: 'ID проекта' },
      { name: 'old_owner', label: 'Старый владелец' },
      { name: 'new_owner', label: 'Новый владелец' },
    ],
  },
  {
    method: 'shell.project.tags',
    label: 'Обновить теги/метки',
    category: 'shell-project',
    icon: 'Tags',
    params: [
      { name: 'projet_id', label: 'ID проекта', type: 'string', required: true },
      { name: 'tags', label: 'Теги (через запятую)', type: 'string' },
      { name: 'labels', label: 'Метки (JSON)', type: 'string' },
    ],
    outputFields: [
      { name: 'projet_id', label: 'ID проекта' },
      { name: 'tags', label: 'Теги' },
      { name: 'labels', label: 'Метки' },
    ],
  },
  {
    method: 'shell.project.delete',
    label: 'Удалить проект',
    category: 'shell-project',
    icon: 'Trash2',
    params: [
      { name: 'projet_id', label: 'ID проекта', type: 'string', required: true },
      { name: 'force', label: 'Принудительно', type: 'boolean', default: false },
    ],
    outputFields: [
      { name: 'projet_id', label: 'ID проекта' },
      { name: 'workspace_path', label: 'Путь рабочей области' },
    ],
  },
  {
    method: 'shell.project.abort',
    label: 'Прервать выполнение',
    category: 'shell-project',
    icon: 'OctagonX',
    params: [
      { name: 'projet_id', label: 'ID проекта', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'projet_id', label: 'ID проекта' },
      { name: 'aborted', label: 'Прервано' },
    ],
  },
  {
    method: 'shell.project.schedule',
    label: 'Создать расписание',
    category: 'shell-project',
    icon: 'Clock',
    params: [
      { name: 'projet_id', label: 'ID проекта', type: 'string', required: true },
      { name: 'cron_expr', label: 'Выражение Cron', type: 'string' },
      { name: 'run_command', label: 'Команда выполнения', type: 'string' },
    ],
    outputFields: [
      { name: 'projet_id', label: 'ID проекта' },
      { name: 'schedule_id', label: 'ID расписания' },
    ],
  },
  {
    method: 'shell.project.schedule.list',
    label: 'Список расписаний',
    category: 'shell-project',
    icon: 'List',
    params: [
      { name: 'projet_id', label: 'ID проекта', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'schedule_id', label: 'ID расписания' },
      { name: 'cron_expr', label: 'Выражение Cron' },
      { name: 'run_command', label: 'Команда' },
    ],
  },
  {
    method: 'shell.project.schedule.delete',
    label: 'Удалить расписание',
    category: 'shell-project',
    icon: 'Trash2',
    params: [
      { name: 'projet_id', label: 'ID проекта', type: 'string', required: true },
      { name: 'schedule_id', label: 'ID расписания', type: 'number', required: true },
    ],
    outputFields: [
      { name: 'schedule_id', label: 'ID расписания' },
    ],
  },
  {
    method: 'shell.project.template.create',
    label: 'Создать шаблон',
    category: 'shell-project',
    icon: 'LayoutTemplate',
    params: [
      { name: 'name', label: 'Имя шаблона', type: 'string' },
      { name: 'description', label: 'Описание', type: 'string' },
      { name: 'run_command', label: 'Команда выполнения', type: 'string' },
      { name: 'env', label: 'Переменные окружения (JSON)', type: 'string' },
      { name: 'tags', label: 'Теги (через запятую)', type: 'string' },
      { name: 'labels', label: 'Метки (JSON)', type: 'string' },
      { name: 'pre_commands', label: 'Пред-команды (через запятую)', type: 'string' },
      { name: 'post_commands', label: 'Пост-команды (через запятую)', type: 'string' },
    ],
    outputFields: [
      { name: 'template_id', label: 'ID шаблона' },
      { name: 'name', label: 'Имя шаблона' },
    ],
  },
  {
    method: 'shell.project.template.from',
    label: 'Создать из шаблона',
    category: 'shell-project',
    icon: 'Copy',
    params: [
      { name: 'template_id', label: 'ID шаблона', type: 'string', required: true },
      { name: 'name', label: 'Имя проекта', type: 'string' },
      { name: 'owner', label: 'Владелец', type: 'string' },
      { name: 'auto_delete', label: 'Авто-удаление', type: 'boolean', default: true },
    ],
    outputFields: [
      { name: 'projet_id', label: 'ID проекта' },
      { name: 'name', label: 'Имя проекта' },
      { name: 'workspace_path', label: 'Путь рабочей области' },
    ],
  },
  {
    method: 'shell.project.template.list',
    label: 'Список шаблонов',
    category: 'shell-project',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'template_id', label: 'ID шаблона' },
      { name: 'name', label: 'Имя шаблона' },
      { name: 'description', label: 'Описание' },
    ],
  },
  {
    method: 'shell.project.template.delete',
    label: 'Удалить шаблон',
    category: 'shell-project',
    icon: 'Trash2',
    params: [
      { name: 'template_id', label: 'ID шаблона', type: 'string', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'shell.project.snapshot',
    label: 'Создать снимок',
    category: 'shell-project',
    icon: 'Camera',
    params: [
      { name: 'projet_id', label: 'ID проекта', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'snapshot_id', label: 'ID снимка' },
      { name: 'projet_id', label: 'ID проекта' },
    ],
  },
  {
    method: 'shell.project.snapshot.rollback',
    label: 'Откатить к снимку',
    category: 'shell-project',
    icon: 'RotateCcw',
    params: [
      { name: 'projet_id', label: 'ID проекта', type: 'string', required: true },
      { name: 'snapshot_id', label: 'ID снимка', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'projet_id', label: 'ID проекта' },
      { name: 'snapshot_id', label: 'ID снимка' },
    ],
  },
  {
    method: 'shell.project.audit',
    label: 'Глобальный аудит',
    category: 'shell-project',
    icon: 'ScrollText',
    params: [
      { name: 'limit', label: 'Лимит', type: 'number', default: 100 },
    ],
    outputFields: [
      { name: 'action', label: 'Действие' },
      { name: 'projet_id', label: 'ID проекта' },
      { name: 'timestamp', label: 'Время' },
    ],
  },
  {
    method: 'shell.project.audit.project',
    label: 'Аудит проекта',
    category: 'shell-project',
    icon: 'ScrollText',
    params: [
      { name: 'projet_id', label: 'ID проекта', type: 'string', required: true },
      { name: 'limit', label: 'Лимит', type: 'number', default: 100 },
    ],
    outputFields: [
      { name: 'action', label: 'Действие' },
      { name: 'timestamp', label: 'Время' },
    ],
  },
  {
    method: 'shell.project.batch',
    label: 'Пакетные операции',
    category: 'shell-project',
    icon: 'Layers',
    params: [
      { name: 'action', label: 'Действие', type: 'string' },
      { name: 'projects', label: 'Проекты (JSON)', type: 'string' },
    ],
    outputFields: [
      { name: 'action', label: 'Действие' },
      { name: 'results', label: 'Результаты' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DOMAIN
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'domain.info',
    label: 'Информация о домене',
    category: 'domain',
    icon: 'Info',
    params: [
      { name: 'ip_address', label: 'IP-адрес', type: 'string', default: '127.0.0.1' },
    ],
    outputFields: [
      { name: 'domain', label: 'Домен' },
      { name: 'forest', label: 'Лес' },
      { name: 'dc', label: 'Контроллер домена' },
      { name: 'dns_name', label: 'DNS-имя' },
      { name: 'netbios_name', label: 'NetBIOS-имя' },
      { name: 'domain_functional_level', label: 'Функциональный уровень' },
    ],
  },
  {
    method: 'dashboard.full',
    label: 'Полный дашборд AD',
    category: 'domain',
    icon: 'LayoutDashboard',
    params: [],
    outputFields: [
      { name: 'domain', label: 'Домен' },
      { name: 'users_count', label: 'Кол-во пользователей' },
      { name: 'groups_count', label: 'Кол-во групп' },
      { name: 'computers_count', label: 'Кол-во компьютеров' },
      { name: 'forest', label: 'Лес' },
      { name: 'domain_functional_level', label: 'Функциональный уровень' },
    ],
  },
  {
    method: 'dashboard.overview',
    label: 'Обзор AD и системы',
    category: 'domain',
    icon: 'Gauge',
    params: [],
    outputFields: [
      { name: 'domain', label: 'Домен' },
      { name: 'users_count', label: 'Кол-во пользователей' },
      { name: 'groups_count', label: 'Кол-во групп' },
      { name: 'computers_count', label: 'Кол-во компьютеров' },
      { name: 'cpu_percent', label: 'CPU %' },
      { name: 'memory_percent', label: 'Память %' },
      { name: 'disk_percent', label: 'Диск %' },
      { name: 'uptime', label: 'Время работы' },
    ],
  },
  {
    method: 'domain.level',
    label: 'Уровень домена',
    category: 'domain',
    icon: 'BarChart3',
    params: [],
    outputFields: [
      { name: 'domain', label: 'Домен' },
      { name: 'current_level', label: 'Текущий уровень' },
    ],
  },
  {
    method: 'domain.level.set',
    label: 'Установить уровень',
    category: 'domain',
    icon: 'ArrowUp',
    params: [
      { name: 'level', label: 'Уровень', type: 'number', required: true },
    ],
    outputFields: [
      { name: 'domain', label: 'Домен' },
      { name: 'new_level', label: 'Новый уровень' },
    ],
  },
  {
    method: 'domain.passwordsettings',
    label: 'Настройки паролей',
    category: 'domain',
    icon: 'Settings',
    params: [],
    outputFields: [
      { name: 'min_password_length', label: 'Мин. длина пароля' },
      { name: 'password_history_length', label: 'Длина истории' },
      { name: 'min_password_age', label: 'Мин. возраст (дни)' },
      { name: 'max_password_age', label: 'Макс. возраст (дни)' },
      { name: 'complexity', label: 'Сложность' },
      { name: 'account_lockout_duration', label: 'Длительность блокировки (мин)' },
      { name: 'account_lockout_threshold', label: 'Порог блокировки' },
      { name: 'reset_account_lockout_after', label: 'Сброс блокировки через (мин)' },
    ],
  },
  {
    method: 'domain.passwordsettings.set',
    label: 'Изменить настройки паролей',
    category: 'domain',
    icon: 'Settings',
    params: [
      { name: 'min_password_length', label: 'Мин. длина пароля', type: 'number' },
      { name: 'password_history_length', label: 'Длина истории', type: 'number' },
      { name: 'min_password_age', label: 'Мин. возраст (дни)', type: 'number' },
      { name: 'max_password_age', label: 'Макс. возраст (дни)', type: 'number' },
      { name: 'complexity', label: 'Сложность', type: 'boolean' },
      { name: 'store_plaintext', label: 'Хранить открытым', type: 'boolean' },
      { name: 'account_lockout_duration', label: 'Длительность блокировки (мин)', type: 'number' },
      { name: 'account_lockout_threshold', label: 'Порог блокировки', type: 'number' },
      { name: 'reset_account_lockout_after', label: 'Сброс блокировки через (мин)', type: 'number' },
    ],
    outputFields: [
      { name: 'min_password_length', label: 'Мин. длина пароля' },
      { name: 'password_history_length', label: 'Длина истории' },
      { name: 'min_password_age', label: 'Мин. возраст (дни)' },
      { name: 'max_password_age', label: 'Макс. возраст (дни)' },
      { name: 'complexity', label: 'Сложность' },
      { name: 'account_lockout_duration', label: 'Длительность блокировки (мин)' },
      { name: 'account_lockout_threshold', label: 'Порог блокировки' },
      { name: 'reset_account_lockout_after', label: 'Сброс блокировки через (мин)' },
    ],
  },
  {
    method: 'domain.trust.create',
    label: 'Создать доверие',
    category: 'domain',
    icon: 'Link',
    params: [
      { name: 'trusted_domain', label: 'Доверенный домен', type: 'string', required: true },
      { name: 'trust_type', label: 'Тип', type: 'string', required: true },
      { name: 'trust_direction', label: 'Направление', type: 'string' },
      { name: 'trust_password', label: 'Пароль доверия', type: 'string' },
    ],
    outputFields: [
      { name: 'trusted_domain', label: 'Доверенный домен' },
      { name: 'trust_type', label: 'Тип доверия' },
      { name: 'trust_direction', label: 'Направление доверия' },
    ],
  },
  {
    method: 'domain.trust.delete',
    label: 'Удалить доверие',
    category: 'domain',
    icon: 'Unlink',
    params: [
      { name: 'trusted_domain', label: 'Доверенный домен', type: 'string', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'domain.trust.list',
    label: 'Список доверий',
    category: 'domain',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'trusted_domain', label: 'Доверенный домен' },
      { name: 'trust_type', label: 'Тип доверия' },
      { name: 'trust_direction', label: 'Направление доверия' },
    ],
  },
  {
    method: 'domain.exportkeytab',
    label: 'Экспорт keytab',
    category: 'domain',
    icon: 'Download',
    params: [
      { name: 'principal', label: 'Принципал', type: 'string', required: true },
      { name: 'keytab_path', label: 'Путь keytab', type: 'string', default: '/tmp/exported.keytab' },
    ],
    outputFields: [
      { name: 'principal', label: 'Принципал' },
      { name: 'keytab_path', label: 'Путь keytab' },
    ],
  },
  {
    method: 'domain.backup.online',
    label: 'Резервная копия (онлайн)',
    category: 'domain',
    icon: 'HardDrive',
    params: [
      { name: 'target_dir', label: 'Целевая директория', type: 'string' },
      { name: 'server', label: 'Сервер', type: 'string' },
    ],
    outputFields: [
      { name: 'backup_path', label: 'Путь резервной копии' },
      { name: 'server', label: 'Сервер' },
    ],
  },
  {
    method: 'domain.backup.offline',
    label: 'Резервная копия (офлайн)',
    category: 'domain',
    icon: 'HardDrive',
    params: [
      { name: 'target_dir', label: 'Целевая директория', type: 'string' },
    ],
    outputFields: [
      { name: 'backup_path', label: 'Путь резервной копии' },
    ],
  },
  {
    method: 'domain.info.full',
    label: 'Информация о домене (полная)',
    category: 'domain',
    icon: 'Info',
    params: [],
    outputFields: [
      { name: 'domain', label: 'Домен' },
      { name: 'forest', label: 'Лес' },
      { name: 'dc', label: 'Контроллер домена' },
      { name: 'dns_name', label: 'DNS-имя' },
      { name: 'netbios_name', label: 'NetBIOS-имя' },
      { name: 'domain_functional_level', label: 'Функциональный уровень' },
      { name: 'users_count', label: 'Кол-во пользователей' },
      { name: 'groups_count', label: 'Кол-во групп' },
      { name: 'computers_count', label: 'Кол-во компьютеров' },
    ],
  },
  {
    method: 'domain.trust.namespaces',
    label: 'Пространства имён доверия',
    category: 'domain',
    icon: 'Globe',
    params: [
      { name: 'trusted_domain_name', label: 'Имя доверенного домена', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'trusted_domain_name', label: 'Имя доверенного домена' },
      { name: 'namespaces', label: 'Пространства имён' },
    ],
  },
  {
    method: 'domain.trust.validate',
    label: 'Проверить доверие',
    category: 'domain',
    icon: 'CheckCircle2',
    params: [
      { name: 'trusted_domain_name', label: 'Имя доверенного домена', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'trusted_domain_name', label: 'Имя доверенного домена' },
      { name: 'valid', label: 'Достоверно' },
      { name: 'status', label: 'Статус' },
    ],
  },
  {
    method: 'domain.kds.rootkey.create',
    label: 'Создать корневой ключ KDS',
    category: 'domain',
    icon: 'KeyRound',
    params: [],
    outputFields: [
      { name: 'key_id', label: 'ID ключа' },
      { name: 'created', label: 'Создан' },
    ],
  },
  {
    method: 'domain.kds.rootkey.list',
    label: 'Список корневых ключей KDS',
    category: 'domain',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'key_id', label: 'ID ключа' },
      { name: 'dn', label: 'DN' },
      { name: 'created', label: 'Создан' },
    ],
  },
  {
    method: 'domain.join',
    label: 'Войти в домен',
    category: 'domain',
    icon: 'LogIn',
    params: [
      { name: 'force', label: 'Принудительно', type: 'boolean', required: true },
      { name: 'domain_name', label: 'Имя домена', type: 'string' },
    ],
    outputFields: [
      { name: 'domain_name', label: 'Имя домена' },
      { name: 'joined', label: 'Присоединён' },
    ],
  },
  {
    method: 'domain.leave',
    label: 'Покинуть домен',
    category: 'domain',
    icon: 'LogOut',
    params: [
      { name: 'force', label: 'Принудительно', type: 'boolean', required: true },
    ],
    outputFields: [
      { name: 'left', label: 'Покинут' },
    ],
  },
  {
    method: 'domain.demote',
    label: 'Понизить контроллер домена',
    category: 'domain',
    icon: 'ArrowDown',
    params: [
      { name: 'force', label: 'Принудительно', type: 'boolean', required: true },
    ],
    outputFields: [
      { name: 'demoted', label: 'Понижен' },
    ],
  },
  {
    method: 'domain.claim.types',
    label: 'Типы утверждений',
    category: 'domain',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'claim_type', label: 'Тип утверждения' },
      { name: 'dn', label: 'DN' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DRS (Replication)
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'drs.showrepl',
    label: 'Статус репликации',
    category: 'drs',
    icon: 'RefreshCw',
    params: [],
    outputFields: [
      { name: 'source_dsa', label: 'Исходный DSA' },
      { name: 'destination_dsa', label: 'Целевой DSA' },
      { name: 'last_success', label: 'Последний успех' },
      { name: 'last_attempt', label: 'Последняя попытка' },
      { name: 'failures', label: 'Ошибки' },
    ],
  },
  {
    method: 'drs.replicate',
    label: 'Реплицировать',
    category: 'drs',
    icon: 'ArrowRightLeft',
    params: [
      { name: 'source_dsa', label: 'Исходный DSA', type: 'string', required: true },
      { name: 'destination_dsa', label: 'Целевой DSA', type: 'string', required: true },
      { name: 'nc_dn', label: 'NC DN', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'source_dsa', label: 'Исходный DSA' },
      { name: 'destination_dsa', label: 'Целевой DSA' },
      { name: 'nc_dn', label: 'NC DN' },
      { name: 'status', label: 'Статус' },
    ],
  },
  {
    method: 'drs.bind',
    label: 'Тест соединения DRS',
    category: 'drs',
    icon: 'Plug',
    params: [],
    outputFields: [
      { name: 'bind_status', label: 'Статус привязки' },
      { name: 'server', label: 'Сервер' },
    ],
  },
  {
    method: 'drs.options',
    label: 'Параметры DRS',
    category: 'drs',
    icon: 'Settings',
    params: [],
    outputFields: [
      { name: 'options', label: 'Параметры' },
      { name: 'server', label: 'Сервер' },
    ],
  },
  {
    method: 'drs.uptodateness',
    label: 'Актуальность',
    category: 'drs',
    icon: 'CheckCircle',
    params: [],
    outputFields: [
      { name: 'server', label: 'Сервер' },
      { name: 'usn', label: 'USN' },
      { name: 'uptodateness', label: 'Актуальность' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // FSMO
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'fsmo.show',
    label: 'Роли FSMO',
    category: 'fsmo',
    icon: 'Crown',
    params: [],
    outputFields: [
      { name: 'pdc_owner', label: 'Владелец PDC' },
      { name: 'rid_owner', label: 'Владелец RID' },
      { name: 'infrastructure_owner', label: 'Владелец инфраструктуры' },
      { name: 'naming_owner', label: 'Владелец именования' },
      { name: 'schema_owner', label: 'Владелец схемы' },
    ],
  },
  {
    method: 'fsmo.transfer',
    label: 'Передать роль',
    category: 'fsmo',
    icon: 'ArrowRight',
    params: [
      { name: 'role', label: 'Роль', type: 'select', required: true, options: [
        { label: 'PDC', value: 'pdc' },
        { label: 'RID', value: 'rid' },
        { label: 'Инфраструктура', value: 'infrastructure' },
        { label: 'Именование', value: 'naming' },
        { label: 'Схема', value: 'schema' },
      ]},
    ],
    outputFields: [
      { name: 'role', label: 'Роль' },
      { name: 'new_owner', label: 'Новый владелец' },
    ],
  },
  {
    method: 'fsmo.seize',
    label: 'Захватить роль',
    category: 'fsmo',
    icon: 'AlertTriangle',
    params: [
      { name: 'role', label: 'Роль', type: 'select', required: true, options: [
        { label: 'PDC', value: 'pdc' },
        { label: 'RID', value: 'rid' },
        { label: 'Инфраструктура', value: 'infrastructure' },
        { label: 'Именование', value: 'naming' },
        { label: 'Схема', value: 'schema' },
      ]},
    ],
    outputFields: [
      { name: 'role', label: 'Роль' },
      { name: 'new_owner', label: 'Новый владелец' },
    ],
  },
  {
    method: 'fsmo.show.full',
    label: 'FSMO роли (полные)',
    category: 'fsmo',
    icon: 'Crown',
    params: [],
    outputFields: [
      { name: 'pdc_owner', label: 'Владелец PDC' },
      { name: 'rid_owner', label: 'Владелец RID' },
      { name: 'infrastructure_owner', label: 'Владелец инфраструктуры' },
      { name: 'naming_owner', label: 'Владелец именования' },
      { name: 'schema_owner', label: 'Владелец схемы' },
      { name: 'pdc_dn', label: 'DN PDC' },
      { name: 'rid_dn', label: 'DN RID' },
      { name: 'infrastructure_dn', label: 'DN инфраструктуры' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // GPO
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'gpo.create',
    label: 'Создать GPO',
    category: 'gpo',
    icon: 'FilePlus',
    params: [
      { name: 'displayname', label: 'Отображаемое имя', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'gpo_id', label: 'ID групповой политики' },
      { name: 'displayname', label: 'Отображаемое имя' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'gpo.delete',
    label: 'Удалить GPO',
    category: 'gpo',
    icon: 'Trash2',
    params: [
      { name: 'gpo_id', label: 'ID групповой политики', type: 'string', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'gpo.list',
    label: 'Список GPO',
    category: 'gpo',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'gpo_id', label: 'ID групповой политики' },
      { name: 'displayname', label: 'Отображаемое имя' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'gpo.show',
    label: 'Просмотр GPO',
    category: 'gpo',
    icon: 'Eye',
    params: [
      { name: 'gpo_id', label: 'ID групповой политики', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'gpo_id', label: 'ID групповой политики' },
      { name: 'displayname', label: 'Отображаемое имя' },
      { name: 'dn', label: 'DN' },
      { name: 'status', label: 'Статус' },
      { name: 'version', label: 'Версия' },
    ],
  },
  {
    method: 'gpo.link',
    label: 'Привязать GPO',
    category: 'gpo',
    icon: 'Link',
    params: [
      { name: 'gpo_id', label: 'ID групповой политики', type: 'string', required: true },
      { name: 'container_dn', label: 'DN контейнера', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'gpo_id', label: 'ID групповой политики' },
      { name: 'container_dn', label: 'DN контейнера' },
      { name: 'linked', label: 'Привязано' },
    ],
  },
  {
    method: 'gpo.unlink',
    label: 'Отвязать GPO',
    category: 'gpo',
    icon: 'Unlink',
    params: [
      { name: 'gpo_id', label: 'ID групповой политики', type: 'string', required: true },
      { name: 'container_dn', label: 'DN контейнера', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'gpo_id', label: 'ID групповой политики' },
      { name: 'container_dn', label: 'DN контейнера' },
      { name: 'unlinked', label: 'Отвязано' },
    ],
  },
  {
    method: 'gpo.backup',
    label: 'Резервная копия GPO',
    category: 'gpo',
    icon: 'HardDrive',
    params: [
      { name: 'gpo_id', label: 'ID групповой политики', type: 'string', required: true },
      { name: 'target_dir', label: 'Целевая директория', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'gpo_id', label: 'ID групповой политики' },
      { name: 'backup_path', label: 'Путь резервной копии' },
    ],
  },
  {
    method: 'gpo.restore',
    label: 'Восстановить GPO',
    category: 'gpo',
    icon: 'RotateCcw',
    params: [
      { name: 'gpo_id', label: 'ID групповой политики', type: 'string', required: true },
      { name: 'source_dir', label: 'Исходная директория', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'gpo_id', label: 'ID групповой политики' },
      { name: 'restored', label: 'Восстановлено' },
    ],
  },
  {
    method: 'gpo.inherit',
    label: 'Наследование GPO',
    category: 'gpo',
    icon: 'GitBranch',
    params: [
      { name: 'gpo_id', label: 'ID групповой политики', type: 'string', required: true },
      { name: 'block', label: 'Блокировать наследование', type: 'boolean', default: true },
    ],
    outputFields: [
      { name: 'gpo_id', label: 'ID групповой политики' },
      { name: 'block_inheritance', label: 'Блокировка наследования' },
    ],
  },
  {
    method: 'gpo.list.full',
    label: 'Список GPO (полный)',
    category: 'gpo',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'gpo_id', label: 'ID групповой политики' },
      { name: 'displayname', label: 'Отображаемое имя' },
      { name: 'dn', label: 'DN' },
      { name: 'status', label: 'Статус' },
      { name: 'version', label: 'Версия' },
    ],
  },
  {
    method: 'gpo.fetch',
    label: 'Получить данные GPO',
    category: 'gpo',
    icon: 'Download',
    params: [
      { name: 'gpo_id', label: 'ID групповой политики', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'gpo_id', label: 'ID групповой политики' },
      { name: 'displayname', label: 'Отображаемое имя' },
      { name: 'data', label: 'Данные' },
    ],
  },
  {
    method: 'gpo.delete.by-name',
    label: 'Удалить GPO по имени',
    category: 'gpo',
    icon: 'Trash2',
    params: [
      { name: 'displayname', label: 'Отображаемое имя', type: 'string', required: true },
    ],
    outputFields: [],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DELEGATION
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'delegation.add',
    label: 'Добавить делегирование',
    category: 'delegation',
    icon: 'UserPlus',
    params: [
      { name: 'accountname', label: 'Имя учётной записи', type: 'string', required: true },
      { name: 'service', label: 'Сервис', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'accountname', label: 'Имя учётной записи' },
      { name: 'service', label: 'Сервис' },
      { name: 'delegated', label: 'Делегировано' },
    ],
  },
  {
    method: 'delegation.remove',
    label: 'Удалить делегирование',
    category: 'delegation',
    icon: 'UserMinus',
    params: [
      { name: 'accountname', label: 'Имя учётной записи', type: 'string', required: true },
      { name: 'service', label: 'Сервис', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'accountname', label: 'Имя учётной записи' },
      { name: 'service', label: 'Сервис' },
      { name: 'removed', label: 'Удалено' },
    ],
  },
  {
    method: 'delegation.for-account',
    label: 'Делегирования аккаунта',
    category: 'delegation',
    icon: 'List',
    params: [
      { name: 'accountname', label: 'Имя учётной записи', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'accountname', label: 'Имя учётной записи' },
      { name: 'service', label: 'Сервис' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SERVICE ACCOUNTS
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'service-account.create',
    label: 'Создать сервисный аккаунт',
    category: 'service-accounts',
    icon: 'Server',
    params: [
      { name: 'accountname', label: 'Имя учётной записи', type: 'string', required: true },
      { name: 'dns_host_name', label: 'DNS-имя узла', type: 'string', required: true },
      { name: 'description', label: 'Описание', type: 'string' },
    ],
    outputFields: [
      { name: 'accountname', label: 'Имя учётной записи' },
      { name: 'dn', label: 'DN' },
      { name: 'dns_host_name', label: 'DNS-имя узла' },
      { name: 'description', label: 'Описание' },
    ],
  },
  {
    method: 'service-account.delete',
    label: 'Удалить сервисный аккаунт',
    category: 'service-accounts',
    icon: 'Trash2',
    params: [
      { name: 'accountname', label: 'Имя учётной записи', type: 'string', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'service-account.list',
    label: 'Список сервисных аккаунтов',
    category: 'service-accounts',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'accountname', label: 'Имя учётной записи' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'service-account.show',
    label: 'Просмотр сервисного аккаунта',
    category: 'service-accounts',
    icon: 'Eye',
    params: [
      { name: 'accountname', label: 'Имя учётной записи', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'accountname', label: 'Имя учётной записи' },
      { name: 'dn', label: 'DN' },
      { name: 'dns_host_name', label: 'DNS-имя узла' },
      { name: 'description', label: 'Описание' },
      { name: 'sam_account_name', label: 'SAM-имя аккаунта' },
      { name: 'object_sid', label: 'SID объекта' },
    ],
  },
  {
    method: 'service-account.gmsa-members.add',
    label: 'Добавить gMSA участника',
    category: 'service-accounts',
    icon: 'UserPlus',
    params: [
      { name: 'accountname', label: 'Имя учётной записи', type: 'string', required: true },
      { name: 'members', label: 'Участники (через запятую)', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'accountname', label: 'Имя учётной записи' },
      { name: 'members', label: 'Добавленные участники' },
    ],
  },
  {
    method: 'service-account.gmsa-members.remove',
    label: 'Удалить gMSA участника',
    category: 'service-accounts',
    icon: 'UserMinus',
    params: [
      { name: 'accountname', label: 'Имя учётной записи', type: 'string', required: true },
      { name: 'members', label: 'Участники (через запятую)', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'accountname', label: 'Имя учётной записи' },
      { name: 'members', label: 'Удалённые участники' },
    ],
  },
  {
    method: 'service-account.gmsa-members',
    label: 'Участники gMSA',
    category: 'service-accounts',
    icon: 'Users',
    params: [
      { name: 'accountname', label: 'Имя учётной записи', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'accountname', label: 'Имя учётной записи' },
      { name: 'members', label: 'Участники' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SITES
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'site.create',
    label: 'Создать сайт',
    category: 'sites',
    icon: 'MapPin',
    params: [
      { name: 'sitename', label: 'Имя сайта', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'sitename', label: 'Имя сайта' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'site.delete',
    label: 'Удалить сайт',
    category: 'sites',
    icon: 'Trash2',
    params: [
      { name: 'sitename', label: 'Имя сайта', type: 'string', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'site.list',
    label: 'Список сайтов',
    category: 'sites',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'sitename', label: 'Имя сайта' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'site.show',
    label: 'Просмотр сайта',
    category: 'sites',
    icon: 'Eye',
    params: [
      { name: 'sitename', label: 'Имя сайта', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'sitename', label: 'Имя сайта' },
      { name: 'dn', label: 'DN' },
      { name: 'description', label: 'Описание' },
      { name: 'subnets', label: 'Подсети' },
      { name: 'servers', label: 'Серверы' },
    ],
  },
  {
    method: 'site.subnets',
    label: 'Подсети сайта',
    category: 'sites',
    icon: 'List',
    params: [
      { name: 'sitename', label: 'Имя сайта', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'subnetname', label: 'Имя подсети' },
      { name: 'dn', label: 'DN' },
      { name: 'site', label: 'Сайт' },
    ],
  },
  {
    method: 'site.subnet.create',
    label: 'Создать подсеть',
    category: 'sites',
    icon: 'Plus',
    params: [
      { name: 'sitename', label: 'Имя сайта', type: 'string', required: true },
      { name: 'subnetname', label: 'Имя подсети', type: 'string', required: true },
      { name: 'site_of_subnet', label: 'Сайт подсети', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'subnetname', label: 'Имя подсети' },
      { name: 'dn', label: 'DN' },
      { name: 'site', label: 'Сайт' },
    ],
  },
  {
    method: 'site.subnet.view',
    label: 'Просмотр подсети',
    category: 'sites',
    icon: 'Eye',
    params: [
      { name: 'subnetname', label: 'Имя подсети', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'subnetname', label: 'Имя подсети' },
      { name: 'dn', label: 'DN' },
      { name: 'site', label: 'Сайт' },
      { name: 'description', label: 'Описание' },
    ],
  },
  {
    method: 'site.subnet.delete',
    label: 'Удалить подсеть',
    category: 'sites',
    icon: 'Trash2',
    params: [
      { name: 'subnetname', label: 'Имя подсети', type: 'string', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'site.subnet.set-site',
    label: 'Назначить сайт подсети',
    category: 'sites',
    icon: 'ArrowRight',
    params: [
      { name: 'subnetname', label: 'Имя подсети', type: 'string', required: true },
      { name: 'site_of_subnet', label: 'Сайт подсети', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'subnetname', label: 'Имя подсети' },
      { name: 'new_site', label: 'Новый сайт' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // TASKS
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'tasks.list',
    label: 'Список задач',
    category: 'tasks',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'task_id', label: 'ID задачи' },
      { name: 'status', label: 'Статус' },
      { name: 'result_url', label: 'URL результата' },
    ],
  },
  {
    method: 'tasks.get',
    label: 'Получить задачу',
    category: 'tasks',
    icon: 'Search',
    params: [
      { name: 'task_id', label: 'ID задачи', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'task_id', label: 'ID задачи' },
      { name: 'status', label: 'Статус' },
      { name: 'result', label: 'Результат' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // MISC
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'misc.dbcheck',
    label: 'Проверка БД',
    category: 'misc',
    icon: 'Database',
    params: [],
    outputFields: [
      { name: 'status', label: 'Статус' },
      { name: 'errors', label: 'Ошибки' },
    ],
  },
  {
    method: 'misc.dbcheck.fix',
    label: 'Исправление БД',
    category: 'misc',
    icon: 'Wrench',
    params: [
      { name: 'yes', label: 'Подтвердить исправление', type: 'boolean', default: false },
    ],
    outputFields: [
      { name: 'status', label: 'Статус' },
      { name: 'fixes_applied', label: 'Исправлений применено' },
    ],
  },
  {
    method: 'misc.ntacl',
    label: 'NT ACL',
    category: 'misc',
    icon: 'Shield',
    params: [
      { name: 'file_path', label: 'Путь к файлу', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'file_path', label: 'Путь к файлу' },
      { name: 'owner', label: 'Владелец' },
      { name: 'acl', label: 'ACL' },
    ],
  },
  {
    method: 'misc.ntacl.set',
    label: 'Установить NT ACL',
    category: 'misc',
    icon: 'Shield',
    params: [
      { name: 'file_path', label: 'Путь к файлу', type: 'string', required: true },
      { name: 'sddl', label: 'SDDL', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'file_path', label: 'Путь к файлу' },
      { name: 'sddl', label: 'SDDL' },
      { name: 'set', label: 'Установлено' },
    ],
  },
  {
    method: 'misc.sysvolreset',
    label: 'Сброс ACL sysvol',
    category: 'misc',
    icon: 'RefreshCw',
    params: [],
    outputFields: [
      { name: 'reset', label: 'Сброшено' },
    ],
  },
  {
    method: 'misc.testparm',
    label: 'Проверка конфигурации',
    category: 'misc',
    icon: 'CheckCircle2',
    params: [],
    outputFields: [
      { name: 'status', label: 'Статус' },
      { name: 'errors', label: 'Ошибки' },
    ],
  },
  {
    method: 'misc.processes',
    label: 'Процессы Samba',
    category: 'misc',
    icon: 'Activity',
    params: [],
    outputFields: [
      { name: 'pid', label: 'PID' },
      { name: 'name', label: 'Имя' },
      { name: 'status', label: 'Статус' },
    ],
  },
  {
    method: 'misc.time',
    label: 'Время сервера',
    category: 'misc',
    icon: 'Clock',
    params: [
      { name: 'server', label: 'Сервер', type: 'string' },
    ],
    outputFields: [
      { name: 'server', label: 'Сервер' },
      { name: 'time', label: 'Время' },
    ],
  },
  {
    method: 'misc.spn.list',
    label: 'Список SPN',
    category: 'misc',
    icon: 'List',
    params: [
      { name: 'accountname', label: 'Имя учётной записи', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'accountname', label: 'Имя учётной записи' },
      { name: 'spn', label: 'SPN' },
    ],
  },
  {
    method: 'misc.spn.add',
    label: 'Добавить SPN',
    category: 'misc',
    icon: 'Plus',
    params: [
      { name: 'accountname', label: 'Имя учётной записи', type: 'string', required: true },
      { name: 'spn', label: 'SPN', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'accountname', label: 'Имя учётной записи' },
      { name: 'spn', label: 'SPN' },
      { name: 'added', label: 'Добавлен' },
    ],
  },
  {
    method: 'misc.spn.delete',
    label: 'Удалить SPN',
    category: 'misc',
    icon: 'Minus',
    params: [
      { name: 'accountname', label: 'Имя учётной записи', type: 'string', required: true },
      { name: 'spn', label: 'SPN', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'accountname', label: 'Имя учётной записи' },
      { name: 'spn', label: 'SPN' },
      { name: 'deleted', label: 'Удалён' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SYSTEM
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'system.health',
    label: 'Проверка здоровья',
    category: 'system',
    icon: 'HeartPulse',
    params: [],
    outputFields: [
      { name: 'status', label: 'Статус' },
      { name: 'uptime', label: 'Время работы' },
    ],
  },
  {
    method: 'system.health.detailed',
    label: 'Подробная проверка здоровья',
    category: 'system',
    icon: 'HeartPulse',
    params: [],
    outputFields: [
      { name: 'status', label: 'Статус' },
      { name: 'uptime', label: 'Время работы' },
      { name: 'cpu_percent', label: 'CPU %' },
      { name: 'memory_percent', label: 'Память %' },
      { name: 'disk_percent', label: 'Диск %' },
    ],
  },
  {
    method: 'system.metrics',
    label: 'Prometheus метрики',
    category: 'system',
    icon: 'BarChart3',
    params: [],
    outputFields: [
      { name: 'metrics', label: 'Метрики' },
    ],
  },
  {
    method: 'system.stats',
    label: 'Статистика системы',
    category: 'system',
    icon: 'Activity',
    params: [],
    outputFields: [
      { name: 'cpu_percent', label: 'CPU %' },
      { name: 'memory_percent', label: 'Память %' },
      { name: 'disk_percent', label: 'Диск %' },
      { name: 'uptime', label: 'Время работы' },
      { name: 'connections', label: 'Соединения' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // AUTH
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'auth.login',
    label: 'Вход',
    category: 'auth',
    icon: 'LogIn',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
      { name: 'password', label: 'Пароль', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'token', label: 'Токен' },
      { name: 'role', label: 'Роль' },
    ],
  },
  {
    method: 'auth.refresh',
    label: 'Обновить токен',
    category: 'auth',
    icon: 'RefreshCw',
    params: [
      { name: 'refresh_token', label: 'Токен обновления', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'token', label: 'Токен' },
      { name: 'refresh_token', label: 'Токен обновления' },
    ],
  },
  {
    method: 'auth.me',
    label: 'Мой профиль',
    category: 'auth',
    icon: 'User',
    params: [],
    outputFields: [
      { name: 'username', label: 'Имя пользователя' },
      { name: 'role', label: 'Роль' },
      { name: 'permissions', label: 'Права' },
    ],
  },
  {
    method: 'auth.check',
    label: 'Проверить учётные данные',
    category: 'auth',
    icon: 'ShieldCheck',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string' },
      { name: 'password', label: 'Пароль', type: 'string' },
    ],
    outputFields: [
      { name: 'valid', label: 'Достоверны' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'mgmt.user.list',
    label: 'Список пользователей управления',
    category: 'management',
    icon: 'List',
    params: [
      { name: 'role', label: 'Роль', type: 'string' },
      { name: 'is_active', label: 'Активен', type: 'boolean' },
      { name: 'offset', label: 'Смещение', type: 'number', default: 0 },
      { name: 'limit', label: 'Лимит', type: 'number', default: 100 },
    ],
    outputFields: [
      { name: 'user_id', label: 'ID пользователя' },
      { name: 'username', label: 'Имя пользователя' },
      { name: 'role', label: 'Роль' },
      { name: 'is_active', label: 'Активен' },
    ],
  },
  {
    method: 'mgmt.user.create',
    label: 'Создать пользователя управления',
    category: 'management',
    icon: 'UserPlus',
    params: [
      { name: 'username', label: 'Имя пользователя', type: 'string', required: true },
      { name: 'password', label: 'Пароль', type: 'string', required: true },
      { name: 'role', label: 'Роль', type: 'string', default: 'operator' },
      { name: 'full_name', label: 'Полное имя', type: 'string' },
      { name: 'email', label: 'Email', type: 'string' },
    ],
    outputFields: [
      { name: 'user_id', label: 'ID пользователя' },
      { name: 'username', label: 'Имя пользователя' },
      { name: 'role', label: 'Роль' },
    ],
  },
  {
    method: 'mgmt.user.get',
    label: 'Получить пользователя управления',
    category: 'management',
    icon: 'Eye',
    params: [
      { name: 'user_id', label: 'ID пользователя', type: 'number', required: true },
    ],
    outputFields: [
      { name: 'user_id', label: 'ID пользователя' },
      { name: 'username', label: 'Имя пользователя' },
      { name: 'role', label: 'Роль' },
      { name: 'full_name', label: 'Полное имя' },
      { name: 'email', label: 'Email' },
      { name: 'is_active', label: 'Активен' },
    ],
  },
  {
    method: 'mgmt.user.update',
    label: 'Обновить пользователя управления',
    category: 'management',
    icon: 'PenLine',
    params: [
      { name: 'user_id', label: 'ID пользователя', type: 'number', required: true },
      { name: 'username', label: 'Имя пользователя', type: 'string' },
      { name: 'password', label: 'Пароль', type: 'string' },
      { name: 'role', label: 'Роль', type: 'string' },
      { name: 'full_name', label: 'Полное имя', type: 'string' },
      { name: 'email', label: 'Email', type: 'string' },
      { name: 'is_active', label: 'Активен', type: 'boolean' },
    ],
    outputFields: [
      { name: 'user_id', label: 'ID пользователя' },
      { name: 'updated', label: 'Обновлено' },
    ],
  },
  {
    method: 'mgmt.user.delete',
    label: 'Удалить пользователя управления',
    category: 'management',
    icon: 'Trash2',
    params: [
      { name: 'user_id', label: 'ID пользователя', type: 'number', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'mgmt.key.list',
    label: 'Список API-ключей',
    category: 'management',
    icon: 'List',
    params: [
      { name: 'user_id', label: 'ID пользователя', type: 'number' },
      { name: 'is_active', label: 'Активен', type: 'boolean' },
      { name: 'offset', label: 'Смещение', type: 'number', default: 0 },
      { name: 'limit', label: 'Лимит', type: 'number', default: 100 },
    ],
    outputFields: [
      { name: 'key_id', label: 'ID ключа' },
      { name: 'name', label: 'Имя' },
      { name: 'role', label: 'Роль' },
      { name: 'is_active', label: 'Активен' },
    ],
  },
  {
    method: 'mgmt.key.create',
    label: 'Создать API-ключ',
    category: 'management',
    icon: 'KeyRound',
    params: [
      { name: 'user_id', label: 'ID пользователя', type: 'number', required: true },
      { name: 'name', label: 'Имя', type: 'string', required: true },
      { name: 'role', label: 'Роль', type: 'string', default: 'operator' },
      { name: 'expires_days', label: 'Дней до истечения', type: 'number' },
    ],
    outputFields: [
      { name: 'key_id', label: 'ID ключа' },
      { name: 'api_key', label: 'API-ключ' },
      { name: 'name', label: 'Имя' },
    ],
  },
  {
    method: 'mgmt.key.get',
    label: 'Получить API-ключ',
    category: 'management',
    icon: 'Eye',
    params: [
      { name: 'key_id', label: 'ID ключа', type: 'number', required: true },
    ],
    outputFields: [
      { name: 'key_id', label: 'ID ключа' },
      { name: 'name', label: 'Имя' },
      { name: 'role', label: 'Роль' },
      { name: 'is_active', label: 'Активен' },
      { name: 'expires_at', label: 'Истекает' },
    ],
  },
  {
    method: 'mgmt.key.update',
    label: 'Обновить API-ключ',
    category: 'management',
    icon: 'PenLine',
    params: [
      { name: 'key_id', label: 'ID ключа', type: 'number', required: true },
      { name: 'name', label: 'Имя', type: 'string' },
      { name: 'role', label: 'Роль', type: 'string' },
      { name: 'is_active', label: 'Активен', type: 'boolean' },
      { name: 'expires_days', label: 'Дней до истечения', type: 'number' },
    ],
    outputFields: [
      { name: 'key_id', label: 'ID ключа' },
      { name: 'updated', label: 'Обновлено' },
    ],
  },
  {
    method: 'mgmt.key.delete',
    label: 'Удалить API-ключ',
    category: 'management',
    icon: 'Trash2',
    params: [
      { name: 'key_id', label: 'ID ключа', type: 'number', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'mgmt.key.rotate',
    label: 'Повернуть API-ключ',
    category: 'management',
    icon: 'RefreshCw',
    params: [
      { name: 'key_id', label: 'ID ключа', type: 'number', required: true },
    ],
    outputFields: [
      { name: 'key_id', label: 'ID ключа' },
      { name: 'new_api_key', label: 'Новый API-ключ' },
    ],
  },
  {
    method: 'mgmt.role.list',
    label: 'Список ролей',
    category: 'management',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'name', label: 'Имя роли' },
      { name: 'description', label: 'Описание' },
      { name: 'permissions', label: 'Права' },
    ],
  },
  {
    method: 'mgmt.role.create',
    label: 'Создать роль',
    category: 'management',
    icon: 'Plus',
    params: [
      { name: 'name', label: 'Имя роли', type: 'string', required: true },
      { name: 'description', label: 'Описание', type: 'string' },
      { name: 'permissions', label: 'Права (через запятую)', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'name', label: 'Имя роли' },
      { name: 'description', label: 'Описание' },
    ],
  },
  {
    method: 'mgmt.role.get',
    label: 'Получить роль',
    category: 'management',
    icon: 'Eye',
    params: [
      { name: 'role_name', label: 'Имя роли', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'name', label: 'Имя роли' },
      { name: 'description', label: 'Описание' },
      { name: 'permissions', label: 'Права' },
    ],
  },
  {
    method: 'mgmt.role.update',
    label: 'Обновить роль',
    category: 'management',
    icon: 'PenLine',
    params: [
      { name: 'role_name', label: 'Имя роли', type: 'string', required: true },
      { name: 'name', label: 'Новое имя', type: 'string' },
      { name: 'description', label: 'Описание', type: 'string' },
      { name: 'permissions', label: 'Права (через запятую)', type: 'string' },
    ],
    outputFields: [
      { name: 'name', label: 'Имя роли' },
      { name: 'updated', label: 'Обновлено' },
    ],
  },
  {
    method: 'mgmt.role.delete',
    label: 'Удалить роль',
    category: 'management',
    icon: 'Trash2',
    params: [
      { name: 'role_name', label: 'Имя роли', type: 'string', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'mgmt.permissions',
    label: 'Список разрешений',
    category: 'management',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'name', label: 'Имя' },
      { name: 'description', label: 'Описание' },
    ],
  },
  {
    method: 'mgmt.permissions.assign',
    label: 'Назначить разрешения',
    category: 'management',
    icon: 'ShieldCheck',
    params: [
      { name: 'role_name', label: 'Имя роли', type: 'string', required: true },
      { name: 'permissions', label: 'Права (через запятую)', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'role_name', label: 'Имя роли' },
      { name: 'permissions', label: 'Права' },
      { name: 'assigned', label: 'Назначены' },
    ],
  },
  {
    method: 'mgmt.permissions.revoke',
    label: 'Отозвать разрешения',
    category: 'management',
    icon: 'ShieldX',
    params: [
      { name: 'role_name', label: 'Имя роли', type: 'string', required: true },
      { name: 'permissions', label: 'Права (через запятую)', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'role_name', label: 'Имя роли' },
      { name: 'permissions', label: 'Права' },
      { name: 'revoked', label: 'Отозваны' },
    ],
  },
  {
    method: 'mgmt.audit',
    label: 'Журнал аудита',
    category: 'management',
    icon: 'ScrollText',
    params: [
      { name: 'user_id', label: 'ID пользователя', type: 'number' },
      { name: 'action', label: 'Действие', type: 'string' },
      { name: 'endpoint', label: 'Конечная точка', type: 'string' },
      { name: 'offset', label: 'Смещение', type: 'number', default: 0 },
      { name: 'limit', label: 'Лимит', type: 'number', default: 100 },
    ],
    outputFields: [
      { name: 'timestamp', label: 'Время' },
      { name: 'user_id', label: 'ID пользователя' },
      { name: 'action', label: 'Действие' },
      { name: 'endpoint', label: 'Конечная точка' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // BATCH OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'batch.execute',
    label: 'Выполнить пакет операций',
    category: 'batch',
    icon: 'Layers',
    params: [
      { name: 'actions', label: 'Действия (JSON)', type: 'string', required: true },
      { name: 'stop_on_failure', label: 'Остановка при ошибке', type: 'boolean', default: true },
      { name: 'rollback_on_failure', label: 'Откат при ошибке', type: 'boolean', default: false },
      { name: 'default_timeout', label: 'Таймаут по умолчанию (сек)', type: 'number', default: 30 },
      { name: 'batch_id', label: 'ID пакета', type: 'string' },
    ],
    outputFields: [
      { name: 'batch_id', label: 'ID пакета' },
      { name: 'total_steps', label: 'Всего шагов' },
      { name: 'successful_steps', label: 'Успешных' },
      { name: 'failed_steps', label: 'Ошибок' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // AUTH POLICY (Silo / Policy)
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'auth.silo.list',
    label: 'Список силосов',
    category: 'auth-policy',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'siloname', label: 'Имя силоса' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'auth.silo.create',
    label: 'Создать силос',
    category: 'auth-policy',
    icon: 'Plus',
    params: [
      { name: 'siloname', label: 'Имя силоса', type: 'string', required: true },
      { name: 'description', label: 'Описание', type: 'string' },
    ],
    outputFields: [
      { name: 'siloname', label: 'Имя силоса' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'auth.silo.show',
    label: 'Просмотр силоса',
    category: 'auth-policy',
    icon: 'Eye',
    params: [
      { name: 'siloname', label: 'Имя силоса', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'siloname', label: 'Имя силоса' },
      { name: 'dn', label: 'DN' },
      { name: 'description', label: 'Описание' },
      { name: 'members', label: 'Участники' },
    ],
  },
  {
    method: 'auth.silo.delete',
    label: 'Удалить силос',
    category: 'auth-policy',
    icon: 'Trash2',
    params: [
      { name: 'siloname', label: 'Имя силоса', type: 'string', required: true },
    ],
    outputFields: [],
  },
  {
    method: 'auth.silo.member.add',
    label: 'Добавить участника в силос',
    category: 'auth-policy',
    icon: 'UserPlus',
    params: [
      { name: 'siloname', label: 'Имя силоса', type: 'string', required: true },
      { name: 'accountname', label: 'Имя учётной записи', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'siloname', label: 'Имя силоса' },
      { name: 'accountname', label: 'Имя учётной записи' },
      { name: 'added', label: 'Добавлен' },
    ],
  },
  {
    method: 'auth.silo.member.remove',
    label: 'Удалить участника из силоса',
    category: 'auth-policy',
    icon: 'UserMinus',
    params: [
      { name: 'siloname', label: 'Имя силоса', type: 'string', required: true },
      { name: 'accountname', label: 'Имя учётной записи', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'siloname', label: 'Имя силоса' },
      { name: 'accountname', label: 'Имя учётной записи' },
      { name: 'removed', label: 'Удалён' },
    ],
  },
  {
    method: 'auth.policy.list',
    label: 'Список политик',
    category: 'auth-policy',
    icon: 'List',
    params: [],
    outputFields: [
      { name: 'policyname', label: 'Имя политики' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'auth.policy.create',
    label: 'Создать политику',
    category: 'auth-policy',
    icon: 'Plus',
    params: [
      { name: 'policyname', label: 'Имя политики', type: 'string', required: true },
      { name: 'description', label: 'Описание', type: 'string' },
    ],
    outputFields: [
      { name: 'policyname', label: 'Имя политики' },
      { name: 'dn', label: 'DN' },
    ],
  },
  {
    method: 'auth.policy.show',
    label: 'Просмотр политики',
    category: 'auth-policy',
    icon: 'Eye',
    params: [
      { name: 'policyname', label: 'Имя политики', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'policyname', label: 'Имя политики' },
      { name: 'dn', label: 'DN' },
      { name: 'description', label: 'Описание' },
    ],
  },
  {
    method: 'auth.policy.delete',
    label: 'Удалить политику',
    category: 'auth-policy',
    icon: 'Trash2',
    params: [
      { name: 'policyname', label: 'Имя политики', type: 'string', required: true },
    ],
    outputFields: [],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SCHEMA
  // ═══════════════════════════════════════════════════════════════════════
  {
    method: 'schema.attribute.show',
    label: 'Просмотр атрибута схемы',
    category: 'schema',
    icon: 'Eye',
    params: [
      { name: 'attribute', label: 'Атрибут', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'attribute', label: 'Атрибут' },
      { name: 'dn', label: 'DN' },
      { name: 'syntax', label: 'Синтаксис' },
      { name: 'description', label: 'Описание' },
    ],
  },
  {
    method: 'schema.class.show',
    label: 'Просмотр класса схемы',
    category: 'schema',
    icon: 'Eye',
    params: [
      { name: 'classname', label: 'Класс', type: 'string', required: true },
    ],
    outputFields: [
      { name: 'classname', label: 'Класс' },
      { name: 'dn', label: 'DN' },
      { name: 'description', label: 'Описание' },
      { name: 'attributes', label: 'Атрибуты' },
    ],
  },
];

export const CATEGORIES = [
  { id: 'users', label: 'Пользователи', color: 'bg-blue-500' },
  { id: 'groups', label: 'Группы', color: 'bg-green-500' },
  { id: 'contacts', label: 'Контакты', color: 'bg-teal-500' },
  { id: 'computers', label: 'Компьютеры', color: 'bg-cyan-500' },
  { id: 'dns', label: 'DNS', color: 'bg-purple-500' },
  { id: 'ou', label: 'Подразделения', color: 'bg-orange-500' },
  { id: 'shell', label: 'Оболочка', color: 'bg-red-500' },
  { id: 'domain', label: 'Домен', color: 'bg-yellow-500' },
  { id: 'drs', label: 'Репликация', color: 'bg-indigo-500' },
  { id: 'fsmo', label: 'FSMO', color: 'bg-amber-500' },
  { id: 'gpo', label: 'Групповые политики', color: 'bg-pink-500' },
  { id: 'delegation', label: 'Делегирование', color: 'bg-lime-500' },
  { id: 'service-accounts', label: 'Сервисные аккаунты', color: 'bg-violet-500' },
  { id: 'sites', label: 'Сайты', color: 'bg-sky-500' },
  { id: 'shell-project', label: 'Shell-проекты', color: 'bg-rose-500' },
  { id: 'tasks', label: 'Задачи', color: 'bg-slate-500' },
  { id: 'misc', label: 'Разное', color: 'bg-gray-500' },
  { id: 'system', label: 'Система', color: 'bg-emerald-500' },
  { id: 'auth', label: 'Авторизация', color: 'bg-fuchsia-500' },
  { id: 'management', label: 'Управление', color: 'bg-stone-500' },
  { id: 'batch', label: 'Пакетные операции', color: 'bg-zinc-500' },
  { id: 'auth-policy', label: 'Политики авторизации', color: 'bg-rose-400' },
  { id: 'schema', label: 'Схема', color: 'bg-neutral-500' },
];
