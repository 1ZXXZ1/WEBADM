'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Settings2, Plus, X, Eye, EyeOff, ChevronUp } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { tryDecodeLdapValue } from '@/lib/parsers';

// ── LDAP Attribute Localization Map (EN → RU) ──────────────────────────
const LDAP_ATTR_RU: Record<string, string> = {
  // ─── Identity ──────────────────────────────────────────────────────
  dn: 'Различаемое имя',
  cn: 'Общее имя',
  sAMAccountName: 'Учётная запись',
  displayName: 'Отображаемое имя',
  name: 'Имя',
  sn: 'Фамилия',
  givenName: 'Имя',
  initials: 'Инициалы',
  description: 'Описание',
  distinguishedName: 'Различаемое имя (DN)',
  // ─── Object metadata ───────────────────────────────────────────────
  objectClass: 'Класс объекта',
  objectCategory: 'Категория объекта',
  objectGUID: 'GUID объекта',
  objectSid: 'SID объекта',
  objectVersion: 'Версия объекта',
  instanceType: 'Тип экземпляра',
  isCriticalSystemObject: 'Критический системный объект',
  isDeleted: 'Удалён',
  isRecycled: 'В корзине',
  adminCount: 'Счётчик администратора',
  canonicalName: 'Каноническое имя',
  // ─── Account ───────────────────────────────────────────────────────
  userAccountControl: 'Управление учётной записью',
  accountExpires: 'Срок действия учётной записи',
  pwdLastSet: 'Последняя смена пароля',
  lastLogon: 'Последний вход',
  lastLogonTimestamp: 'Отметка последнего входа',
  lastLogoff: 'Последний выход',
  logonCount: 'Количество входов',
  badPwdCount: 'Количество неверных паролей',
  badPasswordTime: 'Время неверного пароля',
  lockoutTime: 'Время блокировки',
  sAMAccountType: 'Тип учётной записи SAM',
  userPrincipalName: 'UPN (основное имя пользователя)',
  // ─── Group ─────────────────────────────────────────────────────────
  groupType: 'Тип группы',
  member: 'Участники',
  memberOf: 'Входит в группы',
  primaryGroupID: 'ID основной группы',
  // ─── Contact / Org ────────────────────────────────────────────────
  mail: 'Электронная почта',
  telephoneNumber: 'Телефон',
  mobile: 'Мобильный телефон',
  facsimileTelephoneNumber: 'Факс',
  homePhone: 'Домашний телефон',
  pager: 'Пейджер',
  company: 'Компания',
  department: 'Отдел',
  title: 'Должность',
  manager: 'Руководитель',
  directReports: 'Подчинённые',
  streetAddress: 'Адрес улицы',
  l: 'Город',
  st: 'Область/Штат',
  postalCode: 'Почтовый индекс',
  co: 'Страна',
  c: 'Код страны',
  wWWHomePage: 'Веб-страница',
  physicalDeliveryOfficeName: 'Офис',
  // ─── Profile / Logon ──────────────────────────────────────────────
  profilePath: 'Путь профиля',
  scriptPath: 'Путь скрипта',
  homeDrive: 'Домашний диск',
  homeDirectory: 'Домашняя директория',
  userWorkstations: 'Рабочие станции',
  // ─── Unix / RFC2307 ───────────────────────────────────────────────
  uidNumber: 'Номер UID',
  gidNumber: 'Номер GID',
  unixHomeDirectory: 'Домашняя директория Unix',
  loginShell: 'Оболочка входа',
  uid: 'UID',
  gecos: 'GECOS',
  msSFU30Name: 'Имя SFU',
  msSFU30NisDomain: 'NIS-домен SFU',
  // ─── Security ──────────────────────────────────────────────────────
  sIDHistory: 'История SID',
  securityIdentifier: 'Идентификатор безопасности',
  trustType: 'Тип доверия',
  trustDirection: 'Направление доверия',
  trustAttributes: 'Атрибуты доверия',
  // ─── Schema ────────────────────────────────────────────────────────
  schemaIDGUID: 'GUID схемы',
  attributeID: 'ID атрибута',
  attributeSyntax: 'Синтаксис атрибута',
  oMSyntax: 'Синтаксис OM',
  isSingleValued: 'Однозначный',
  searchFlags: 'Флаги поиска',
  systemFlags: 'Системные флаги',
  // ─── GPO ───────────────────────────────────────────────────────────
  gPCFileSysPath: 'Путь файловой системы GPO',
  gPLink: 'Ссылка GPO',
  gPOptions: 'Параметры GPO',
  versionNumber: 'Номер версии',
  flags: 'Флаги',
  // ─── Time ──────────────────────────────────────────────────────────
  whenCreated: 'Дата создания',
  whenChanged: 'Дата изменения',
  createTimeStamp: 'Метка создания',
  modifyTimeStamp: 'Метка изменения',
  createTime: 'Время создания',
  modifyTime: 'Время изменения',
  // ─── Computer ──────────────────────────────────────────────────────
  operatingSystem: 'Операционная система',
  operatingSystemVersion: 'Версия ОС',
  operatingSystemServicePack: 'Сервисный пакет ОС',
  dNSHostName: 'DNS-имя узла',
  servicePrincipalName: 'Имя участника-службы',
  // ─── OU ────────────────────────────────────────────────────────────
  ou: 'Подразделение',
  managedBy: 'Управляется',
  // ─── DNS ───────────────────────────────────────────────────────────
  dNSTombstoned: 'DNS-удалён',
  dnsRecord: 'DNS-запись',
  dnsProperty: 'DNS-свойство',
  // ─── Replication ───────────────────────────────────────────────────
  uSNCreated: 'USN создания',
  uSNChanged: 'USN изменения',
  dsCorePropagationData: 'Данные распространения',
  propagationData: 'Данные распространения',
  replPropertyMetaData: 'Метаданные репликации свойств',
  // ─── RID ───────────────────────────────────────────────────────────
  rIDAvailablePool: 'Доступный пул RID',
  rIDPreviousAllocationPool: 'Предыдущий пул RID',
  rIDNextRID: 'Следующий RID',
  rIDSetReferences: 'Ссылки на набор RID',
  localPolicyFlags: 'Флаги локальной политики',
  // ─── FSMO ──────────────────────────────────────────────────────────
  fSMORoleOwner: 'Владелец роли FSMO',
  masteredBy: 'Управляется (мастер)',
  // ─── Other LDAP ────────────────────────────────────────────────────
  codePage: 'Кодовая страница',
  countryCode: 'Код страны',
  localeID: 'ID локали',
  preferredLanguage: 'Предпочитаемый язык',
  info: 'Информация',
  notes: 'Заметки',
  url: 'URL',
  thumbnailPhoto: 'Фотография',
  jpegPhoto: 'Фото JPEG',
  userCertificate: 'Сертификат пользователя',
  showInAdvancedViewOnly: 'Показывать только в расширенном виде',
  allowedAttributes: 'Разрешённые атрибуты',
  allowedAttributesEffective: 'Действующие разрешённые атрибуты',
  allowedChildClasses: 'Допустимые дочерние классы',
  allowedChildClassesEffective: 'Действующие дочерние классы',
  subSchemaSubEntry: 'Подзапись подсхемы',
  entryDN: 'DN записи',
  hasMasterNCs: 'Имеет мастер NCs',
  serverReferenceBL: 'Обратная ссылка сервера',
  frsComputerReferenceBL: 'Обратная ссылка FRS',
  wellKnownObjects: 'Известные объекты',
  otherWellKnownObjects: 'Другие известные объекты',
  // ─── msDS-* (quoted keys for hyphens) ──────────────────────────────
  'msDS-SupportedEncryptionTypes': 'Поддерживаемые типы шифрования',
  'msDS-KeyVersionNumber': 'Номер версии ключа',
  'msDS-ResultantPSO': 'Результирующая PSO',
  'msDS-PasswordSettingsAppliesTo': 'Параметры пароля применяются к',
  'msDS-Approx-Immed-Subordinates': 'Приблизительное кол-во подчинённых',
  'msDS-Behavior-Version': 'Версия поведения домена',
  'msDS-forestBehaviorVersion': 'Версия поведения леса',
  'lowest_dc_msDS-Behavior-Version': 'Версия поведения низшего DC',
  // ─── Domain / computed ─────────────────────────────────────────────
  domain: 'Домен',
  status: 'Статус',
  gpo_id: 'ID групповой политики',
  domain_function_level: 'Функциональный уровень домена',
  forest_function_level: 'Функциональный уровень леса',
  lowest_dc_function_level: 'Уровень низшего DC',
  password_settings: 'Настройки паролей',
  fsmo_roles: 'Роли FSMO',
  dnsPartitions: 'DNS-разделы',
  dn_DomainDnsZones: 'DN DomainDnsZones',
  dn_ForestDnsZones: 'DN ForestDnsZones',
  // ─── FSMO Role names ────────────────────────────────────────────────
  SchemaMasterRole: 'Мастер схемы',
  InfrastructureMasterRole: 'Мастер инфраструктуры',
  RidAllocationMasterRole: 'Мастер распределения RID',
  PdcEmulationRole: 'Эмулятор PDC',
  DomainNamingMasterRole: 'Мастер именования доменов',
  schema_master: 'Мастер схемы',
  infrastructure_master: 'Мастер инфраструктуры',
  rid_allocator_master: 'Мастер распределения RID',
  pdc_emulator: 'Эмулятор PDC',
  domain_naming_master: 'Мастер именования доменов',
  // ─── Trust attributes ───────────────────────────────────────────────
  trustPartner: 'Партнёр доверия',
  trustType: 'Тип доверия',
  trustDirection: 'Направление доверия',
  trustAttributes: 'Атрибуты доверия',
  flatName: 'Плоское имя',
  trusted_domain: 'Доверенный домен',
  trustPassword: 'Пароль доверия',
  // ─── Domain-specific LDAP ───────────────────────────────────────────
  'msDS-Behavior-Version': 'Версия поведения домена',
  'msDS-forestBehaviorVersion': 'Версия поведения леса',
  'lowest_dc_msDS-Behavior-Version': 'Версия поведения низшего DC',
  fSMORoleOwner: 'Владелец роли FSMO',
  objectVersion: 'Версия объекта',
  // ─── Password Policy (snake_case display keys) ──────────────────────
  min_password_length: 'Мин. длина пароля',
  minimum_password_length: 'Мин. длина пароля',
  password_complexity: 'Сложность пароля',
  complexity: 'Сложность',
  password_history_length: 'Длина истории паролей',
  min_password_age: 'Мин. возраст пароля (дни)',
  minimum_password_age: 'Мин. возраст пароля (дни)',
  max_password_age: 'Макс. возраст пароля (дни)',
  maximum_password_age: 'Макс. возраст пароля (дни)',
  store_plaintext: 'Хранить в открытом виде',
  account_lockout_duration: 'Длительность блокировки (мин)',
  account_lockout_threshold: 'Порог блокировки',
  reset_account_lockout_after: 'Сброс блокировки через (мин)',
  password_properties: 'Свойства пароля',
  // ─── Password Policy (CamelCase LDAP from AD password_settings) ─────
  lockOutObservationWindow: 'Сброс блокировки через (мин)',
  lockoutDuration: 'Длительность блокировки (мин)',
  lockoutThreshold: 'Порог блокировки',
  maxPwdAge: 'Макс. возраст пароля',
  minPwdAge: 'Мин. возраст пароля',
  minPwdLength: 'Мин. длина пароля',
  pwdHistoryLength: 'Длина истории паролей',
  pwdProperties: 'Свойства пароля',
  pwdComplexity: 'Сложность пароля',
  // ─── FSMO partition-specific roles ──────────────────────────────────
  InfrastructureMasterRole_DomainDnsZones: 'Мастер инфраструктуры (DomainDnsZones)',
  InfrastructureMasterRole_ForestDnsZones: 'Мастер инфраструктуры (ForestDnsZones)',
  // ─── Stats ─────────────────────────────────────────────────────────
  'stats.computer_count': 'Кол-во компьютеров',
  'stats.contact_count': 'Кол-во контактов',
  'stats.group_count': 'Кол-во групп',
  'stats.ou_count': 'Кол-во подразделений',
  'stats.ou_dn': 'DN подразделения',
  'stats.total_objects': 'Всего объектов',
  'stats.user_count': 'Кол-во пользователей',
  // ─── ETL / Operation params ────────────────────────────────────────
  username: 'Имя пользователя',
  surname: 'Фамилия',
  password: 'Пароль',
  must_change_at_next_login: 'Сменить пароль при следующем входе',
  random_password: 'Случайный пароль',
  smartcard_required: 'Требуется смарт-карта',
  use_username_as_cn: 'Использовать имя как CN',
  userou: 'Подразделение (OU) пользователя',
  given_name: 'Имя',
  profile_path: 'Путь профиля',
  script_path: 'Путь скрипта',
  home_drive: 'Домашний диск',
  home_directory: 'Домашняя директория',
  job_title: 'Должность',
  department: 'Отдел',
  company: 'Компания',
  mail_address: 'Электронная почта',
  internet_address: 'Интернет-адрес',
  telephone_number: 'Телефон',
  physical_delivery_office: 'Офис доставки',
  rfc2307_from_nss: 'RFC2307 из NSS',
  nis_domain: 'NIS-домен',
  unix_home: 'Домашняя директория Unix',
  uid_number: 'Номер UID',
  gid_number: 'Номер GID',
  login_shell: 'Оболочка входа',
  display_name: 'Отображаемое имя',
  street_address: 'Адрес улицы',
  city: 'Город',
  state: 'Область/Штат',
  postal_code: 'Почтовый индекс',
  country: 'Страна',
  new_password: 'Новый пароль',
  verbose: 'Подробно',
  base_dn: 'Базовый DN',
  attributes: 'Атрибуты',
  new_parent_dn: 'Новый родительский DN',
  new_name: 'Новое имя',
  days: 'Дни',
  groupname: 'Имя группы',
  groupou: 'Подразделение (OU) группы',
  group_scope: 'Область действия группы',
  group_type: 'Тип группы',
  members: 'Участники',
  contactname: 'Имя контакта',
  contactou: 'Подразделение (OU) контакта',
  computername: 'Имя компьютера',
  computerou: 'Подразделение (OU) компьютера',
  ip_address_list: 'Список IP-адресов',
  service_principal_name_list: 'Список SPN',
  zone: 'Зона',
  record_type: 'Тип записи',
  data: 'Данные',
  old_record_type: 'Старый тип',
  old_data: 'Старые данные',
  new_data: 'Новые данные',
  dns_directory_partition: 'Раздел каталога DNS',
  ouname: 'Имя подразделения',
  cmd: 'Команда',
  shell: 'Оболочка',
  sudo: 'Sudo',
  timeout: 'Таймаут (сек)',
  lines: 'Строки скрипта',
  ip_address: 'IP-адрес',
  level: 'Уровень',
  min_password_length: 'Мин. длина пароля',
  password_history_length: 'Длина истории паролей',
  min_password_age: 'Мин. возраст пароля (дни)',
  max_password_age: 'Макс. возраст пароля (дни)',
  complexity: 'Сложность',
  store_plaintext: 'Хранить в открытом виде',
  account_lockout_duration: 'Длительность блокировки (мин)',
  account_lockout_threshold: 'Порог блокировки',
  reset_account_lockout_after: 'Сброс блокировки через (мин)',
  trusted_domain: 'Доверенный домен',
  trust_password: 'Пароль доверия',
  principal: 'Принципал',
  target_dir: 'Целевая директория',
  source_dir: 'Исходная директория',
  server: 'Сервер',
  source_dsa: 'Исходный DSA',
  destination_dsa: 'Целевой DSA',
  nc_dn: 'NC DN',
  role: 'Роль',
  displayname: 'Отображаемое имя',
  container_dn: 'DN контейнера',
  block: 'Блокировать наследование',
  accountname: 'Имя учётной записи',
  service: 'Сервис',
  dns_host_name: 'DNS-имя узла',
  sitename: 'Имя сайта',
  new_ou_dn: 'Новый DN подразделения',
  on: 'Включено',
};

