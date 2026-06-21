import { describe, expect, it } from 'vitest';
import {
  decodeLdapObject,
  extractNameList,
  extractOutputText,
  normalizeToArray,
  parseBlocks,
  parseDnsRecords,
  parseDnsServerInfo,
  parseDnsZones,
  parseFsmoRoles,
  parseGpoList,
  parseGroupDetail,
  parseKeyValueBlock,
  parseLdapAttributes,
  parseUserDetail,
  renderAttrValue,
  safeToastMessage,
  tryDecodeLdapValue,
  unwrapResponse,
} from './parsers';

describe('parsers', () => {
  it('[tryDecodeLdapValue] должен декодировать base64 LDAP значение, когда передан читаемый текст', () => {
    // Arrange
    const encodedValue = btoa(unescape(encodeURIComponent('Привет')));

    // Act
    const result = tryDecodeLdapValue(encodedValue);

    // Assert
    expect(result).toBe('Привет');
  });

  it('[tryDecodeLdapValue] должен вернуть исходное значение, когда вход пустой или не base64', () => {
    // Arrange
    const invalidValue = 'not base64!';

    // Act
    const emptyResult = tryDecodeLdapValue('');
    const invalidResult = tryDecodeLdapValue(invalidValue);

    // Assert
    expect(emptyResult).toBe('');
    expect(invalidResult).toBe(invalidValue);
  });

  it('[decodeLdapObject] должен рекурсивно декодировать строки, когда объект содержит вложенные значения и массивы', () => {
    // Arrange
    const encodedValue = btoa(unescape(encodeURIComponent('Тест')));
    const ldapObject = {
      cn: encodedValue,
      member: [encodedValue, 42, { description: encodedValue }],
      untouched: null,
    };

    // Act
    const result = decodeLdapObject(ldapObject);

    // Assert
    expect(result).toEqual({
      cn: 'Тест',
      member: ['Тест', 42, { description: 'Тест' }],
      untouched: null,
    });
  });

  it('[safeToastMessage] должен собрать сообщение, когда detail содержит массив ошибок валидации', () => {
    // Arrange
    const value = {
      detail: [
        { loc: ['body', 'username'], msg: 'Field required' },
        { message: 'Password is weak' },
      ],
    };

    // Act
    const result = safeToastMessage(value, 'Fallback');

    // Assert
    expect(result).toBe('Field required; Password is weak');
  });

  it('[safeToastMessage] должен вернуть fallback, когда значение null или undefined', () => {
    // Arrange
    const fallback = 'Ошибка';

    // Act
    const nullResult = safeToastMessage(null, fallback);
    const undefinedResult = safeToastMessage(undefined, fallback);

    // Assert
    expect(nullResult).toBe(fallback);
    expect(undefinedResult).toBe(fallback);
  });

  it('[parseKeyValueBlock] должен распарсить повторяющиеся и base64 атрибуты, когда передан LDAP блок', () => {
    // Arrange
    const encodedValue = btoa(unescape(encodeURIComponent('Описание')));
    const text = `
      dn: CN=user,CN=Users,DC=example,DC=com
      objectClass: top
      objectClass: user
      description :: ${encodedValue}
      invalid-line
      : value without key
    `;

    // Act
    const result = parseKeyValueBlock(text);

    // Assert
    expect(result).toEqual({
      dn: 'CN=user,CN=Users,DC=example,DC=com',
      objectClass: ['top', 'user'],
      description: 'Описание',
    });
  });

  it('[parseKeyValueBlock] должен вернуть пустой объект, когда передана пустая строка', () => {
    // Arrange
    const text = '';

    // Act
    const result = parseKeyValueBlock(text);

    // Assert
    expect(result).toEqual({});
  });

  it('[parseBlocks] должен вернуть массив блоков, когда текст разделен пустыми строками', () => {
    // Arrange
    const text = 'name: one\n\nname: two\nvalue: 2';

    // Act
    const result = parseBlocks(text);

    // Assert
    expect(result).toEqual([{ name: 'one' }, { name: 'two', value: '2' }]);
  });

  it('[parseDnsZones] должен вернуть зоны, когда вывод содержит валидные DNS блоки', () => {
    // Arrange
    const text = `
      2 zone(s) found

      pszZoneName : example.com
      Flags       : DNS_RPC_ZONE_DSINTEGRATED
      ZoneType    : DNS_ZONE_TYPE_PRIMARY
      pszDpFqdn   : DomainDnsZones.example.com

      invalid : block
    `;

    // Act
    const result = parseDnsZones(text);

    // Assert
    expect(result).toEqual([
      {
        name: 'example.com',
        pszZoneName: 'example.com',
        Flags: 'DNS_RPC_ZONE_DSINTEGRATED',
        ZoneType: 'DNS_ZONE_TYPE_PRIMARY',
        pszDpFqdn: 'DomainDnsZones.example.com',
        zoneType: 'DNS_ZONE_TYPE_PRIMARY',
        flags: 'DNS_RPC_ZONE_DSINTEGRATED',
        dpFqdn: 'DomainDnsZones.example.com',
      },
    ]);
  });

  it('[parseDnsRecords] должен вернуть записи, когда вывод содержит обычный и fallback форматы', () => {
    // Arrange
    const text = `
      Name=www, Records=2, Children=0
        A: 192.168.1.1 (flags=600, serial=3, ttl=900)
        TXT hello world
      Name=@, Records=1, Children=0
        NS: dc1.example.com
    `;

    // Act
    const result = parseDnsRecords(text);

    // Assert
    expect(result).toEqual([
      {
        name: 'www',
        type: 'A',
        data: '192.168.1.1',
        flags: '600',
        serial: '3',
        ttl: '900',
      },
      { name: 'www', type: 'TXT', data: 'hello world' },
      {
        name: '@',
        type: 'NS',
        data: 'dc1.example.com',
        flags: undefined,
        serial: undefined,
        ttl: undefined,
      },
    ]);
  });

  it('[parseDnsRecords] должен использовать @, когда запись идет без имени', () => {
    // Arrange
    const text = 'A: 127.0.0.1';

    // Act
    const result = parseDnsRecords(text);

    // Assert
    expect(result).toEqual([
      { name: '@', type: 'A', data: '127.0.0.1', flags: undefined, serial: undefined, ttl: undefined },
    ]);
  });

  it('[parseDnsServerInfo] должен извлечь адреса и имена, когда вывод содержит Python list строки', () => {
    // Arrange
    const text = `
      pszServerName : dc1
      pszDomainName : example.com
      pszForestName : example.com
      aipServerAddrs : ['192.168.1.10', '10.0.0.1']
      aipListenAddrs : []
    `;

    // Act
    const result = parseDnsServerInfo(text);

    // Assert
    expect(result).toMatchObject({
      serverName: 'dc1',
      domainName: 'example.com',
      forestName: 'example.com',
      serverAddrs: ['192.168.1.10', '10.0.0.1'],
      listenAddrs: [],
      ipFromServer: '192.168.1.10',
    });
  });

  it('[parseLdapAttributes] должен вернуть атрибуты, когда передан LDAP текст', () => {
    // Arrange
    const text = 'cn: Admin\nmemberOf: CN=Domain Admins\nmemberOf: CN=Users';

    // Act
    const result = parseLdapAttributes(text);

    // Assert
    expect(result).toEqual({ cn: 'Admin', memberOf: ['CN=Domain Admins', 'CN=Users'] });
  });

  it('[parseUserDetail] должен нормализовать пользователя, когда memberOf представлен одной строкой', () => {
    // Arrange
    const text = `
      dn: CN=john,CN=Users,DC=example,DC=com
      givenName: John
      sn: Doe
      mail: john@example.com
      memberOf: CN=Users,DC=example,DC=com
    `;

    // Act
    const result = parseUserDetail('john', text);

    // Assert
    expect(result).toMatchObject({
      username: 'john',
      givenName: 'John',
      sn: 'Doe',
      mail: 'john@example.com',
      memberOf: ['CN=Users,DC=example,DC=com'],
      dn: 'CN=john,CN=Users,DC=example,DC=com',
    });
  });

  it('[parseGroupDetail] должен нормализовать участников, когда member и memberOf повторяются', () => {
    // Arrange
    const text = `
      cn: Admins
      member: CN=User1
      member: CN=User2
      memberOf: CN=Parent
      groupType: -2147483646
    `;

    // Act
    const result = parseGroupDetail('Admins', text);

    // Assert
    expect(result).toMatchObject({
      groupname: 'Admins',
      cn: 'Admins',
      member: ['CN=User1', 'CN=User2'],
      memberOf: ['CN=Parent'],
      groupType: '-2147483646',
    });
  });

  it('[parseFsmoRoles] должен извлечь роли и короткое имя, когда owner содержит CN сервера', () => {
    // Arrange
    const text = `
      SchemaMasterRole owner: CN=NTDS Settings,CN=DC1,CN=Servers,CN=Default-First-Site-Name
      PdcEmulationMasterRole: CN=DC2,CN=Servers,CN=Default-First-Site-Name
      ignored line
    `;

    // Act
    const result = parseFsmoRoles(text);

    // Assert
    expect(result).toEqual([
      {
        role: 'SchemaMasterRole',
        owner: 'CN=NTDS Settings,CN=DC1,CN=Servers,CN=Default-First-Site-Name',
        shortName: 'DC1',
      },
      {
        role: 'PdcEmulationMasterRole',
        owner: 'CN=DC2,CN=Servers,CN=Default-First-Site-Name',
        shortName: 'DC2',
      },
    ]);
  });

  it('[parseGpoList] должен вернуть GPO, когда блок содержит числовую версию и fallback displayname', () => {
    // Arrange
    const text = `
      GPO          : {GUID-1}
      display name : Default Domain Policy
      version      : 42
      flags        : NONE

      GPO          : {GUID-2}
      version      : invalid

      dn           : CN=ignored
    `;

    // Act
    const result = parseGpoList(text);

    // Assert
    expect(result).toEqual([
      {
        gpoId: '{GUID-1}',
        displayname: 'Default Domain Policy',
        path: undefined,
        dn: undefined,
        version: 42,
        flags: 'NONE',
      },
      {
        gpoId: '{GUID-2}',
        displayname: '{GUID-2}',
        path: undefined,
        dn: undefined,
        version: 0,
        flags: undefined,
      },
    ]);
  });

  it('[renderAttrValue] должен безопасно отрендерить значения, когда переданы null, массив, объект и максимальное число', () => {
    // Arrange
    const objectValue = { max: Number.MAX_SAFE_INTEGER };

    // Act
    const nullResult = renderAttrValue(null);
    const arrayResult = renderAttrValue(['a', 0, undefined]);
    const objectResult = renderAttrValue(objectValue);
    const numberResult = renderAttrValue(Number.MAX_SAFE_INTEGER);

    // Assert
    expect(nullResult).toBe('—');
    expect(arrayResult).toEqual(['a', '0', 'undefined']);
    expect(objectResult).toBe(JSON.stringify(objectValue));
    expect(numberResult).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it('[normalizeToArray] должен вернуть массив, когда вход null, undefined, строка, массив или число', () => {
    // Arrange
    const arrayValue = ['a', 0, null];

    // Act
    const nullResult = normalizeToArray(null);
    const undefinedResult = normalizeToArray(undefined);
    const stringResult = normalizeToArray('');
    const arrayResult = normalizeToArray(arrayValue);
    const numberResult = normalizeToArray(0);

    // Assert
    expect(nullResult).toEqual([]);
    expect(undefinedResult).toEqual([]);
    expect(stringResult).toEqual(['']);
    expect(arrayResult).toEqual(['a', '0', 'null']);
    expect(numberResult).toEqual(['0']);
  });

  it('[extractOutputText] должен извлечь output, когда ответ обернут в data или result', () => {
    // Arrange
    const direct = { output: 'direct' };
    const wrappedInData = { data: { output: 'data' } };
    const wrappedInResult = { result: { output: 'result' } };

    // Act
    const directResult = extractOutputText(direct);
    const dataResult = extractOutputText(wrappedInData);
    const resultResult = extractOutputText(wrappedInResult);
    const invalidResult = extractOutputText([]);

    // Assert
    expect(directResult).toBe('direct');
    expect(dataResult).toBe('data');
    expect(resultResult).toBe('result');
    expect(invalidResult).toBeUndefined();
  });

  it('[unwrapResponse] должен вернуть вложенный объект, когда ответ содержит data или result', () => {
    // Arrange
    const data = { id: 1 };
    const result = { id: 2 };

    // Act
    const dataResult = unwrapResponse({ data });
    const resultResult = unwrapResponse({ result });
    const primitiveResult = unwrapResponse(null);

    // Assert
    expect(dataResult).toBe(data);
    expect(resultResult).toBe(result);
    expect(primitiveResult).toBeNull();
  });

  it('[extractNameList] должен извлечь имена, когда вход массив объектов или текстовый output', () => {
    // Arrange
    const arrayInput = [{ username: ' alice ' }, { groupname: 'admins' }, { first: 'fallback' }, null, ' bob '];
    const outputInput = { output: '3 user(s) found\nalice\n\nbob' };

    // Act
    const arrayResult = extractNameList(arrayInput);
    const outputResult = extractNameList(outputInput);
    const invalidResult = extractNameList(null);

    // Assert
    expect(arrayResult).toEqual(['alice', 'admins', 'fallback', 'bob']);
    expect(outputResult).toEqual(['alice', 'bob']);
    expect(invalidResult).toEqual([]);
  });
});