// ── Attribute Weight Map (importance: 3=critical, 2=important, 1=common, 0=rare) ──
const LDAP_ATTR_WEIGHT: Record<string, number> = {
  // Critical (3)
  dn: 3, cn: 3, sAMAccountName: 3, objectClass: 3, objectGUID: 3, objectSid: 3,
  distinguishedName: 3, userAccountControl: 3, displayName: 3,
  userPrincipalName: 3,
  // Important (2)
  member: 2, memberOf: 2, groupType: 2, mail: 2, description: 2,
  whenCreated: 2, whenChanged: 2, instanceType: 2, name: 2,
  sn: 2, givenName: 2, objectCategory: 2, adminCount: 2,
  isCriticalSystemObject: 2, operatingSystem: 2, dNSHostName: 2,
  sAMAccountType: 2, primaryGroupID: 2, accountExpires: 2,
  // Common (1)
  telephoneNumber: 1, company: 1, department: 1, title: 1, ou: 1,
  managedBy: 1, profilePath: 1, scriptPath: 1, homeDrive: 1,
  homeDirectory: 1, lastLogon: 1, lastLogonTimestamp: 1, pwdLastSet: 1,
  lastLogoff: 1, logonCount: 1, badPwdCount: 1, badPasswordTime: 1,
  lockoutTime: 1, codePage: 1, countryCode: 1,
  uSNCreated: 1, uSNChanged: 1, servicePrincipalName: 1,
  uidNumber: 1, gidNumber: 1, loginShell: 1, versionNumber: 1,
  gPCFileSysPath: 1, gPLink: 1, flags: 1,
  rIDSetReferences: 1, localPolicyFlags: 1,
  // FSMO Role names (3 = critical)
  SchemaMasterRole: 3, InfrastructureMasterRole: 3, RidAllocationMasterRole: 3,
  PdcEmulationRole: 3, DomainNamingMasterRole: 3,
  schema_master: 3, infrastructure_master: 3, rid_allocator_master: 3,
  pdc_emulator: 3, domain_naming_master: 3,
  fSMORoleOwner: 2,
  // Domain / computed (2)
  domain: 2, gpo_id: 1, domain_function_level: 2, forest_function_level: 2,
  lowest_dc_function_level: 2, password_settings: 2, fsmo_roles: 2,
  dnsPartitions: 1,
  dn_DomainDnsZones: 1,
  dn_ForestDnsZones: 1,
  // Domain LDAP (2)
  'msDS-Behavior-Version': 2, 'msDS-forestBehaviorVersion': 2, 'lowest_dc_msDS-Behavior-Version': 2,
  'msDS-SupportedEncryptionTypes': 1, 'msDS-KeyVersionNumber': 1,
  // Trust (2)
  trustPartner: 2, trustType: 2, trustDirection: 2, trustAttributes: 2,
  flatName: 1, trusted_domain: 2,
  // Password Policy (2 = important)
  min_password_length: 2, minimum_password_length: 2, password_complexity: 2,
  complexity: 2, password_history_length: 2, min_password_age: 2, minimum_password_age: 2,
  max_password_age: 2, maximum_password_age: 2, store_plaintext: 1,
  account_lockout_duration: 2, account_lockout_threshold: 2,
  reset_account_lockout_after: 2, password_properties: 1,
  // Password Policy CamelCase LDAP attributes (2 = important)
  lockOutObservationWindow: 2, lockoutDuration: 2, lockoutThreshold: 2,
  maxPwdAge: 2, minPwdAge: 2, minPwdLength: 2, pwdHistoryLength: 2, pwdProperties: 1,
  // FSMO partition-specific (2 = important)
  InfrastructureMasterRole_DomainDnsZones: 2, InfrastructureMasterRole_ForestDnsZones: 2,
  // Stats (1)
  'stats.computer_count': 1, 'stats.contact_count': 1, 'stats.group_count': 1,
  'stats.ou_count': 1, 'stats.ou_dn': 1, 'stats.total_objects': 1, 'stats.user_count': 1,
};

/** Get localized attribute name */
export function getAttrLocalName(key: string): string {
  return LDAP_ATTR_RU[key] || key;
}

/** Get attribute weight (importance) */
export function getAttrWeight(key: string): number {
  return LDAP_ATTR_WEIGHT[key] ?? 0;
}

/** Weight badge color class */
function weightBadgeClass(w: number): string {
  if (w >= 3) return 'bg-red-500/15 text-red-400 border-red-500/30';
  if (w >= 2) return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  if (w >= 1) return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
  return 'bg-muted text-muted-foreground border-border/50';
}

/** Weight label */
function weightLabel(w: number): string {
  if (w >= 3) return 'Крит.';
  if (w >= 2) return 'Важн.';
  if (w >= 1) return 'Обычн.';
  return 'Редк.';
}

/**
 * Flatten nested objects in data so AttributeViewer always shows a flat list.
 * Converts nested objects to JSON string representation.
 */
export function flattenLdapData(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === '__typename') continue;
    if (value === null || value === undefined) {
      result[key] = value;
    } else if (Array.isArray(value)) {
      // Keep arrays as-is if elements are strings/numbers;
      // flatten arrays of objects into string representations
      if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
        result[key] = value.map(v =>
          typeof v === 'object' ? formatObjectShort(v) : tryDecodeLdapValue(String(v))
        );
      } else {
        // Decode base64 strings in arrays
        result[key] = value.map(v => typeof v === 'string' ? tryDecodeLdapValue(v) : v);
      }
    } else if (typeof value === 'string') {
      // Decode base64-encoded LDAP values
      result[key] = tryDecodeLdapValue(value);
    } else if (typeof value === 'object') {
      // Flatten nested objects to readable string
      const obj = value as Record<string, unknown>;
      const entries = Object.entries(obj);
      if (entries.length <= 5) {
        // Small objects → inline as "key1: val1, key2: val2"
        result[key] = entries.map(([k, v]) =>
          `${k}: ${v === null ? '—' : String(v).slice(0, 60)}`
        ).join(', ');
      } else {
        // Large objects → JSON string
        result[key] = JSON.stringify(value, null, 2);
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Safely render any attribute value for display.
 * Handles: null, undefined, arrays, primitives.
 * Nested objects are pre-flattened so they don't appear here.
 */
export function safeRenderValue(value: unknown, maxBadges: number = 20): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">&mdash;</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">&mdash;</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {value.slice(0, maxBadges).map((v, idx) => (
          <Badge key={idx} variant="outline" className="text-[10px] font-mono max-w-[300px] truncate">
            {typeof v === 'object' && v !== null ? formatObjectShort(v) : String(v)}
          </Badge>
        ))}
        {value.length > maxBadges && (
          <span className="text-[10px] text-muted-foreground">+{value.length - maxBadges}</span>
        )}
      </div>
    );
  }

  // Handle objects that weren't pre-flattened
  if (typeof value === 'object') {
    return <span className="whitespace-pre-wrap break-all text-xs">{formatObjectShort(value)}</span>;
  }

  const strVal = String(value);
  if (strVal.includes('\n')) {
    return (
      <div className="text-xs whitespace-pre-wrap break-all">
        {strVal.split('\n').map((line, idx) => (
          <div key={idx}>{line || '\u00A0'}</div>
        ))}
      </div>
    );
  }

  return <span className="whitespace-pre-wrap break-all text-xs">{strVal}</span>;
}

/**
 * Format an object into a short readable string like "key1:val1, key2:val2"
 */
export function formatObjectShort(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return String(obj);
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) return '{}';
  return entries.slice(0, 3).map(([k, v]) => {
    const valStr = typeof v === 'object' ? formatObjectShort(v) : String(v);
    return `${k}:${valStr}`;
  }).join(', ') + (entries.length > 3 ? '...' : '');
}

function getStorageKey(entityType: string): string {
  return `samba-attrs-${entityType}`;
}

interface AttributeViewerProps {
  entityType: string;
  data: Record<string, unknown>;
  keyInfoKeys?: string[];
  showCustomize?: boolean;
}

export default function AttributeViewer({
  entityType,
  data,
  keyInfoKeys = [],
  showCustomize = true,
}: AttributeViewerProps) {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customAttrInput, setCustomAttrInput] = useState('');
  const [showAllMode, setShowAllMode] = useState(false);

  // Flatten data to avoid nested object expansion
  const flatData = useMemo(() => flattenLdapData(data), [data]);

  const allKeys = useMemo(() => {
    return Object.keys(flatData).sort();
  }, [flatData]);

  // Track explicitly hidden keys and custom-added keys separately
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(getStorageKey(entityType));
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.hidden && Array.isArray(parsed.hidden)) return new Set(parsed.hidden);
      }
    } catch { /* ignore */ }
    return new Set<string>();
  });

  const [customKeys, setCustomKeys] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(getStorageKey(entityType));
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.custom && Array.isArray(parsed.custom)) return new Set(parsed.custom);
      }
    } catch { /* ignore */ }
    return new Set<string>();
  });

  const persistPrefs = useCallback((hidden: Set<string>, custom: Set<string>) => {
    try {
      localStorage.setItem(getStorageKey(entityType), JSON.stringify({
        hidden: [...hidden],
        custom: [...custom],
      }));
    } catch { /* ignore */ }
  }, [entityType]);

  // Derive effective visible keys: all data keys minus hidden, plus custom
  const visibleKeys = useMemo(() => {
    if (showAllMode) {
      const visible = new Set(allKeys);
      for (const k of customKeys) visible.add(k);
      return visible;
    }
    const visible = new Set(allKeys.filter(k => !hiddenKeys.has(k)));
    for (const k of customKeys) visible.add(k);
    return visible;
  }, [allKeys, hiddenKeys, customKeys, showAllMode]);

  const toggleKey = (key: string) => {
    if (allKeys.includes(key)) {
      setHiddenKeys(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        persistPrefs(next, customKeys);
        return next;
      });
    } else if (customKeys.has(key)) {
      setCustomKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        persistPrefs(hiddenKeys, next);
        return next;
      });
    } else {
      setCustomKeys(prev => {
        const next = new Set(prev);
        next.add(key);
        persistPrefs(hiddenKeys, next);
        return next;
      });
    }
  };

  const addCustomAttr = () => {
    const attr = customAttrInput.trim();
    if (!attr) return;
    setCustomKeys(prev => {
      const next = new Set(prev);
      next.add(attr);
      const newHidden = new Set(hiddenKeys);
      newHidden.delete(attr);
      persistPrefs(newHidden, next);
      setHiddenKeys(newHidden);
      return next;
    });
    setCustomAttrInput('');
  };

  const showAll = () => {
    setHiddenKeys(new Set());
    setShowAllMode(true);
    persistPrefs(new Set(), customKeys);
  };

  const hideAllExtras = () => {
    const newHidden = new Set(allKeys.filter(k => !keyInfoKeys.includes(k)));
    setHiddenKeys(newHidden);
    setShowAllMode(false);
    persistPrefs(newHidden, customKeys);
  };

  const toggleShowAll = () => {
    if (showAllMode) {
      setShowAllMode(false);
    } else {
      showAll();
    }
  };

  const keyInfoEntries = keyInfoKeys
    .filter(k => flatData[k] !== undefined && flatData[k] !== null)
    .map(k => [k, flatData[k]] as [string, unknown]);

  const extraEntries = allKeys
    .filter(k => visibleKeys.has(k) && !keyInfoKeys.includes(k))
    .map(k => [k, flatData[k]] as [string, unknown]);

  const customOnlyEntries = [...visibleKeys]
    .filter(k => !allKeys.includes(k))
    .map(k => [k, flatData[k]] as [string, unknown]);

  const totalExtra = allKeys.filter(k => !keyInfoKeys.includes(k)).length;
  const hiddenCount = allKeys.filter(k => !visibleKeys.has(k) && !keyInfoKeys.includes(k)).length;

  // Render localized attribute label with weight badge
  const renderAttrLabel = (key: string) => {
    const localName = getAttrLocalName(key);
    const weight = getAttrWeight(key);
    const isLocalized = localName !== key;
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <Badge variant="outline" className={`text-[9px] px-1 py-0 flex-shrink-0 font-mono ${weightBadgeClass(weight)}`}>
          {weightLabel(weight)}
        </Badge>
        <span className="font-mono whitespace-nowrap" title={isLocalized ? `${key} → ${localName}` : key}>
          {isLocalized ? localName : key}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {keyInfoEntries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {keyInfoEntries.map(([key, value]) => {
            const localName = getAttrLocalName(key);
            const weight = getAttrWeight(key);
            const isLocalized = localName !== key;
            return (
              <div key={key} className="p-3 rounded-lg bg-muted/50 border border-border/50 overflow-hidden">
                <p className="text-[10px] text-muted-foreground uppercase mb-1 flex items-center gap-1.5">
                  <Badge variant="outline" className={`text-[8px] px-1 py-0 font-mono ${weightBadgeClass(weight)}`}>
                    {weightLabel(weight)}
                  </Badge>
                  {isLocalized ? (
                    <span>{localName} <span className="opacity-50 font-mono normal-case">({key})</span></span>
                  ) : (
                    <span>{key}</span>
                  )}
                </p>
                <div className="text-sm font-medium break-words overflow-hidden">
                  {safeRenderValue(value)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Separator />
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase">
          {extraEntries.length + customOnlyEntries.length} {t('attrs.attributes', 'Атрибутов')}
          {hiddenCount > 0 && !showAllMode && (
            <span className="font-normal ml-1">({hiddenCount} {t('attrs.hidden', 'скрыто')})</span>
          )}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs gap-1"
            onClick={toggleShowAll}
          >
            {showAllMode ? (
              <>
                <ChevronUp className="w-3 h-3" />
                {t('attrs.showLess', 'Свернуть')}
              </>
            ) : (
              <>
                <Eye className="w-3 h-3" />
                {t('attrs.showAll', 'Показать все')}
              </>
            )}
          </Button>
          {showCustomize && (
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="w-3 h-3" />
              {t('attrs.customize', 'Настроить')}
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-0">
        {[...extraEntries, ...customOnlyEntries].map(([key, value]) => (
          <div key={key} className="flex flex-wrap items-baseline gap-x-2 text-xs py-1 border-b border-border/30">
            <div className="text-muted-foreground" title={key}>
              {renderAttrLabel(key)}
            </div>
            <span className="break-all min-w-0">
              {safeRenderValue(value)}
            </span>
          </div>
        ))}
        {extraEntries.length + customOnlyEntries.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center">
            {hiddenCount > 0
              ? t('attrs.hiddenClick', `${hiddenCount} атрибутов скрыто. Нажмите «Показать все».`)
              : t('attrs.noVisible', 'Нет видимых атрибутов. Нажмите «Настроить» для добавления.')}
          </p>
        )}
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              {t('attrs.customizeTitle', 'Настройка атрибутов')}
            </DialogTitle>
            <DialogDescription className="sr-only">{t('attrs.customizeTitle', 'Настройка атрибутов')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3" style={{ maxHeight: 'calc(80vh - 8rem)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="flex gap-2 flex-shrink-0">
              <Button variant="outline" size="sm" className="text-xs flex-1" onClick={() => { showAll(); }}>
                <Eye className="w-3 h-3 mr-1" /> {t('attrs.showAll', 'Показать все')}
              </Button>
              <Button variant="outline" size="sm" className="text-xs flex-1" onClick={hideAllExtras}>
                <EyeOff className="w-3 h-3 mr-1" /> {t('attrs.hideAll', 'Скрыть все')}
              </Button>
            </div>

            <div className="flex gap-2 flex-shrink-0">
              <Input
                value={customAttrInput}
                onChange={(e) => setCustomAttrInput(e.target.value)}
                placeholder={t('attrs.addAttr', 'Добавить атрибут...')}
                className="h-8 text-xs"
                onKeyDown={(e) => { if (e.key === 'Enter') addCustomAttr(); }}
              />
              <Button size="sm" className="h-8" onClick={addCustomAttr} disabled={!customAttrInput.trim()}>
                <Plus className="w-3 h-3" />
              </Button>
            </div>

            <ScrollArea className="flex-1" style={{ maxHeight: '50vh' }}>
              <div className="space-y-0.5">
                {allKeys.map(key => {
                  const val = flatData[key];
                  const localName = getAttrLocalName(key);
                  const isLocalized = localName !== key;
                  const valPreview = val === null || val === undefined ? '—'
                    : typeof val === 'string' ? val.slice(0, 25)
                    : Array.isArray(val) ? `[${val.length}]`
                    : String(val).slice(0, 20);
                  return (
                    <div key={key} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 py-1 px-2 rounded hover:bg-accent min-w-0">
                      <Checkbox
                        checked={visibleKeys.has(key)}
                        onCheckedChange={() => { toggleKey(key); if (showAllMode) setShowAllMode(false); }}
                        className="h-3.5 w-3.5 flex-shrink-0"
                      />
                      <Label className="text-xs cursor-pointer truncate" title={isLocalized ? `${key} → ${localName}` : key}>
                        <span className="font-mono">{key}</span>
                        {isLocalized && <span className="text-muted-foreground ml-1 text-[10px]">({localName})</span>}
                      </Label>
                      <span className="text-[10px] text-muted-foreground truncate max-w-[120px] text-right flex-shrink-0" title={valPreview}>
                        {valPreview}
                      </span>
                    </div>
                  );
                })}
                {[...visibleKeys].filter(k => !allKeys.includes(k)).map(key => (
                  <div key={key} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-accent bg-amber-500/5 min-w-0">
                    <Checkbox
                      checked={visibleKeys.has(key)}
                      onCheckedChange={() => toggleKey(key)}
                      className="h-3.5 w-3.5 flex-shrink-0"
                    />
                    <Label className="text-xs font-mono cursor-pointer flex-1 truncate" title={key}>{key}</Label>
                    <Button variant="ghost" size="icon" className="h-5 w-5 flex-shrink-0" onClick={() => toggleKey(key)}>
                      <X className="w-3 h-3 text-red-400" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
